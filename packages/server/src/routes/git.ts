import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

const app = new Hono();

// Git status
app.get('/status', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  try {
    const proc = Bun.spawn(['git', 'status', '--porcelain', '-uall'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return c.json({ ok: true, data: { isRepo: false, files: [] } });
    }

    const files = output
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const xy = line.slice(0, 2);
        const filePath = line.slice(3).trim();
        // Parse two-letter status code
        let status: string;
        const x = xy[0];
        const y = xy[1];

        if (x === '?' && y === '?')
          status = 'U'; // untracked
        else if (x === 'A' || y === 'A')
          status = 'A'; // added
        else if (x === 'D' || y === 'D')
          status = 'D'; // deleted
        else if (x === 'M' || y === 'M')
          status = 'M'; // modified
        else if (x === 'R')
          status = 'R'; // renamed
        else status = xy.trim() || 'M';

        return {
          path: filePath,
          status,
          staged: x !== ' ' && x !== '?',
        };
      });

    return c.json({ ok: true, data: { isRepo: true, files } });
  } catch {
    return c.json({ ok: true, data: { isRepo: false, files: [] } });
  }
});

// Git branch
app.get('/branch', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  try {
    const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return c.json({ ok: true, data: { branch: '' } });
    }

    return c.json({ ok: true, data: { branch: output.trim() } });
  } catch {
    return c.json({ ok: true, data: { branch: '' } });
  }
});

// Create a snapshot (stash-like) before agent runs
app.post('/snapshot', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, conversationId, reason } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  try {
    // Check if this is a git repo
    const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
    if (!isRepo) return c.json({ ok: false, error: 'Not a git repo' }, 400);

    // Get current HEAD
    const headProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const headSha = (await new Response(headProc.stdout).text()).trim();
    const headExited = await headProc.exited;
    if (headExited !== 0) {
      return c.json({ ok: false, error: 'No commits yet' }, 400);
    }

    // Check if there are changes to snapshot
    const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const statusOutput = (await new Response(statusProc.stdout).text()).trim();
    const hasChanges = statusOutput.length > 0;

    // Create a snapshot tag using git stash create (creates a commit object without modifying working tree)
    let stashSha: string | null = null;
    if (hasChanges) {
      const stashProc = Bun.spawn(['git', 'stash', 'create'], {
        cwd: rootPath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      stashSha = (await new Response(stashProc.stdout).text()).trim() || null;
    }

    // Record snapshot in DB
    const id = nanoid();
    const now = Date.now();
    const db = getDb();
    db.query(
      `INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      rootPath,
      conversationId || null,
      headSha,
      stashSha,
      reason || 'pre-agent',
      hasChanges ? 1 : 0,
      now,
    );

    return c.json({
      ok: true,
      data: { id, headSha, stashSha, hasChanges },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Git diff for a specific file
app.get('/diff', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const filePath = c.req.query('file');
  const staged = c.req.query('staged') === 'true';

  if (!filePath) {
    return c.json({ ok: false, error: 'file parameter required' }, 400);
  }

  try {
    const args = staged
      ? ['git', 'diff', '--cached', '--', filePath]
      : ['git', 'diff', '--', filePath];

    const proc = Bun.spawn(args, {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      return c.json({ ok: false, error: err.trim() || 'git diff failed' }, 500);
    }

    return c.json({ ok: true, data: { diff: output } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// List snapshots for a project
app.get('/snapshots', (c) => {
  const rootPath = c.req.query('path');
  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const db = getDb();
  const rows = db
    .query(`SELECT * FROM git_snapshots WHERE workspace_path = ? ORDER BY created_at DESC LIMIT 50`)
    .all(rootPath) as any[];

  return c.json({
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      workspacePath: r.workspace_path,
      conversationId: r.conversation_id,
      headSha: r.head_sha,
      stashSha: r.stash_sha,
      reason: r.reason,
      hasChanges: !!r.has_changes,
      createdAt: r.created_at,
    })),
  });
});

// Restore a snapshot
app.post('/snapshot/:id/restore', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const snapshot = db.query(`SELECT * FROM git_snapshots WHERE id = ?`).get(id) as any;
  if (!snapshot) return c.json({ ok: false, error: 'Snapshot not found' }, 404);

  try {
    // Reset to the HEAD sha from the snapshot
    const resetProc = Bun.spawn(['git', 'reset', '--hard', snapshot.head_sha], {
      cwd: snapshot.workspace_path,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const resetExit = await resetProc.exited;
    if (resetExit !== 0) {
      const err = await new Response(resetProc.stderr).text();
      return c.json({ ok: false, error: `Reset failed: ${err}` }, 500);
    }

    // If there was a stash, apply it
    if (snapshot.stash_sha) {
      const applyProc = Bun.spawn(['git', 'stash', 'apply', snapshot.stash_sha], {
        cwd: snapshot.workspace_path,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await applyProc.exited;
      // Stash apply can fail if there are conflicts — that's okay, user can resolve
    }

    return c.json({ ok: true, data: { restored: true } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { app as gitRoutes };
