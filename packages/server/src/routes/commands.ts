import { Hono } from 'hono';
import { getDb } from '../db/database';

const app = new Hono();

/**
 * Execute a slash command that requires backend processing.
 * Currently supports /compact and /init.
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

    default:
      return c.json({ ok: false, error: `Unknown command: ${command}` }, 400);
  }
});

export { app as commandRoutes };
