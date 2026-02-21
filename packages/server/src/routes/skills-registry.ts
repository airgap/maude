/**
 * agentskills.io registry integration
 *
 * Browses and installs Agent Skills from the official anthropics/skills
 * repository on GitHub. Skills follow the open agentskills.io format:
 * a directory containing a SKILL.md file with YAML frontmatter.
 *
 * Endpoints:
 *   GET /api/skills-registry/browse         — list available skills
 *   GET /api/skills-registry/skill/:name    — get SKILL.md content for a skill
 *   POST /api/skills-registry/install       — install a skill to workspace
 */

import { Hono } from 'hono';
import { mkdir, writeFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { getDb } from '../db/database';

const app = new Hono();

const REGISTRY_OWNER = 'anthropics';
const REGISTRY_REPO = 'skills';
const REGISTRY_SKILLS_PATH = 'skills';
const GITHUB_API = 'https://api.github.com';
const RAW_GITHUB = 'https://raw.githubusercontent.com';

const GITHUB_HEADERS: HeadersInit = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'E-IDE/1.0',
};

export interface RegistrySkill {
  name: string;
  description: string;
  compatibility?: string;
  license?: string;
  metadata?: Record<string, string>;
  content: string; // Full SKILL.md content
}

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Handles the --- delimited YAML block at the top.
 */
function parseFrontmatter(raw: string): {
  name: string;
  description: string;
  compatibility?: string;
  license?: string;
  metadata?: Record<string, string>;
  body: string;
} {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { name: '', description: '', body: raw };
  }

  const yamlStr = fmMatch[1];
  const body = fmMatch[2] || '';

  // Simple line-by-line YAML parser for the fields we care about
  const parsed: Record<string, any> = {};
  const lines = yamlStr.split('\n');
  let currentKey: string | null = null;
  let metadataBlock = false;
  const metadata: Record<string, string> = {};

  for (const line of lines) {
    // Detect metadata block
    if (line.trim() === 'metadata:') {
      metadataBlock = true;
      currentKey = null;
      continue;
    }

    if (metadataBlock && line.match(/^\s{2,}\w/)) {
      const mMatch = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
      if (mMatch) {
        metadata[mMatch[1]] = mMatch[2].replace(/^["']|["']$/g, '');
      }
      continue;
    } else if (metadataBlock && !line.match(/^\s/)) {
      metadataBlock = false;
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].replace(/^["']|["']$/g, '');
      parsed[key] = val;
      currentKey = key;
    } else if (currentKey && line.match(/^\s+/)) {
      // Multi-line value (description continuation)
      parsed[currentKey] = (parsed[currentKey] || '') + ' ' + line.trim();
    }
  }

  return {
    name: parsed['name'] || '',
    description: parsed['description'] || '',
    compatibility: parsed['compatibility'],
    license: parsed['license'],
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    body,
  };
}

function getWorkspacePath(): string {
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'workspacePath'").get() as any;
    if (row) return JSON.parse(row.value);
  } catch {}
  return '.';
}

// Cache for registry listing — avoid hammering GitHub API
let listCache: { skills: RegistrySkill[]; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchRegistrySkills(): Promise<RegistrySkill[]> {
  if (listCache && Date.now() - listCache.ts < CACHE_TTL_MS) {
    return listCache.skills;
  }

  // 1. List skill directories
  const dirsRes = await fetch(
    `${GITHUB_API}/repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${REGISTRY_SKILLS_PATH}`,
    { headers: GITHUB_HEADERS },
  );
  if (!dirsRes.ok) throw new Error(`GitHub API error ${dirsRes.status}`);
  const dirs = (await dirsRes.json()) as any[];

  const skillDirs = dirs.filter((d: any) => d.type === 'dir');

  // 2. Fetch SKILL.md for each directory in parallel (limit concurrency)
  const CONCURRENCY = 5;
  const skills: RegistrySkill[] = [];

  for (let i = 0; i < skillDirs.length; i += CONCURRENCY) {
    const batch = skillDirs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (dir: any) => {
        const rawUrl = `${RAW_GITHUB}/${REGISTRY_OWNER}/${REGISTRY_REPO}/main/${REGISTRY_SKILLS_PATH}/${dir.name}/SKILL.md`;
        const res = await fetch(rawUrl, { headers: GITHUB_HEADERS });
        if (!res.ok) return null;
        const content = await res.text();
        const fm = parseFrontmatter(content);
        return {
          name: fm.name || dir.name,
          description: fm.description,
          compatibility: fm.compatibility,
          license: fm.license,
          metadata: fm.metadata,
          content,
        } as RegistrySkill;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        skills.push(r.value);
      }
    }
  }

  listCache = { skills, ts: Date.now() };
  return skills;
}

// GET /api/skills-registry/browse
app.get('/browse', async (c) => {
  try {
    const skills = await fetchRegistrySkills();
    // Don't send full content in the list — just metadata
    return c.json({
      ok: true,
      data: skills.map((s) => ({
        name: s.name,
        description: s.description,
        compatibility: s.compatibility,
        license: s.license,
        metadata: s.metadata,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to fetch registry: ${msg}` }, 500);
  }
});

// GET /api/skills-registry/skill/:name — get full SKILL.md content
app.get('/skill/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const skills = await fetchRegistrySkills();
    const skill = skills.find((s) => s.name === name);
    if (!skill) return c.json({ ok: false, error: 'Skill not found' }, 404);
    return c.json({ ok: true, data: skill });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// POST /api/skills-registry/install — write skill to workspace .claude/skills/{name}/SKILL.md
app.post('/install', async (c) => {
  const body = await c.req.json();
  const { skillName, workspacePath: reqWorkspacePath } = body;

  if (!skillName) return c.json({ ok: false, error: 'skillName required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    // Fetch skill content (from cache or fresh)
    const skills = await fetchRegistrySkills();
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
      return c.json({ ok: false, error: `Skill '${skillName}' not found in registry` }, 404);
    }

    // Write to both .e/skills/ (primary) and .claude/skills/ (backward compat)
    for (const parent of ['.e', '.claude']) {
      const skillDir = join(workspacePath, parent, 'skills', skillName);
      await mkdir(skillDir, { recursive: true });
      const skillFile = join(skillDir, 'SKILL.md');
      await writeFile(skillFile, skill.content, 'utf-8');
    }
    const skillFile = join(workspacePath, '.e', 'skills', skillName, 'SKILL.md');

    return c.json({ ok: true, data: { path: skillFile } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to install skill: ${msg}` }, 500);
  }
});

// GET /api/skills-registry/installed — list installed skill names for the workspace
app.get('/installed', async (c) => {
  const workspacePath = c.req.query('workspacePath') || getWorkspacePath();
  try {
    const installedSet = new Set<string>();
    // Discover skills from both .claude/skills/ and .e/skills/
    for (const parent of ['.claude', '.e']) {
      const skillsDir = join(workspacePath, parent, 'skills');
      const entries = await readdir(skillsDir).catch(() => []);
      for (const entry of entries) {
        try {
          const skillFile = join(skillsDir, entry, 'SKILL.md');
          await stat(skillFile);
          installedSet.add(entry);
        } catch {}
      }
    }
    return c.json({ ok: true, data: Array.from(installedSet) });
  } catch (err) {
    return c.json({ ok: true, data: [] });
  }
});

export { app as skillsRegistryRoutes };
