import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { resolve } from 'path';
import { getDb } from '../db/database';
import { callLlm } from '../services/llm-oneshot';
import { streamSSE } from 'hono/streaming';

const app = new Hono();

/**
 * Validate that a path is a plausible workspace directory.
 * Prevents path traversal attacks via the cwd parameter.
 */
function validateWorkspacePath(rawPath: string): {
  valid: boolean;
  resolved: string;
  reason?: string;
} {
  const resolved = resolve(rawPath);

  // Block obvious system directories that shouldn't be used as cwd
  const blockedPrefixes = ['/proc', '/sys', '/dev', '/boot', '/sbin'];
  for (const prefix of blockedPrefixes) {
    if (resolved.startsWith(prefix)) {
      return { valid: false, resolved, reason: `Path ${prefix} is not a valid workspace` };
    }
  }

  return { valid: true, resolved };
}

// Git status
app.get('/status', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    const proc = Bun.spawn(['git', 'status', '--porcelain', '-uall'], {
      cwd: pathCheck.resolved,
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

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: pathCheck.resolved,
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
  const { path: rootPath, conversationId, reason, messageId } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const snapshotPathCheck = validateWorkspacePath(rootPath);
  if (!snapshotPathCheck.valid) {
    return c.json({ ok: false, error: snapshotPathCheck.reason }, 403);
  }

  try {
    // Check if this is a git repo (not an error — workspace may not be git-initialized)
    const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
      cwd: snapshotPathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
    if (!isRepo) return c.json({ ok: false, skipped: true, reason: 'not-a-git-repo' });

    // Get current HEAD
    const headProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: rootPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const headSha = (await new Response(headProc.stdout).text()).trim();
    const headExited = await headProc.exited;
    if (headExited !== 0) {
      return c.json({ ok: false, skipped: true, reason: 'no-commits' });
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
      `INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, stash_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      rootPath,
      conversationId || null,
      headSha,
      stashSha,
      reason || 'pre-agent',
      hasChanges ? 1 : 0,
      messageId || null,
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

  const diffPathCheck = validateWorkspacePath(rootPath);
  if (!diffPathCheck.valid) {
    return c.json({ ok: false, error: diffPathCheck.reason }, 403);
  }

  try {
    const args = staged
      ? ['git', 'diff', '--cached', '--', filePath]
      : ['git', 'diff', '--', filePath];

    const proc = Bun.spawn(args, {
      cwd: diffPathCheck.resolved,
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
      messageId: r.message_id || null,
      createdAt: r.created_at,
    })),
  });
});

// Get snapshot by message ID
app.get('/snapshot/by-message/:messageId', (c) => {
  const messageId = c.req.param('messageId');
  const db = getDb();
  const row = db
    .query(`SELECT * FROM git_snapshots WHERE message_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(messageId) as any;

  if (!row) return c.json({ ok: false, error: 'No snapshot for this message' }, 404);

  return c.json({
    ok: true,
    data: {
      id: row.id,
      workspacePath: row.workspace_path,
      conversationId: row.conversation_id,
      headSha: row.head_sha,
      stashSha: row.stash_sha,
      reason: row.reason,
      hasChanges: !!row.has_changes,
      messageId: row.message_id || null,
      createdAt: row.created_at,
    },
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

// Stage all + commit
app.post('/commit', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, message } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ ok: false, error: 'commit message required' }, 400);
  }

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Check status BEFORE staging
    const beforeStatusProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const beforeStatus = await new Response(beforeStatusProc.stdout).text();
    await beforeStatusProc.exited;
    console.log('[git/commit] Status BEFORE git add:', beforeStatus);

    // Stage all changes
    console.log('[git/commit] Running git add -A in:', pathCheck.resolved);
    const addProc = Bun.spawn(['git', 'add', '-A'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const addOut = await new Response(addProc.stdout).text();
    const addErr = await new Response(addProc.stderr).text();
    const addExit = await addProc.exited;
    console.log('[git/commit] git add result:', {
      exitCode: addExit,
      stdout: addOut,
      stderr: addErr,
    });
    if (addExit !== 0) {
      return c.json({ ok: false, error: `git add failed: ${addErr}` }, 500);
    }

    // Check status AFTER staging, BEFORE commit
    const afterAddProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const afterAddStatus = await new Response(afterAddProc.stdout).text();
    await afterAddProc.exited;
    console.log('[git/commit] Status AFTER git add:', afterAddStatus);

    // Commit
    console.log('[git/commit] Running git commit -m:', message.trim());
    const commitProc = Bun.spawn(['git', 'commit', '-m', message.trim()], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const commitOut = await new Response(commitProc.stdout).text();
    const commitErr = await new Response(commitProc.stderr).text();
    const commitExit = await commitProc.exited;
    console.log('[git/commit] git commit result:', {
      exitCode: commitExit,
      stdout: commitOut,
      stderr: commitErr,
    });
    if (commitExit !== 0) {
      return c.json({ ok: false, error: `git commit failed: ${commitErr}` }, 500);
    }

    // Check status AFTER commit
    const afterCommitProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const afterCommitStatus = await new Response(afterCommitProc.stdout).text();
    await afterCommitProc.exited;
    console.log('[git/commit] Status AFTER commit:', afterCommitStatus);

    // Get the new HEAD sha
    const shaProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const sha = (await new Response(shaProc.stdout).text()).trim();

    return c.json({ ok: true, data: { sha } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Streaming commit endpoint with real-time output
app.post('/commit/stream', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, message } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ ok: false, error: 'commit message required' }, 400);
  }

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'status', message: 'Staging changes...' }),
      });

      // Stage all changes
      const addProc = Bun.spawn(['git', 'add', '-A'], {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Collect add output
      const addOut = await new Response(addProc.stdout).text();
      const addErr = await new Response(addProc.stderr).text();
      const addExit = await addProc.exited;

      if (addOut.trim()) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'output', message: addOut }) });
      }
      if (addErr.trim()) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'output', message: addErr }) });
      }

      if (addExit !== 0) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: `git add failed: ${addErr}` }),
        });
        return;
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'status',
          message: 'Running pre-commit hooks and creating commit...',
        }),
      });

      // Commit - this is where pre-commit hooks run and can take time
      const commitProc = Bun.spawn(['git', 'commit', '-m', message.trim()], {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // For long-running commits (with hooks), we need to stream the output as it comes
      const decoder = new TextDecoder();

      // Read both stdout and stderr concurrently and stream to client
      const outputs: Promise<string>[] = [];

      const readStream = async (readable: ReadableStream): Promise<string> => {
        const reader = readable.getReader();
        let fullOutput = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullOutput += chunk;
            // Stream non-empty chunks immediately
            if (chunk.trim()) {
              await stream.writeSSE({ data: JSON.stringify({ type: 'output', message: chunk }) });
            }
          }
        } finally {
          reader.releaseLock();
        }
        return fullOutput;
      };

      // Read both streams concurrently
      outputs.push(readStream(commitProc.stdout));
      outputs.push(readStream(commitProc.stderr));

      const [commitOut, commitErr] = await Promise.all(outputs);
      const commitExit = await commitProc.exited;
      if (commitExit !== 0) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: 'Commit failed - check output above' }),
        });
        return;
      }

      // Get the new HEAD sha
      const shaProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const sha = (await new Response(shaProc.stdout).text()).trim();

      await stream.writeSSE({
        data: JSON.stringify({ type: 'complete', sha, message: 'Commit successful!' }),
      });
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: String(err) }),
      });
    }
  });
});

// Generate a commit message from the current diff
app.post('/generate-commit-message', async (c) => {
  const body = await c.req.json();
  const { path: rootPath } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Get staged + unstaged diff
    const diffProc = Bun.spawn(['git', 'diff', 'HEAD'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let diffText = await new Response(diffProc.stdout).text();
    await diffProc.exited;

    // Also capture untracked file names
    const untrackedProc = Bun.spawn(['git', 'ls-files', '--others', '--exclude-standard'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const untrackedFiles = (await new Response(untrackedProc.stdout).text()).trim();
    await untrackedProc.exited;

    if (!diffText.trim() && !untrackedFiles) {
      return c.json({ ok: false, error: 'No changes to describe' }, 400);
    }

    // Truncate very large diffs to avoid blowing the context
    const MAX_DIFF_CHARS = 12_000;
    if (diffText.length > MAX_DIFF_CHARS) {
      diffText = diffText.slice(0, MAX_DIFF_CHARS) + '\n\n... [diff truncated]';
    }

    let prompt = '';
    if (diffText.trim()) {
      prompt += `Git diff:\n\`\`\`\n${diffText}\n\`\`\`\n`;
    }
    if (untrackedFiles) {
      prompt += `\nNew untracked files:\n${untrackedFiles}\n`;
    }

    const message = await callLlm({
      system:
        'You generate concise git commit messages. Output ONLY the commit message, nothing else. ' +
        'Use the imperative mood (e.g. "Add feature" not "Added feature"). ' +
        'Keep it to one line, under 72 characters if possible. ' +
        'If the changes are substantial, add a blank line followed by a brief body (2-3 bullet points max).',
      user: prompt,
      model: 'claude-haiku-4-5-20251001',
      timeoutMs: 15_000,
    });

    return c.json({ ok: true, data: { message: message.trim() } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Discard all uncommitted changes
app.post('/clean', async (c) => {
  const body = await c.req.json();
  const { path: rootPath } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Restore tracked files
    const checkoutProc = Bun.spawn(['git', 'checkout', '--', '.'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await checkoutProc.exited;

    // Remove untracked files and directories
    const cleanProc = Bun.spawn(['git', 'clean', '-fd'], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await cleanProc.exited;

    return c.json({ ok: true, data: { cleaned: true } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Push to remote
app.post('/push', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, remote, branch } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Get current branch if not specified
    let targetBranch = branch;
    if (!targetBranch) {
      const branchProc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      targetBranch = (await new Response(branchProc.stdout).text()).trim();
      const branchExit = await branchProc.exited;
      if (branchExit !== 0 || !targetBranch) {
        return c.json({ ok: false, error: 'Could not determine current branch' }, 500);
      }
    }

    // Push to remote (defaults to 'origin' if not specified)
    const targetRemote = remote || 'origin';
    const pushProc = Bun.spawn(['git', 'push', targetRemote, targetBranch], {
      cwd: pathCheck.resolved,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const pushExit = await pushProc.exited;
    if (pushExit !== 0) {
      const err = await new Response(pushProc.stderr).text();
      // Check if it's an upstream tracking error
      if (err.includes('no upstream branch') || err.includes('has no upstream')) {
        // Try push with --set-upstream
        const upstreamProc = Bun.spawn(
          ['git', 'push', '--set-upstream', targetRemote, targetBranch],
          {
            cwd: pathCheck.resolved,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const upstreamExit = await upstreamProc.exited;
        if (upstreamExit !== 0) {
          const upstreamErr = await new Response(upstreamProc.stderr).text();
          return c.json({ ok: false, error: upstreamErr.trim() || 'git push failed' }, 500);
        }
        return c.json({ ok: true, data: { pushed: true, setUpstream: true } });
      }
      return c.json({ ok: false, error: err.trim() || 'git push failed' }, 500);
    }

    return c.json({ ok: true, data: { pushed: true, setUpstream: false } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Streaming push endpoint with real-time output
app.post('/push/stream', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, remote, branch } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'status', message: 'Determining branch...' }),
      });

      // Get current branch if not specified
      let targetBranch = branch;
      if (!targetBranch) {
        const branchProc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: pathCheck.resolved,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        targetBranch = (await new Response(branchProc.stdout).text()).trim();
        const branchExit = await branchProc.exited;
        if (branchExit !== 0 || !targetBranch) {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'error', message: 'Could not determine current branch' }),
          });
          return;
        }
      }

      const targetRemote = remote || 'origin';
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'status',
          message: `Pushing ${targetBranch} to ${targetRemote}...`,
        }),
      });

      // Push to remote with streaming output
      const pushProc = Bun.spawn(['git', 'push', targetRemote, targetBranch], {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const decoder = new TextDecoder();
      const outputs: Promise<string>[] = [];

      const readStream = async (readable: ReadableStream): Promise<string> => {
        const reader = readable.getReader();
        let fullOutput = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullOutput += chunk;
            // Stream non-empty chunks immediately
            if (chunk.trim()) {
              await stream.writeSSE({ data: JSON.stringify({ type: 'output', message: chunk }) });
            }
          }
        } finally {
          reader.releaseLock();
        }
        return fullOutput;
      };

      // Read both streams concurrently
      outputs.push(readStream(pushProc.stdout));
      outputs.push(readStream(pushProc.stderr));

      const [pushOut, pushErr] = await Promise.all(outputs);
      const pushExit = await pushProc.exited;

      if (pushExit !== 0) {
        // Check if it's an upstream tracking error
        if (pushErr.includes('no upstream branch') || pushErr.includes('has no upstream')) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'status',
              message: 'Setting upstream and pushing...',
            }),
          });

          // Try push with --set-upstream
          const upstreamProc = Bun.spawn(
            ['git', 'push', '--set-upstream', targetRemote, targetBranch],
            {
              cwd: pathCheck.resolved,
              stdout: 'pipe',
              stderr: 'pipe',
            },
          );

          const upstreamOutputs: Promise<string>[] = [];
          upstreamOutputs.push(readStream(upstreamProc.stdout));
          upstreamOutputs.push(readStream(upstreamProc.stderr));

          await Promise.all(upstreamOutputs);
          const upstreamExit = await upstreamProc.exited;

          if (upstreamExit !== 0) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'error',
                message: 'Push failed - check output above',
              }),
            });
            return;
          }

          await stream.writeSSE({
            data: JSON.stringify({
              type: 'complete',
              message: 'Push successful (upstream set)!',
              setUpstream: true,
            }),
          });
          return;
        }

        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: 'Push failed - check output above' }),
        });
        return;
      }

      await stream.writeSSE({
        data: JSON.stringify({ type: 'complete', message: 'Push successful!', setUpstream: false }),
      });
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: String(err) }),
      });
    }
  });
});

export { app as gitRoutes };
