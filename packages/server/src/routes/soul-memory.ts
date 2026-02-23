import { Hono } from 'hono';
import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import {
  SOUL_MEMORY_FILES,
  SOUL_MEMORY_MAX_CHARS,
  DEFAULT_SOUL_MEMORY_SETTINGS,
  type SoulMemoryFile,
  type SoulMemoryFileKind,
  type SoulMemoryState,
  type SoulMemorySettings,
  type SoulMemoryUpdateProposal,
} from '@e/shared';
import { getDb } from '../db/database';

const app = new Hono();

/**
 * Read a soul memory file from disk.
 * Returns the SoulMemoryFile state whether or not the file exists.
 */
async function readSoulFile(
  workspacePath: string,
  kind: SoulMemoryFileKind,
  enabled: boolean,
): Promise<SoulMemoryFile> {
  const def = SOUL_MEMORY_FILES.find((f) => f.kind === kind);
  if (!def) {
    return {
      kind,
      path: '',
      exists: false,
      content: '',
      sizeBytes: 0,
      summarized: false,
      lastModified: 0,
      enabled,
    };
  }

  const fullPath = join(workspacePath, def.relativePath);
  try {
    const content = await readFile(fullPath, 'utf-8');
    const s = await stat(fullPath);
    return {
      kind,
      path: fullPath,
      exists: true,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      summarized: false,
      lastModified: s.mtimeMs,
      enabled,
    };
  } catch {
    return {
      kind,
      path: fullPath,
      exists: false,
      content: '',
      sizeBytes: 0,
      summarized: false,
      lastModified: 0,
      enabled,
    };
  }
}

/**
 * Get workspace soul memory settings from the workspaces table.
 */
function getWorkspaceSoulSettings(workspacePath: string): SoulMemorySettings {
  try {
    const db = getDb();
    const row = db.query('SELECT settings FROM workspaces WHERE path = ?').get(workspacePath) as
      | { settings?: string }
      | undefined;
    if (row?.settings) {
      const settings = JSON.parse(row.settings);
      return {
        soulEnabled: settings.soulMemorySoulEnabled ?? DEFAULT_SOUL_MEMORY_SETTINGS.soulEnabled,
        knowledgeEnabled:
          settings.soulMemoryKnowledgeEnabled ?? DEFAULT_SOUL_MEMORY_SETTINGS.knowledgeEnabled,
        toolsEnabled: settings.soulMemoryToolsEnabled ?? DEFAULT_SOUL_MEMORY_SETTINGS.toolsEnabled,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SOUL_MEMORY_SETTINGS };
}

/**
 * Summarize content if it exceeds the max character limit.
 * Uses a simple truncation with a note — could be upgraded to LLM summarization.
 */
function summarizeIfNeeded(content: string): { text: string; summarized: boolean } {
  if (content.length <= SOUL_MEMORY_MAX_CHARS) {
    return { text: content, summarized: false };
  }

  // Smart truncation: keep headers and first paragraph of each section
  const lines = content.split('\n');
  const result: string[] = [];
  let charCount = 0;
  const budget = SOUL_MEMORY_MAX_CHARS - 200; // leave room for truncation notice

  for (const line of lines) {
    if (charCount + line.length > budget) {
      result.push('');
      result.push(
        '> ⚠️ *Content truncated to fit context window. Edit the file to prioritize important sections.*',
      );
      break;
    }
    result.push(line);
    charCount += line.length + 1;
  }

  return { text: result.join('\n'), summarized: true };
}

/**
 * Build the system prompt injection string for soul memory files.
 * This is called from stream.ts during prompt composition.
 */
export async function getSoulMemoryContext(workspacePath: string | null): Promise<string> {
  if (!workspacePath) return '';

  try {
    const settings = getWorkspaceSoulSettings(workspacePath);
    const sections: string[] = [];

    for (const def of SOUL_MEMORY_FILES) {
      // Check if this file kind is enabled
      const enabledKey = `${def.kind}Enabled` as keyof SoulMemorySettings;
      if (!settings[enabledKey]) continue;

      const fullPath = join(workspacePath, def.relativePath);
      try {
        const content = await readFile(fullPath, 'utf-8');
        if (!content.trim()) continue;

        const { text } = summarizeIfNeeded(content.trim());
        sections.push(`### ${def.label} (${def.fileName})\n${text}`);
      } catch {
        // File doesn't exist — skip silently
      }
    }

    if (sections.length === 0) return '';
    return `\n\n## Agent Memory Files\n\n${sections.join('\n\n')}`;
  } catch {
    return '';
  }
}

// ─── REST API Routes ───

/**
 * GET /api/soul-memory?workspacePath=...
 * Returns the state of all soul memory files for a workspace.
 */
app.get('/', async (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const settings = getWorkspaceSoulSettings(workspacePath);
  const files: SoulMemoryFile[] = [];
  let totalInjectionSize = 0;

  for (const def of SOUL_MEMORY_FILES) {
    const enabledKey = `${def.kind}Enabled` as keyof SoulMemorySettings;
    const enabled = settings[enabledKey];
    const file = await readSoulFile(workspacePath, def.kind, enabled);
    files.push(file);
    if (file.exists && file.enabled) {
      totalInjectionSize += file.sizeBytes;
    }
  }

  const state: SoulMemoryState = {
    workspacePath,
    files,
    totalInjectionSize,
  };

  return c.json({ ok: true, data: state });
});

/**
 * GET /api/soul-memory/:kind?workspacePath=...
 * Returns a single soul memory file by kind.
 */
app.get('/:kind', async (c) => {
  const kind = c.req.param('kind') as SoulMemoryFileKind;
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const def = SOUL_MEMORY_FILES.find((f) => f.kind === kind);
  if (!def) {
    return c.json({ ok: false, error: `Unknown memory file kind: ${kind}` }, 400);
  }

  const settings = getWorkspaceSoulSettings(workspacePath);
  const enabledKey = `${kind}Enabled` as keyof SoulMemorySettings;
  const file = await readSoulFile(workspacePath, kind, settings[enabledKey]);

  return c.json({ ok: true, data: file });
});

/**
 * PUT /api/soul-memory/:kind
 * Create or update a soul memory file.
 * Body: { workspacePath, content }
 */
app.put('/:kind', async (c) => {
  const kind = c.req.param('kind') as SoulMemoryFileKind;
  const body = await c.req.json();
  const { workspacePath, content } = body;

  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const def = SOUL_MEMORY_FILES.find((f) => f.kind === kind);
  if (!def) {
    return c.json({ ok: false, error: `Unknown memory file kind: ${kind}` }, 400);
  }

  const fullPath = join(workspacePath, def.relativePath);

  try {
    // Ensure .e/ directory exists
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');

    const s = await stat(fullPath);
    return c.json({
      ok: true,
      data: {
        kind,
        path: fullPath,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
        lastModified: s.mtimeMs,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * POST /api/soul-memory/init/:kind
 * Initialize a soul memory file with default content (if it doesn't already exist).
 * Body: { workspacePath }
 */
app.post('/init/:kind', async (c) => {
  const kind = c.req.param('kind') as SoulMemoryFileKind;
  const body = await c.req.json();
  const { workspacePath } = body;

  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const def = SOUL_MEMORY_FILES.find((f) => f.kind === kind);
  if (!def) {
    return c.json({ ok: false, error: `Unknown memory file kind: ${kind}` }, 400);
  }

  const fullPath = join(workspacePath, def.relativePath);

  // Check if file already exists
  try {
    await stat(fullPath);
    return c.json({ ok: false, error: `${def.fileName} already exists` }, 409);
  } catch {
    // File doesn't exist — create it
  }

  try {
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, def.defaultContent, 'utf-8');

    const s = await stat(fullPath);
    return c.json({
      ok: true,
      data: {
        kind,
        path: fullPath,
        sizeBytes: Buffer.byteLength(def.defaultContent, 'utf-8'),
        lastModified: s.mtimeMs,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * POST /api/soul-memory/propose
 * Agent proposes an update to a soul memory file.
 * Body: { workspacePath, kind, proposedContent, reason, append }
 */
app.post('/propose', async (c) => {
  const body = await c.req.json();
  const { workspacePath, kind, proposedContent, reason, append } =
    body as SoulMemoryUpdateProposal & { workspacePath: string };

  if (!workspacePath || !kind || !proposedContent) {
    return c.json(
      { ok: false, error: 'workspacePath, kind, and proposedContent are required' },
      400,
    );
  }

  const def = SOUL_MEMORY_FILES.find((f) => f.kind === kind);
  if (!def) {
    return c.json({ ok: false, error: `Unknown memory file kind: ${kind}` }, 400);
  }

  const fullPath = join(workspacePath, def.relativePath);

  try {
    await mkdir(dirname(fullPath), { recursive: true });

    let finalContent: string;
    if (append) {
      // Try to read existing content
      let existing = '';
      try {
        existing = await readFile(fullPath, 'utf-8');
      } catch {
        // File doesn't exist yet
      }
      finalContent = existing ? `${existing.trimEnd()}\n\n${proposedContent}` : proposedContent;
    } else {
      finalContent = proposedContent;
    }

    await writeFile(fullPath, finalContent, 'utf-8');

    const s = await stat(fullPath);
    return c.json({
      ok: true,
      data: {
        kind,
        path: fullPath,
        reason,
        sizeBytes: Buffer.byteLength(finalContent, 'utf-8'),
        lastModified: s.mtimeMs,
        action: append ? 'appended' : 'replaced',
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * GET /api/soul-memory/status?workspacePath=...
 * Returns a compact status overview for the /memory command.
 */
app.get('/status/overview', async (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const settings = getWorkspaceSoulSettings(workspacePath);
  const status: Array<{
    kind: SoulMemoryFileKind;
    fileName: string;
    label: string;
    exists: boolean;
    enabled: boolean;
    sizeBytes: number;
    sizeHuman: string;
    lastModified: number;
  }> = [];

  for (const def of SOUL_MEMORY_FILES) {
    const enabledKey = `${def.kind}Enabled` as keyof SoulMemorySettings;
    const enabled = settings[enabledKey];
    const file = await readSoulFile(workspacePath, def.kind, enabled);

    status.push({
      kind: def.kind,
      fileName: def.fileName,
      label: def.label,
      exists: file.exists,
      enabled,
      sizeBytes: file.sizeBytes,
      sizeHuman: formatBytes(file.sizeBytes),
      lastModified: file.lastModified,
    });
  }

  return c.json({ ok: true, data: { workspacePath, files: status } });
});

/** Format bytes to a human-readable string */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { app as soulMemoryRoutes };
