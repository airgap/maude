/**
 * Skills Marketplace & Registry
 *
 * A full marketplace with three tiers:
 * - Bundled: Included with E (built-in skills)
 * - Managed: Downloaded and auto-updated from the registry (~/.e/skills/)
 * - Workspace: User-created in the workspace (.e/skills/)
 *
 * Endpoints:
 *   GET  /api/skills-registry/browse              — search/browse marketplace
 *   GET  /api/skills-registry/skill/:id           — get full skill details
 *   POST /api/skills-registry/install             — install a skill
 *   POST /api/skills-registry/uninstall           — uninstall a skill
 *   GET  /api/skills-registry/installed           — list installed skills
 *   POST /api/skills-registry/create              — create a new workspace skill
 *   PATCH /api/skills-registry/config             — update skill configuration
 *   PATCH /api/skills-registry/activate           — activate/deactivate a skill
 *   PATCH /api/skills-registry/pin-version        — pin/unpin version for managed skill
 *   POST /api/skills-registry/check-updates       — check for updates to managed skills
 *   GET  /api/skills-registry/suggest             — get skill suggestions for a query
 *   GET  /api/skills-registry/bundled             — list bundled skills
 */

import { Hono } from 'hono';
import { mkdir, writeFile, readdir, stat, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getDb } from '../db/database';
import type {
  SkillTier,
  SkillCategory,
  SkillSortBy,
  SkillMetadata,
  SkillSummary,
  MarketplaceSkill,
  SkillBrowseResponse,
  SkillConfigField,
} from '@e/shared';

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

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

export function ensureSkillsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS installed_skills (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'managed',
      version TEXT NOT NULL DEFAULT '1.0.0',
      pinned_version TEXT,
      installed_path TEXT NOT NULL,
      workspace_path TEXT,
      config TEXT,
      activated INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_installed_skills_skill_id ON installed_skills(skill_id);
    CREATE INDEX IF NOT EXISTS idx_installed_skills_workspace ON installed_skills(workspace_path);
  `);
}

// ---------------------------------------------------------------------------
// SKILL.md Parser
// ---------------------------------------------------------------------------

interface ParsedSkillMd {
  metadata: SkillMetadata;
  body: string;
  promptTemplate?: string;
  rules?: string[];
  raw: string;
}

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Extracts metadata, prompt template, and rules.
 */
function parseSkillMd(raw: string, fallbackId: string): ParsedSkillMd {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return {
      metadata: {
        id: fallbackId,
        name: fallbackId,
        description: '',
        version: '1.0.0',
        category: 'other',
        tags: [],
      },
      body: raw,
      raw,
    };
  }

  const yamlStr = fmMatch[1];
  const body = fmMatch[2] || '';

  // Simple line-by-line YAML parser
  const parsed: Record<string, any> = {};
  const lines = yamlStr.split('\n');
  let currentKey: string | null = null;
  let metadataBlock = false;
  let configBlock = false;
  let currentConfigKey: string | null = null;
  const metadata: Record<string, string> = {};
  const configSchema: Record<string, SkillConfigField> = {};
  const tags: string[] = [];
  const requiredTools: string[] = [];
  const requiredMcpServers: string[] = [];
  let inArrayKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect metadata block
    if (trimmed === 'metadata:') {
      metadataBlock = true;
      configBlock = false;
      currentKey = null;
      inArrayKey = null;
      continue;
    }

    // Detect config block
    if (trimmed === 'config:' || trimmed === 'configSchema:') {
      configBlock = true;
      metadataBlock = false;
      currentKey = null;
      inArrayKey = null;
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

    if (configBlock && line.match(/^\s{2,}\w/)) {
      const configKeyMatch = line.match(/^\s{2}(\w[\w-]*):\s*$/);
      if (configKeyMatch) {
        currentConfigKey = configKeyMatch[1];
        configSchema[currentConfigKey] = { type: 'string', label: currentConfigKey };
        continue;
      }
      if (currentConfigKey && line.match(/^\s{4,}/)) {
        const kvMatch = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
        if (kvMatch) {
          const k = kvMatch[1];
          const v = kvMatch[2].replace(/^["']|["']$/g, '');
          const field = configSchema[currentConfigKey];
          if (field) {
            if (k === 'type') field.type = v as any;
            else if (k === 'label') field.label = v;
            else if (k === 'description') field.description = v;
            else if (k === 'default') field.default = v;
            else if (k === 'required') field.required = v === 'true';
          }
        }
      }
      continue;
    } else if (configBlock && !line.match(/^\s/)) {
      configBlock = false;
      currentConfigKey = null;
    }

    // Array items (tags, requiredTools, requiredMcpServers)
    if (inArrayKey && trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).replace(/^["']|["']$/g, '');
      if (inArrayKey === 'tags') tags.push(val);
      else if (inArrayKey === 'requiredTools' || inArrayKey === 'required_tools')
        requiredTools.push(val);
      else if (inArrayKey === 'requiredMcpServers' || inArrayKey === 'required_mcp_servers')
        requiredMcpServers.push(val);
      continue;
    } else if (inArrayKey && !trimmed.startsWith('- ') && trimmed !== '') {
      inArrayKey = null;
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].replace(/^["']|["']$/g, '').trim();
      if (
        val === '' &&
        (key === 'tags' ||
          key === 'requiredTools' ||
          key === 'required_tools' ||
          key === 'requiredMcpServers' ||
          key === 'required_mcp_servers')
      ) {
        inArrayKey = key;
        currentKey = key;
        continue;
      }
      // Handle inline arrays: tags: [a, b, c]
      if (val.startsWith('[') && val.endsWith(']')) {
        const items = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''));
        if (key === 'tags') tags.push(...items);
        else if (key === 'requiredTools' || key === 'required_tools') requiredTools.push(...items);
        else if (key === 'requiredMcpServers' || key === 'required_mcp_servers')
          requiredMcpServers.push(...items);
        else parsed[key] = items;
      } else {
        parsed[key] = val;
      }
      currentKey = key;
      inArrayKey = null;
    } else if (currentKey && line.match(/^\s+/) && !metadataBlock && !configBlock) {
      // Multi-line value continuation
      parsed[currentKey] = (parsed[currentKey] || '') + ' ' + trimmed;
    }
  }

  // Extract prompt template from body (## Prompt Template section)
  let promptTemplate: string | undefined;
  const promptMatch = body.match(/##\s*Prompt\s*Template\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
  if (promptMatch) {
    promptTemplate = promptMatch[1].trim();
  }

  // Extract rules from body (## Rules section)
  let rules: string[] | undefined;
  const rulesMatch = body.match(/##\s*Rules\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
  if (rulesMatch) {
    rules = rulesMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- ') || l.startsWith('* '))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);
  }

  const skillMetadata: SkillMetadata = {
    id: parsed['id'] || fallbackId,
    name: parsed['name'] || fallbackId,
    description: parsed['description'] || '',
    version: parsed['version'] || '1.0.0',
    author: parsed['author'],
    category: (parsed['category'] as SkillCategory) || 'other',
    tags: tags.length > 0 ? tags : [],
    license: parsed['license'],
    compatibility: parsed['compatibility'],
    requiredMcpServers: requiredMcpServers.length > 0 ? requiredMcpServers : undefined,
    requiredTools: requiredTools.length > 0 ? requiredTools : undefined,
    configSchema: Object.keys(configSchema).length > 0 ? configSchema : undefined,
    installs: parsed['installs'] ? parseInt(parsed['installs'], 10) : undefined,
    stars: parsed['stars'] ? parseInt(parsed['stars'], 10) : undefined,
  };

  return {
    metadata: skillMetadata,
    body,
    promptTemplate,
    rules,
    raw,
  };
}

/**
 * Generate SKILL.md content from metadata and prompt
 */
function generateSkillMd(
  metadata: SkillMetadata,
  promptTemplate?: string,
  rules?: string[],
): string {
  const lines: string[] = ['---'];
  lines.push(`name: "${metadata.name}"`);
  lines.push(`description: "${metadata.description}"`);
  lines.push(`version: "${metadata.version}"`);
  if (metadata.author) lines.push(`author: "${metadata.author}"`);
  lines.push(`category: ${metadata.category}`);
  if (metadata.tags.length > 0) {
    lines.push(`tags: [${metadata.tags.map((t) => `"${t}"`).join(', ')}]`);
  }
  if (metadata.license) lines.push(`license: "${metadata.license}"`);
  if (metadata.compatibility) lines.push(`compatibility: "${metadata.compatibility}"`);
  if (metadata.requiredTools && metadata.requiredTools.length > 0) {
    lines.push('requiredTools:');
    for (const t of metadata.requiredTools) lines.push(`  - "${t}"`);
  }
  if (metadata.requiredMcpServers && metadata.requiredMcpServers.length > 0) {
    lines.push('requiredMcpServers:');
    for (const s of metadata.requiredMcpServers) lines.push(`  - "${s}"`);
  }
  if (metadata.configSchema) {
    lines.push('configSchema:');
    for (const [key, field] of Object.entries(metadata.configSchema)) {
      lines.push(`  ${key}:`);
      lines.push(`    type: ${field.type}`);
      lines.push(`    label: "${field.label}"`);
      if (field.description) lines.push(`    description: "${field.description}"`);
      if (field.default !== undefined) lines.push(`    default: "${field.default}"`);
      if (field.required) lines.push(`    required: true`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(`# ${metadata.name}`);
  lines.push('');
  lines.push(metadata.description);
  lines.push('');

  if (promptTemplate) {
    lines.push('## Prompt Template');
    lines.push('');
    lines.push(promptTemplate);
    lines.push('');
  }

  if (rules && rules.length > 0) {
    lines.push('## Rules');
    lines.push('');
    for (const r of rules) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Workspace path helper
// ---------------------------------------------------------------------------

function getWorkspacePath(): string {
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'workspacePath'").get() as any;
    if (row) return JSON.parse(row.value);
  } catch {}
  return '.';
}

// ---------------------------------------------------------------------------
// Registry Cache
// ---------------------------------------------------------------------------

interface RegistryEntry {
  metadata: SkillMetadata;
  content: string;
  raw: string;
  promptTemplate?: string;
  rules?: string[];
}

let listCache: { skills: RegistryEntry[]; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchRegistrySkills(): Promise<RegistryEntry[]> {
  if (listCache && Date.now() - listCache.ts < CACHE_TTL_MS) {
    return listCache.skills;
  }

  // List skill directories from GitHub
  const dirsRes = await fetch(
    `${GITHUB_API}/repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${REGISTRY_SKILLS_PATH}`,
    { headers: GITHUB_HEADERS },
  );
  if (!dirsRes.ok) throw new Error(`GitHub API error ${dirsRes.status}`);
  const dirs = (await dirsRes.json()) as any[];

  const skillDirs = dirs.filter((d: any) => d.type === 'dir');

  // Fetch SKILL.md for each directory in parallel (limit concurrency)
  const CONCURRENCY = 5;
  const skills: RegistryEntry[] = [];

  for (let i = 0; i < skillDirs.length; i += CONCURRENCY) {
    const batch = skillDirs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (dir: any) => {
        const rawUrl = `${RAW_GITHUB}/${REGISTRY_OWNER}/${REGISTRY_REPO}/main/${REGISTRY_SKILLS_PATH}/${dir.name}/SKILL.md`;
        const res = await fetch(rawUrl, { headers: GITHUB_HEADERS });
        if (!res.ok) return null;
        const raw = await res.text();
        const parsed = parseSkillMd(raw, dir.name);
        return {
          metadata: parsed.metadata,
          content: parsed.body,
          raw,
          promptTemplate: parsed.promptTemplate,
          rules: parsed.rules,
        } as RegistryEntry;
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

// ---------------------------------------------------------------------------
// Bundled Skills
// ---------------------------------------------------------------------------

const BUNDLED_SKILLS: RegistryEntry[] = [
  {
    metadata: {
      id: 'code-review',
      name: 'Code Review',
      description:
        'Comprehensive code review with security, performance, and best practices analysis',
      version: '1.0.0',
      author: 'E Team',
      category: 'code-generation',
      tags: ['review', 'quality', 'security'],
      compatibility: 'All models',
    },
    content:
      'Performs thorough code review analyzing security vulnerabilities, performance issues, code style, and best practices.',
    raw: `---
name: "Code Review"
description: "Comprehensive code review with security, performance, and best practices analysis"
version: "1.0.0"
author: "E Team"
category: code-generation
tags: [review, quality, security]
compatibility: "All models"
---

# Code Review

Performs thorough code review analyzing security vulnerabilities, performance issues, code style, and best practices.

## Prompt Template

Review the provided code thoroughly. Analyze:

1. **Security**: Look for injection vulnerabilities, authentication issues, data exposure
2. **Performance**: Identify N+1 queries, unnecessary re-renders, memory leaks
3. **Best Practices**: Check naming conventions, error handling, type safety
4. **Maintainability**: Evaluate code organization, documentation, test coverage

Provide specific, actionable feedback with code examples for each issue found.

## Rules

- Always explain the "why" behind each suggestion
- Prioritize issues by severity (critical, warning, info)
- Include positive feedback for well-written code
- Suggest specific fixes, not just problems`,
    promptTemplate: `Review the provided code thoroughly. Analyze:

1. **Security**: Look for injection vulnerabilities, authentication issues, data exposure
2. **Performance**: Identify N+1 queries, unnecessary re-renders, memory leaks
3. **Best Practices**: Check naming conventions, error handling, type safety
4. **Maintainability**: Evaluate code organization, documentation, test coverage

Provide specific, actionable feedback with code examples for each issue found.`,
    rules: [
      'Always explain the "why" behind each suggestion',
      'Prioritize issues by severity (critical, warning, info)',
      'Include positive feedback for well-written code',
      'Suggest specific fixes, not just problems',
    ],
  },
  {
    metadata: {
      id: 'test-generator',
      name: 'Test Generator',
      description: 'Generate comprehensive test suites with edge cases and mocks',
      version: '1.0.0',
      author: 'E Team',
      category: 'testing',
      tags: ['testing', 'unit-tests', 'coverage'],
      compatibility: 'All models',
    },
    content:
      'Generates comprehensive test suites including unit tests, integration tests, and edge case coverage.',
    raw: `---
name: "Test Generator"
description: "Generate comprehensive test suites with edge cases and mocks"
version: "1.0.0"
author: "E Team"
category: testing
tags: [testing, unit-tests, coverage]
compatibility: "All models"
---

# Test Generator

Generates comprehensive test suites including unit tests, integration tests, and edge case coverage.

## Prompt Template

Generate comprehensive tests for the given code:

1. Identify all public functions, methods, and classes
2. For each, generate:
   - Happy path tests
   - Edge case tests (empty inputs, null values, boundary conditions)
   - Error handling tests
   - Mock setup for external dependencies
3. Use the project's existing test framework and patterns
4. Aim for high branch coverage

## Rules

- Follow the project's existing test patterns and framework
- Use descriptive test names that explain the scenario
- Group related tests logically
- Include both positive and negative test cases`,
    promptTemplate: `Generate comprehensive tests for the given code:

1. Identify all public functions, methods, and classes
2. For each, generate:
   - Happy path tests
   - Edge case tests (empty inputs, null values, boundary conditions)
   - Error handling tests
   - Mock setup for external dependencies
3. Use the project's existing test framework and patterns
4. Aim for high branch coverage`,
    rules: [
      "Follow the project's existing test patterns and framework",
      'Use descriptive test names that explain the scenario',
      'Group related tests logically',
      'Include both positive and negative test cases',
    ],
  },
  {
    metadata: {
      id: 'doc-writer',
      name: 'Documentation Writer',
      description: 'Generate clear, comprehensive documentation from code',
      version: '1.0.0',
      author: 'E Team',
      category: 'documentation',
      tags: ['docs', 'readme', 'api-docs'],
      compatibility: 'All models',
    },
    content:
      'Generates clear, well-structured documentation including API docs, README files, and inline comments.',
    raw: `---
name: "Documentation Writer"
description: "Generate clear, comprehensive documentation from code"
version: "1.0.0"
author: "E Team"
category: documentation
tags: [docs, readme, api-docs]
compatibility: "All models"
---

# Documentation Writer

Generates clear, well-structured documentation including API docs, README files, and inline comments.

## Prompt Template

Generate documentation for the provided code:

1. Write a high-level overview explaining the purpose and architecture
2. Document all public APIs with parameters, return types, and examples
3. Include usage examples with common patterns
4. Note any prerequisites, configuration, or setup steps
5. Add troubleshooting tips for common issues

## Rules

- Write for the reader, not the author
- Include practical examples over abstract descriptions
- Keep language clear and jargon-free when possible
- Structure docs with clear headings and navigation`,
    promptTemplate: `Generate documentation for the provided code:

1. Write a high-level overview explaining the purpose and architecture
2. Document all public APIs with parameters, return types, and examples
3. Include usage examples with common patterns
4. Note any prerequisites, configuration, or setup steps
5. Add troubleshooting tips for common issues`,
    rules: [
      'Write for the reader, not the author',
      'Include practical examples over abstract descriptions',
      'Keep language clear and jargon-free when possible',
      'Structure docs with clear headings and navigation',
    ],
  },
  {
    metadata: {
      id: 'refactor-assistant',
      name: 'Refactor Assistant',
      description: 'Intelligent code refactoring with pattern detection and modernization',
      version: '1.0.0',
      author: 'E Team',
      category: 'refactoring',
      tags: ['refactoring', 'cleanup', 'modernization'],
      compatibility: 'All models',
    },
    content:
      'Analyzes code for refactoring opportunities and provides safe, incremental improvement suggestions.',
    raw: `---
name: "Refactor Assistant"
description: "Intelligent code refactoring with pattern detection and modernization"
version: "1.0.0"
author: "E Team"
category: refactoring
tags: [refactoring, cleanup, modernization]
compatibility: "All models"
---

# Refactor Assistant

Analyzes code for refactoring opportunities and provides safe, incremental improvement suggestions.

## Prompt Template

Analyze the code for refactoring opportunities:

1. Identify code smells (duplication, long methods, deep nesting)
2. Suggest design pattern applications where appropriate
3. Modernize deprecated APIs and language features
4. Improve naming for clarity
5. Extract reusable components/functions

Apply refactoring incrementally, preserving existing behavior.

## Rules

- Never change behavior while refactoring
- Make small, reviewable changes
- Explain the benefit of each refactoring
- Preserve all existing tests`,
    promptTemplate: `Analyze the code for refactoring opportunities:

1. Identify code smells (duplication, long methods, deep nesting)
2. Suggest design pattern applications where appropriate
3. Modernize deprecated APIs and language features
4. Improve naming for clarity
5. Extract reusable components/functions

Apply refactoring incrementally, preserving existing behavior.`,
    rules: [
      'Never change behavior while refactoring',
      'Make small, reviewable changes',
      'Explain the benefit of each refactoring',
      'Preserve all existing tests',
    ],
  },
  {
    metadata: {
      id: 'debug-detective',
      name: 'Debug Detective',
      description: 'Systematic debugging with root cause analysis and fix suggestions',
      version: '1.0.0',
      author: 'E Team',
      category: 'debugging',
      tags: ['debugging', 'troubleshooting', 'errors'],
      compatibility: 'All models',
    },
    content:
      'Systematic approach to debugging that identifies root causes and suggests targeted fixes.',
    raw: `---
name: "Debug Detective"
description: "Systematic debugging with root cause analysis and fix suggestions"
version: "1.0.0"
author: "E Team"
category: debugging
tags: [debugging, troubleshooting, errors]
compatibility: "All models"
---

# Debug Detective

Systematic approach to debugging that identifies root causes and suggests targeted fixes.

## Prompt Template

Debug the reported issue systematically:

1. **Reproduce**: Understand the exact steps to reproduce
2. **Isolate**: Narrow down the affected code path
3. **Analyze**: Examine the root cause (not just symptoms)
4. **Fix**: Propose a minimal, targeted fix
5. **Verify**: Suggest how to verify the fix works
6. **Prevent**: Recommend tests or guards to prevent regression

## Rules

- Always identify the root cause, not just symptoms
- Propose the minimal fix that resolves the issue
- Include a test case that would catch the regression
- Document what caused the bug for team learning`,
    promptTemplate: `Debug the reported issue systematically:

1. **Reproduce**: Understand the exact steps to reproduce
2. **Isolate**: Narrow down the affected code path
3. **Analyze**: Examine the root cause (not just symptoms)
4. **Fix**: Propose a minimal, targeted fix
5. **Verify**: Suggest how to verify the fix works
6. **Prevent**: Recommend tests or guards to prevent regression`,
    rules: [
      'Always identify the root cause, not just symptoms',
      'Propose the minimal fix that resolves the issue',
      'Include a test case that would catch the regression',
      'Document what caused the bug for team learning',
    ],
  },
];

// ---------------------------------------------------------------------------
// Local skill discovery helpers
// ---------------------------------------------------------------------------

async function discoverLocalSkills(basePath: string, _tier: SkillTier): Promise<RegistryEntry[]> {
  const skills: RegistryEntry[] = [];
  try {
    const entries = await readdir(basePath);
    for (const entry of entries) {
      try {
        const skillFile = join(basePath, entry, 'SKILL.md');
        await stat(skillFile);
        const raw = await readFile(skillFile, 'utf-8');
        const parsed = parseSkillMd(raw, entry);
        skills.push({
          metadata: parsed.metadata,
          content: parsed.body,
          raw,
          promptTemplate: parsed.promptTemplate,
          rules: parsed.rules,
        });
      } catch {
        // Not a valid skill directory
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return skills;
}

/**
 * Get installed skill records from the database
 */
function getInstalledRecords(workspacePath?: string): any[] {
  const db = getDb();
  ensureSkillsTable();
  if (workspacePath) {
    return db
      .query('SELECT * FROM installed_skills WHERE workspace_path = ? OR workspace_path IS NULL')
      .all(workspacePath) as any[];
  }
  return db.query('SELECT * FROM installed_skills').all() as any[];
}

/**
 * Convert a registry entry + install info to a SkillSummary
 */
function toSummary(
  entry: RegistryEntry,
  tier: SkillTier,
  installed: boolean,
  activated: boolean,
): SkillSummary {
  return {
    id: entry.metadata.id,
    name: entry.metadata.name,
    description: entry.metadata.description,
    version: entry.metadata.version,
    author: entry.metadata.author,
    category: entry.metadata.category,
    tags: entry.metadata.tags,
    license: entry.metadata.license,
    compatibility: entry.metadata.compatibility,
    installs: entry.metadata.installs,
    stars: entry.metadata.stars,
    tier,
    installed,
    activated,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /browse — search/browse the marketplace
app.get('/browse', async (c) => {
  try {
    const query = (c.req.query('query') || '').toLowerCase();
    const category = c.req.query('category') as SkillCategory | 'all' | undefined;
    const sortBy = (c.req.query('sortBy') || 'popularity') as SkillSortBy;
    const tierFilter = c.req.query('tier') as SkillTier | 'all' | undefined;
    const page = parseInt(c.req.query('page') || '1', 10);
    const pageSize = parseInt(c.req.query('pageSize') || '50', 10);
    const workspacePath = c.req.query('workspacePath') || getWorkspacePath();

    ensureSkillsTable();
    const installedRecords = getInstalledRecords(workspacePath);
    const installedIds = new Set(installedRecords.map((r: any) => r.skill_id));
    const activatedIds = new Set(
      installedRecords.filter((r: any) => r.activated).map((r: any) => r.skill_id),
    );

    // Collect all skills from all sources
    let allSkills: SkillSummary[] = [];

    // 1. Bundled skills
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'bundled') {
      for (const skill of BUNDLED_SKILLS) {
        allSkills.push(toSummary(skill, 'bundled', true, activatedIds.has(skill.metadata.id)));
      }
    }

    // 2. Managed skills (from ~/.e/skills/)
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'managed') {
      const managedDir = join(homedir(), '.e', 'skills');
      const managed = await discoverLocalSkills(managedDir, 'managed');
      for (const skill of managed) {
        allSkills.push(
          toSummary(
            skill,
            'managed',
            installedIds.has(skill.metadata.id),
            activatedIds.has(skill.metadata.id),
          ),
        );
      }
    }

    // 3. Workspace skills
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'workspace') {
      for (const parent of ['.e', '.claude']) {
        const wsDir = join(workspacePath, parent, 'skills');
        const workspace = await discoverLocalSkills(wsDir, 'workspace');
        for (const skill of workspace) {
          // Avoid duplicates
          if (!allSkills.find((s) => s.id === skill.metadata.id)) {
            allSkills.push(
              toSummary(skill, 'workspace', true, activatedIds.has(skill.metadata.id)),
            );
          }
        }
      }
    }

    // 4. Registry skills (remote, not yet installed)
    if (!tierFilter || tierFilter === 'all' || tierFilter === 'managed') {
      try {
        const registrySkills = await fetchRegistrySkills();
        for (const skill of registrySkills) {
          // Only add if not already present locally
          if (
            !allSkills.find((s) => s.id === skill.metadata.id || s.name === skill.metadata.name)
          ) {
            allSkills.push(
              toSummary(
                skill,
                'managed',
                installedIds.has(skill.metadata.id),
                activatedIds.has(skill.metadata.id),
              ),
            );
          }
        }
      } catch {
        // Registry unavailable, continue with local skills
      }
    }

    // Apply search filter
    if (query) {
      allSkills = allSkills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.tags.some((t) => t.toLowerCase().includes(query)) ||
          s.category.toLowerCase().includes(query),
      );
    }

    // Apply category filter
    if (category && category !== 'all') {
      allSkills = allSkills.filter((s) => s.category === category);
    }

    // Sort
    switch (sortBy) {
      case 'popularity':
        allSkills.sort((a, b) => (b.installs || 0) - (a.installs || 0));
        // Put installed/bundled first
        allSkills.sort((a, b) => {
          if (a.installed && !b.installed) return -1;
          if (!a.installed && b.installed) return 1;
          if (a.tier === 'bundled' && b.tier !== 'bundled') return -1;
          if (a.tier !== 'bundled' && b.tier === 'bundled') return 1;
          return 0;
        });
        break;
      case 'name':
        allSkills.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'newest':
        allSkills.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case 'updated':
        allSkills.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
    }

    // Paginate
    const total = allSkills.length;
    const start = (page - 1) * pageSize;
    const paged = allSkills.slice(start, start + pageSize);

    const response: SkillBrowseResponse = {
      skills: paged,
      total,
      page,
      pageSize,
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to browse skills: ${msg}` }, 500);
  }
});

// GET /skill/:id — get full skill details
app.get('/skill/:id', async (c) => {
  const id = c.req.param('id');
  const workspacePath = c.req.query('workspacePath') || getWorkspacePath();
  try {
    ensureSkillsTable();

    // Check bundled
    const bundled = BUNDLED_SKILLS.find((s) => s.metadata.id === id);
    if (bundled) {
      const installedRecords = getInstalledRecords(workspacePath);
      const record = installedRecords.find((r: any) => r.skill_id === id);
      const skill: MarketplaceSkill = {
        metadata: bundled.metadata,
        content: bundled.content,
        rawContent: bundled.raw,
        tier: 'bundled',
        installed: true,
        activated: record ? !!record.activated : true,
        updatedAt: Date.now(),
        promptTemplate: bundled.promptTemplate,
        rules: bundled.rules,
        config: record?.config ? JSON.parse(record.config) : undefined,
      };
      return c.json({ ok: true, data: skill });
    }

    // Check local (managed + workspace)
    const dirs = [
      { path: join(homedir(), '.e', 'skills'), tier: 'managed' as SkillTier },
      { path: join(workspacePath, '.e', 'skills'), tier: 'workspace' as SkillTier },
      { path: join(workspacePath, '.claude', 'skills'), tier: 'workspace' as SkillTier },
    ];

    for (const { path: dir, tier } of dirs) {
      try {
        const skillFile = join(dir, id, 'SKILL.md');
        await stat(skillFile);
        const raw = await readFile(skillFile, 'utf-8');
        const parsed = parseSkillMd(raw, id);
        const installedRecords = getInstalledRecords(workspacePath);
        const record = installedRecords.find((r: any) => r.skill_id === id);

        const skill: MarketplaceSkill = {
          metadata: parsed.metadata,
          content: parsed.body,
          rawContent: raw,
          tier,
          installedPath: skillFile,
          installed: true,
          activated: record ? !!record.activated : true,
          updatedAt: Date.now(),
          installedAt: record?.installed_at,
          pinnedVersion: record?.pinned_version || undefined,
          config: record?.config ? JSON.parse(record.config) : undefined,
          promptTemplate: parsed.promptTemplate,
          rules: parsed.rules,
        };
        return c.json({ ok: true, data: skill });
      } catch {
        // Not found in this dir
      }
    }

    // Check registry
    try {
      const registrySkills = await fetchRegistrySkills();
      const registrySkill = registrySkills.find(
        (s) => s.metadata.id === id || s.metadata.name === id,
      );
      if (registrySkill) {
        const skill: MarketplaceSkill = {
          metadata: registrySkill.metadata,
          content: registrySkill.content,
          rawContent: registrySkill.raw,
          tier: 'managed',
          installed: false,
          activated: false,
          updatedAt: Date.now(),
          promptTemplate: registrySkill.promptTemplate,
          rules: registrySkill.rules,
        };
        return c.json({ ok: true, data: skill });
      }
    } catch {
      // Registry unavailable
    }

    return c.json({ ok: false, error: 'Skill not found' }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// POST /install — install a skill
app.post('/install', async (c) => {
  const body = await c.req.json();
  const {
    skillId,
    skillName,
    tier = 'workspace',
    workspacePath: reqWorkspacePath,
    pinnedVersion,
  } = body;

  const resolvedId = skillId || skillName;
  if (!resolvedId) return c.json({ ok: false, error: 'skillId or skillName required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();

    // Find the skill content
    let skillContent: string | null = null;
    let parsedSkill: ParsedSkillMd | null = null;

    // Check bundled first
    const bundled = BUNDLED_SKILLS.find(
      (s) => s.metadata.id === resolvedId || s.metadata.name === resolvedId,
    );
    if (bundled) {
      skillContent = bundled.raw;
      parsedSkill = parseSkillMd(bundled.raw, resolvedId);
    }

    // Then check registry
    if (!skillContent) {
      const registrySkills = await fetchRegistrySkills();
      const found = registrySkills.find(
        (s) => s.metadata.id === resolvedId || s.metadata.name === resolvedId,
      );
      if (found) {
        skillContent = found.raw;
        parsedSkill = parseSkillMd(found.raw, resolvedId);
      }
    }

    if (!skillContent || !parsedSkill) {
      return c.json({ ok: false, error: `Skill '${resolvedId}' not found` }, 404);
    }

    const installId = parsedSkill.metadata.id || resolvedId;

    // Determine install path
    let installDir: string;
    let installTier = tier as SkillTier;
    if (installTier === 'managed') {
      installDir = join(homedir(), '.e', 'skills', installId);
    } else {
      installDir = join(workspacePath, '.e', 'skills', installId);
      installTier = 'workspace';
    }

    // Write skill file
    await mkdir(installDir, { recursive: true });
    const skillFile = join(installDir, 'SKILL.md');
    await writeFile(skillFile, skillContent, 'utf-8');

    // Also write to .claude/skills for backward compat (workspace only)
    if (installTier === 'workspace') {
      const claudeDir = join(workspacePath, '.claude', 'skills', installId);
      await mkdir(claudeDir, { recursive: true });
      await writeFile(join(claudeDir, 'SKILL.md'), skillContent, 'utf-8');
    }

    // Record in database
    const db = getDb();
    const now = Date.now();
    const existingRecord = db
      .query(
        'SELECT id FROM installed_skills WHERE skill_id = ? AND (workspace_path = ? OR (workspace_path IS NULL AND ? IS NULL))',
      )
      .get(
        installId,
        installTier === 'workspace' ? workspacePath : null,
        installTier === 'workspace' ? workspacePath : null,
      ) as any;

    if (existingRecord) {
      db.query(
        'UPDATE installed_skills SET version = ?, pinned_version = ?, installed_path = ?, activated = 1, updated_at = ? WHERE id = ?',
      ).run(parsedSkill.metadata.version, pinnedVersion || null, skillFile, now, existingRecord.id);
    } else {
      const id = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      db.query(
        'INSERT INTO installed_skills (id, skill_id, tier, version, pinned_version, installed_path, workspace_path, activated, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      ).run(
        id,
        installId,
        installTier,
        parsedSkill.metadata.version,
        pinnedVersion || null,
        skillFile,
        installTier === 'workspace' ? workspacePath : null,
        now,
        now,
      );
    }

    return c.json({ ok: true, data: { path: skillFile, skillId: installId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to install skill: ${msg}` }, 500);
  }
});

// POST /uninstall — remove an installed skill
app.post('/uninstall', async (c) => {
  const body = await c.req.json();
  const { skillId, workspacePath: reqWorkspacePath } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();
    const db = getDb();

    // Find the installed record
    const record = db
      .query('SELECT * FROM installed_skills WHERE skill_id = ?')
      .get(skillId) as any;

    if (!record) {
      return c.json({ ok: false, error: 'Skill not installed' }, 404);
    }

    // Cannot uninstall bundled skills
    if (record.tier === 'bundled') {
      return c.json({ ok: false, error: 'Cannot uninstall bundled skills' }, 400);
    }

    // Remove skill files
    const paths = [
      join(homedir(), '.e', 'skills', skillId),
      join(workspacePath, '.e', 'skills', skillId),
      join(workspacePath, '.claude', 'skills', skillId),
    ];

    for (const p of paths) {
      try {
        await rm(p, { recursive: true, force: true });
      } catch {
        // Directory may not exist
      }
    }

    // Remove database record
    db.query('DELETE FROM installed_skills WHERE skill_id = ?').run(skillId);

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to uninstall: ${msg}` }, 500);
  }
});

// GET /installed — list installed skills
app.get('/installed', async (c) => {
  const workspacePath = c.req.query('workspacePath') || getWorkspacePath();
  try {
    ensureSkillsTable();

    const installedRecords = getInstalledRecords(workspacePath);
    const skills: SkillSummary[] = [];

    // Bundled skills are always "installed"
    for (const bundled of BUNDLED_SKILLS) {
      const record = installedRecords.find((r: any) => r.skill_id === bundled.metadata.id);
      skills.push(toSummary(bundled, 'bundled', true, record ? !!record.activated : true));
    }

    // Discover from filesystem
    const dirs = [
      { path: join(homedir(), '.e', 'skills'), tier: 'managed' as SkillTier },
      { path: join(workspacePath, '.e', 'skills'), tier: 'workspace' as SkillTier },
      { path: join(workspacePath, '.claude', 'skills'), tier: 'workspace' as SkillTier },
    ];

    for (const { path: dir, tier } of dirs) {
      const localSkills = await discoverLocalSkills(dir, tier);
      for (const skill of localSkills) {
        if (!skills.find((s) => s.id === skill.metadata.id)) {
          const record = installedRecords.find((r: any) => r.skill_id === skill.metadata.id);
          skills.push(toSummary(skill, tier, true, record ? !!record.activated : true));
        }
      }
    }

    return c.json({ ok: true, data: skills });
  } catch {
    return c.json({ ok: true, data: [] });
  }
});

// POST /create — create a new workspace skill
app.post('/create', async (c) => {
  const body = await c.req.json();
  const {
    name,
    description,
    category = 'other',
    tags = [],
    promptTemplate = '',
    rules = [],
    requiredTools = [],
    requiredMcpServers = [],
    workspacePath: reqWorkspacePath,
  } = body;

  if (!name) return c.json({ ok: false, error: 'name required' }, 400);
  if (!description) return c.json({ ok: false, error: 'description required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();

    // Generate ID from name
    const skillId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const metadata: SkillMetadata = {
      id: skillId,
      name,
      description,
      version: '1.0.0',
      category,
      tags,
      requiredTools: requiredTools.length > 0 ? requiredTools : undefined,
      requiredMcpServers: requiredMcpServers.length > 0 ? requiredMcpServers : undefined,
    };

    // Generate SKILL.md content
    const skillMdContent = generateSkillMd(
      metadata,
      promptTemplate || undefined,
      rules.length > 0 ? rules : undefined,
    );

    // Write to workspace .e/skills/
    const skillDir = join(workspacePath, '.e', 'skills', skillId);
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, skillMdContent, 'utf-8');

    // Also write to .claude/skills/ for backward compat
    const claudeDir = join(workspacePath, '.claude', 'skills', skillId);
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, 'SKILL.md'), skillMdContent, 'utf-8');

    // Record in database
    const db = getDb();
    const now = Date.now();
    const id = `skill-${now}-${Math.random().toString(36).slice(2, 8)}`;
    db.query(
      'INSERT INTO installed_skills (id, skill_id, tier, version, installed_path, workspace_path, activated, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(id, skillId, 'workspace', '1.0.0', skillFile, workspacePath, now, now);

    return c.json({ ok: true, data: { skillId, path: skillFile } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `Failed to create skill: ${msg}` }, 500);
  }
});

// PATCH /config — update skill configuration
app.patch('/config', async (c) => {
  const body = await c.req.json();
  const { skillId, config } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  try {
    ensureSkillsTable();
    const db = getDb();
    const now = Date.now();
    db.query('UPDATE installed_skills SET config = ?, updated_at = ? WHERE skill_id = ?').run(
      JSON.stringify(config),
      now,
      skillId,
    );

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// PATCH /activate — activate or deactivate a skill
app.patch('/activate', async (c) => {
  const body = await c.req.json();
  const { skillId, activated, workspacePath: reqWorkspacePath } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  const workspacePath = reqWorkspacePath || getWorkspacePath();

  try {
    ensureSkillsTable();
    const db = getDb();
    const now = Date.now();

    // Check if record exists; if not, create one (e.g. for bundled skills)
    const record = db
      .query('SELECT id FROM installed_skills WHERE skill_id = ?')
      .get(skillId) as any;
    if (record) {
      db.query('UPDATE installed_skills SET activated = ?, updated_at = ? WHERE skill_id = ?').run(
        activated ? 1 : 0,
        now,
        skillId,
      );
    } else {
      // Create a record for activation tracking (bundled/discovered skills)
      const id = `skill-${now}-${Math.random().toString(36).slice(2, 8)}`;
      db.query(
        'INSERT INTO installed_skills (id, skill_id, tier, version, installed_path, workspace_path, activated, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, skillId, 'bundled', '1.0.0', '', workspacePath, activated ? 1 : 0, now, now);
    }

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// PATCH /pin-version — pin or unpin version for managed skill
app.patch('/pin-version', async (c) => {
  const body = await c.req.json();
  const { skillId, pinnedVersion } = body;
  if (!skillId) return c.json({ ok: false, error: 'skillId required' }, 400);

  try {
    ensureSkillsTable();
    const db = getDb();
    const now = Date.now();
    db.query(
      'UPDATE installed_skills SET pinned_version = ?, updated_at = ? WHERE skill_id = ?',
    ).run(pinnedVersion || null, now, skillId);

    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// POST /check-updates — check for updates to managed skills
app.post('/check-updates', async (c) => {
  try {
    ensureSkillsTable();
    const db = getDb();
    const managedRecords = db
      .query("SELECT * FROM installed_skills WHERE tier = 'managed' AND pinned_version IS NULL")
      .all() as any[];

    if (managedRecords.length === 0) {
      return c.json({ ok: true, data: { updates: [] } });
    }

    const registrySkills = await fetchRegistrySkills();
    const updates: Array<{
      skillId: string;
      currentVersion: string;
      latestVersion: string;
    }> = [];

    for (const record of managedRecords) {
      const registrySkill = registrySkills.find(
        (s) => s.metadata.id === record.skill_id || s.metadata.name === record.skill_id,
      );
      if (registrySkill && registrySkill.metadata.version !== record.version) {
        updates.push({
          skillId: record.skill_id,
          currentVersion: record.version,
          latestVersion: registrySkill.metadata.version,
        });

        // Auto-update: overwrite the installed file
        if (record.installed_path) {
          try {
            const dir = record.installed_path.replace(/\/SKILL\.md$/, '');
            await mkdir(dir, { recursive: true });
            await writeFile(record.installed_path, registrySkill.raw, 'utf-8');
            db.query('UPDATE installed_skills SET version = ?, updated_at = ? WHERE id = ?').run(
              registrySkill.metadata.version,
              Date.now(),
              record.id,
            );
          } catch {
            // Failed to update file
          }
        }
      }
    }

    return c.json({ ok: true, data: { updates } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// GET /suggest — suggest skills for a query/capability gap
app.get('/suggest', async (c) => {
  const query = (c.req.query('query') || '').toLowerCase();
  if (!query) return c.json({ ok: true, data: [] });

  try {
    // Search across all available skills
    const allSkills: Array<{ metadata: SkillMetadata; score: number }> = [];

    // Search bundled
    for (const skill of BUNDLED_SKILLS) {
      const score = calculateRelevanceScore(skill.metadata, query);
      if (score > 0) allSkills.push({ metadata: skill.metadata, score });
    }

    // Search registry
    try {
      const registrySkills = await fetchRegistrySkills();
      for (const skill of registrySkills) {
        const score = calculateRelevanceScore(skill.metadata, query);
        if (score > 0) allSkills.push({ metadata: skill.metadata, score });
      }
    } catch {
      // Registry unavailable
    }

    // Sort by relevance and return top suggestions
    allSkills.sort((a, b) => b.score - a.score);
    const suggestions = allSkills.slice(0, 5).map((s) => ({
      skillId: s.metadata.id,
      skillName: s.metadata.name,
      reason: `Matches "${query}" — ${s.metadata.description}`,
      confidence: Math.min(s.score / 10, 1),
    }));

    return c.json({ ok: true, data: suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// GET /bundled — list bundled skills
app.get('/bundled', (c) => {
  const skills = BUNDLED_SKILLS.map((s) => toSummary(s, 'bundled', true, true));
  return c.json({ ok: true, data: skills });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateRelevanceScore(metadata: SkillMetadata, query: string): number {
  let score = 0;
  const q = query.toLowerCase();

  if (metadata.name.toLowerCase().includes(q)) score += 5;
  if (metadata.description.toLowerCase().includes(q)) score += 3;
  if (metadata.category.toLowerCase().includes(q)) score += 2;
  for (const tag of metadata.tags) {
    if (tag.toLowerCase().includes(q)) score += 2;
  }

  // Keyword matching
  const keywords = q.split(/\s+/);
  for (const kw of keywords) {
    if (kw.length < 2) continue;
    if (metadata.name.toLowerCase().includes(kw)) score += 1;
    if (metadata.description.toLowerCase().includes(kw)) score += 1;
    for (const tag of metadata.tags) {
      if (tag.toLowerCase().includes(kw)) score += 1;
    }
  }

  return score;
}

export { app as skillsRegistryRoutes };
