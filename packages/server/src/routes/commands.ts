import { Hono } from 'hono';
import { getDb } from '../db/database';
import { readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import {
  SOUL_MEMORY_FILES,
  DEFAULT_SOUL_MEMORY_SETTINGS,
  type SoulMemorySettings,
} from '@e/shared';

const app = new Hono();

/**
 * Execute a slash command that requires backend processing.
 * Currently supports /compact, /init, /e-init, and /memory.
 */
app.post('/:conversationId/execute', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();
  const { command } = body;

  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  switch (command) {
    case 'compact': {
      // Compact is handled by sending /compact as a message to the CLI
      // The CLI handles this natively via the slash command
      return c.json({ ok: true, data: { action: 'send_message', message: '/compact' } });
    }

    case 'init': {
      // Init creates a CLAUDE.md in the project directory
      const cwd = conv.workspace_path || process.cwd();
      const proc = Bun.spawn(['claude', '/init'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      return c.json({
        ok: exitCode === 0,
        data: { output: output.trim() },
        error: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
      });
    }

    case 'e-init': {
      // Creates an E.md file in the project directory
      const cwd = conv.workspace_path || process.cwd();
      const eMdPath = join(cwd, 'E.md');
      try {
        await stat(eMdPath);
        return c.json({
          ok: false,
          error: 'E.md already exists in this project',
        });
      } catch {
        // File doesn't exist, create it
      }
      const defaultContent = `# E.md — Project Guide\n\n## Overview\n\nDescribe your project here.\n\n## Conventions\n\n- List coding conventions\n- Style guidelines\n- Naming patterns\n\n## Architecture\n\n- Key architectural decisions\n- Important patterns\n\n## Common Patterns\n\n- Frequently used patterns in this codebase\n`;
      await writeFile(eMdPath, defaultContent, 'utf-8');
      return c.json({
        ok: true,
        data: { output: `Created E.md in ${cwd}`, path: eMdPath },
      });
    }

    case 'memory': {
      // /memory — show active soul memory files and their sizes
      const cwd = conv.workspace_path || process.cwd();

      // Get workspace soul memory settings
      let soulSettings: SoulMemorySettings = { ...DEFAULT_SOUL_MEMORY_SETTINGS };
      try {
        const row = db.query('SELECT settings FROM workspaces WHERE path = ?').get(cwd) as
          | { settings?: string }
          | undefined;
        if (row?.settings) {
          const ws = JSON.parse(row.settings);
          soulSettings = {
            soulEnabled: ws.soulMemorySoulEnabled ?? DEFAULT_SOUL_MEMORY_SETTINGS.soulEnabled,
            knowledgeEnabled:
              ws.soulMemoryKnowledgeEnabled ?? DEFAULT_SOUL_MEMORY_SETTINGS.knowledgeEnabled,
            toolsEnabled: ws.soulMemoryToolsEnabled ?? DEFAULT_SOUL_MEMORY_SETTINGS.toolsEnabled,
          };
        }
      } catch {
        // Use defaults
      }

      const lines: string[] = ['## 📝 Agent Memory Files\n'];

      for (const def of SOUL_MEMORY_FILES) {
        const fullPath = join(cwd, def.relativePath);
        const enabledKey = `${def.kind}Enabled` as keyof SoulMemorySettings;
        const enabled = soulSettings[enabledKey];

        let exists = false;
        let sizeBytes = 0;
        try {
          const s = await stat(fullPath);
          exists = true;
          sizeBytes = s.size;
        } catch {
          // File doesn't exist
        }

        const statusIcon = !exists ? '⭕' : enabled ? '✅' : '⏸️';
        const statusText = !exists ? 'not created' : enabled ? 'active' : 'disabled';
        const sizeText = exists ? formatBytes(sizeBytes) : '—';

        lines.push(`${statusIcon} **${def.fileName}** — ${def.description}`);
        lines.push(`   Status: ${statusText} | Size: ${sizeText} | Path: \`${def.relativePath}\``);
        lines.push('');
      }

      // Also show DB-backed workspace memories count
      try {
        const memCount = db
          .query('SELECT COUNT(*) as count FROM workspace_memories WHERE workspace_path = ?')
          .get(cwd) as { count: number };
        lines.push(`---\n📊 **DB-backed workspace memories**: ${memCount.count} entries`);
      } catch {
        // Skip
      }

      lines.push(
        '\n> Use the Settings → Memory tab to enable/disable files, or edit them directly in the file explorer.',
      );

      return c.json({
        ok: true,
        data: {
          action: 'show_message',
          message: lines.join('\n'),
        },
      });
    }

    default:
      return c.json({ ok: false, error: `Unknown command: ${command}` }, 400);
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { app as commandRoutes };
