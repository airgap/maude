import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { resolve } from 'path';
import { getDb } from '../db/database';
import { callLlm } from '../services/llm-oneshot';
import { streamSSE } from 'hono/streaming';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers for safe Bun.spawn — always consume piped streams to prevent deadlocks
// ---------------------------------------------------------------------------

/**
 * Run a command and return { stdout, stderr, exitCode }.
 * Reads both stdout and stderr concurrently so the process never blocks
 * waiting on a full pipe buffer (classic deadlock with Bun.spawn 'pipe' mode).
 */
async function run(
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // Read both streams concurrently to avoid deadlock
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/**
 * Run a command and return only the exit code.
 * Discards stdout/stderr safely (inherits to parent process).
 */
async function runExitCode(args: string[], opts: { cwd: string }): Promise<number> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // Consume both to prevent deadlock, even though we discard the content
  await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return proc.exited;
}

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

/**
 * Parse raw git commit failure output into a concise, human-readable summary.
 * Pre-commit hooks (lint-staged, typecheck, tests) produce large output — we
 * extract the key failure reason so the user doesn't have to scroll through it.
 */
function parseCommitFailure(stderr: string, stdout: string): string {
  const combined = `${stderr}\n${stdout}`;

  // Pre-commit hook failure
  if (combined.includes('pre-commit hook') || combined.includes('husky')) {
    // Look for test failures
    const testFailMatch = combined.match(/(\d+)\s+fail/i);
    const testPassMatch = combined.match(/(\d+)\s+pass/i);
    if (testFailMatch) {
      const failCount = testFailMatch[1];
      const passCount = testPassMatch?.[1] ?? '?';
      return `Pre-commit hook failed: ${failCount} test(s) failed (${passCount} passed). Fix failing tests or commit with --no-verify.`;
    }

    // Look for typecheck errors
    if (combined.includes('found') && combined.includes('error')) {
      const errorMatch = combined.match(/found\s+(\d+)\s+error/i);
      if (errorMatch) {
        return `Pre-commit hook failed: ${errorMatch[1]} type error(s). Fix type errors or commit with --no-verify.`;
      }
    }

    // Look for lint-staged / prettier errors
    if (combined.includes('lint-staged') && combined.includes('failed')) {
      return 'Pre-commit hook failed: lint-staged reported formatting errors. Run your formatter and try again.';
    }

    // Generic hook failure
    return 'Pre-commit hook failed. Check the output above for details, or commit with --no-verify to skip hooks.';
  }

  // Exit code from a script
  if (combined.includes('exited with code') || combined.includes('Exited with code')) {
    const exitMatch = combined.match(/[Ee]xited? with code\s+(\d+)/);
    const scriptMatch = combined.match(/script\s+"([^"]+)"\s+exited/);
    if (scriptMatch && exitMatch) {
      return `Commit aborted: "${scriptMatch[1]}" failed (exit ${exitMatch[1]}). Fix the issue or commit with --no-verify.`;
    }
  }

  // Nothing to commit
  if (combined.includes('nothing to commit')) {
    return 'Nothing to commit — working tree clean.';
  }

  // Empty commit message
  if (
    combined.includes('empty commit message') ||
    combined.includes('Aborting commit due to empty')
  ) {
    return 'Commit aborted: empty commit message.';
  }

  // Truncate raw message to something readable
  const firstLine =
    (stderr || stdout)
      .split('\n')
      .filter((l) => l.trim())
      .pop() || 'Unknown error';
  return `git commit failed: ${firstLine.length > 200 ? firstLine.slice(0, 200) + '…' : firstLine}`;
}

// Git status
app.get('/status', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    const { stdout: output, exitCode } = await run(['git', 'status', '--porcelain', '-uall'], {
      cwd: pathCheck.resolved,
    });

    if (exitCode !== 0) {
      return c.json({ ok: true, data: { isRepo: false, files: [] } });
    }

    const files: Array<{ path: string; status: string; staged: boolean }> = [];
    for (const line of output.split('\n')) {
      if (line.length === 0) continue;
      const xy = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      const x = xy[0]; // index (staged) column
      const y = xy[1]; // working-tree (unstaged) column

      if (x === '?' && y === '?') {
        // Untracked file — single entry, not staged
        files.push({ path: filePath, status: 'U', staged: false });
        continue;
      }

      // Emit a staged entry if X indicates a staged change
      if (x !== ' ' && x !== '?') {
        const status = x === 'A' ? 'A' : x === 'D' ? 'D' : x === 'R' ? 'R' : x === 'M' ? 'M' : x;
        files.push({ path: filePath, status, staged: true });
      }

      // Emit an unstaged entry if Y indicates a working-tree change
      if (y !== ' ' && y !== '?') {
        const status = y === 'D' ? 'D' : y === 'M' ? 'M' : y === 'A' ? 'A' : y;
        files.push({ path: filePath, status, staged: false });
      }
    }

    return c.json({ ok: true, data: { isRepo: true, files } });
  } catch {
    return c.json({ ok: true, data: { isRepo: false, files: [] } });
  }
});

// Stage files
app.post('/stage', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, files } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // If no files specified, stage all
    const args =
      files && Array.isArray(files) && files.length > 0
        ? ['git', 'add', '--', ...files]
        : ['git', 'add', '-A'];

    const { stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });

    if (exitCode !== 0) {
      return c.json({ ok: false, error: `git add failed: ${stderr.trim()}` }, 500);
    }

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Unstage files
app.post('/unstage', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, files } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // If no files specified, unstage all
    const args =
      files && Array.isArray(files) && files.length > 0
        ? ['git', 'reset', 'HEAD', '--', ...files]
        : ['git', 'reset', 'HEAD'];

    const { stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });

    // git reset exits 0 even when there's nothing to unstage
    if (exitCode !== 0) {
      return c.json({ ok: false, error: `git reset failed: ${stderr.trim()}` }, 500);
    }

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
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
    const { stdout: output, exitCode } = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: pathCheck.resolved,
    });

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
    const checkResult = await run(['git', 'rev-parse', '--is-inside-work-tree'], {
      cwd: snapshotPathCheck.resolved,
    });
    const isRepo = checkResult.stdout.trim() === 'true';
    if (!isRepo) return c.json({ ok: false, skipped: true, reason: 'not-a-git-repo' });

    // Get current HEAD
    const headResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: rootPath });
    const headSha = headResult.stdout.trim();
    if (headResult.exitCode !== 0) {
      return c.json({ ok: false, skipped: true, reason: 'no-commits' });
    }

    // Check if there are changes to snapshot
    const statusResult = await run(['git', 'status', '--porcelain'], { cwd: rootPath });
    const statusOutput = statusResult.stdout.trim();
    const hasChanges = statusOutput.length > 0;

    // Create a snapshot tag using git stash create (creates a commit object without modifying working tree)
    let stashSha: string | null = null;
    if (hasChanges) {
      const stashResult = await run(['git', 'stash', 'create'], { cwd: rootPath });
      stashSha = stashResult.stdout.trim() || null;
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

    const {
      stdout: output,
      stderr: err,
      exitCode,
    } = await run(args, { cwd: diffPathCheck.resolved });

    if (exitCode !== 0) {
      return c.json({ ok: false, error: err.trim() || 'git diff failed' }, 500);
    }

    return c.json({ ok: true, data: { diff: output } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Git blame for a specific file
app.get('/blame', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const filePath = c.req.query('file');

  if (!filePath) {
    return c.json({ ok: false, error: 'file parameter required' }, 400);
  }

  const blamePathCheck = validateWorkspacePath(rootPath);
  if (!blamePathCheck.valid) {
    return c.json({ ok: false, error: blamePathCheck.reason }, 403);
  }

  try {
    // Use porcelain format for easy parsing
    const { stdout, stderr, exitCode } = await run(
      ['git', 'blame', '--porcelain', '--', filePath],
      { cwd: blamePathCheck.resolved },
    );

    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || 'git blame failed' }, 500);
    }

    // Parse porcelain blame output
    interface BlameInfo {
      sha: string;
      author: string;
      authorTime: number;
      summary: string;
    }

    const commitMap = new Map<string, BlameInfo>();
    const lines: Array<{ line: number; sha: string }> = [];

    const outputLines = stdout.split('\n');
    let i = 0;
    while (i < outputLines.length) {
      const headerMatch = outputLines[i].match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
      if (headerMatch) {
        const sha = headerMatch[1];
        const resultLine = parseInt(headerMatch[2]);

        // Read commit metadata if we haven't seen this SHA
        if (!commitMap.has(sha)) {
          const info: Partial<BlameInfo> = { sha };
          i++;
          while (i < outputLines.length && !outputLines[i].startsWith('\t')) {
            const line = outputLines[i];
            if (line.startsWith('author ')) info.author = line.slice(7);
            else if (line.startsWith('author-time ')) info.authorTime = parseInt(line.slice(12));
            else if (line.startsWith('summary ')) info.summary = line.slice(8);
            i++;
          }
          commitMap.set(sha, info as BlameInfo);
        } else {
          // Skip to the content line
          i++;
          while (i < outputLines.length && !outputLines[i].startsWith('\t')) {
            i++;
          }
        }

        lines.push({ line: resultLine, sha });
        i++; // skip the content line (starts with \t)
      } else {
        i++;
      }
    }

    // Build result: per-line blame info
    const blameData = lines.map((l) => {
      const commit = commitMap.get(l.sha);
      return {
        line: l.line,
        sha: l.sha.slice(0, 8),
        author: commit?.author || 'Unknown',
        timestamp: commit?.authorTime || 0,
        summary: commit?.summary || '',
      };
    });

    return c.json({ ok: true, data: { blame: blameData } });
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
    const resetResult = await run(['git', 'reset', '--hard', snapshot.head_sha], {
      cwd: snapshot.workspace_path,
    });
    if (resetResult.exitCode !== 0) {
      return c.json({ ok: false, error: `Reset failed: ${resetResult.stderr}` }, 500);
    }

    // If there was a stash, apply it
    if (snapshot.stash_sha) {
      await runExitCode(['git', 'stash', 'apply', snapshot.stash_sha], {
        cwd: snapshot.workspace_path,
      });
      // Stash apply can fail if there are conflicts — that's okay, user can resolve
    }

    return c.json({ ok: true, data: { restored: true } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Commit staged changes (auto-stages all if nothing is staged — like VS Code)
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
    // If nothing is staged, auto-stage all changes (VS Code behavior)
    const stagedExit = await runExitCode(['git', 'diff', '--cached', '--quiet'], {
      cwd: pathCheck.resolved,
    });
    // exit 0 = no staged changes, exit 1 = has staged changes
    if (stagedExit === 0) {
      console.log('[git/commit] Nothing staged — auto-staging all changes');
      const addResult = await run(['git', 'add', '-A'], { cwd: pathCheck.resolved });
      if (addResult.exitCode !== 0) {
        return c.json({ ok: false, error: `git add failed: ${addResult.stderr.trim()}` }, 500);
      }
    }

    console.log('[git/commit] Running git commit -m:', message.trim());
    const commitResult = await run(['git', 'commit', '-m', message.trim()], {
      cwd: pathCheck.resolved,
    });
    console.log('[git/commit] git commit result:', {
      exitCode: commitResult.exitCode,
      stdout: commitResult.stdout,
      stderr: commitResult.stderr,
    });
    if (commitResult.exitCode !== 0) {
      return c.json(
        { ok: false, error: `git commit failed: ${commitResult.stderr || commitResult.stdout}` },
        500,
      );
    }

    // Get the new HEAD sha
    const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: pathCheck.resolved });
    const sha = shaResult.stdout.trim();

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
      console.log(
        '[git/commit/stream] Starting commit flow for:',
        pathCheck.resolved,
        'msg:',
        message.trim(),
      );

      // Check what's staged before committing
      const beforeStatusResult = await run(['git', 'status', '--porcelain'], {
        cwd: pathCheck.resolved,
      });
      console.log('[git/commit/stream] Status before commit:', beforeStatusResult.stdout);

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'diagnostic',
          phase: 'before-staging',
          message: 'Current index and working tree status',
          porcelain: beforeStatusResult.stdout.trim(),
          fileCount: beforeStatusResult.stdout.trim()
            ? beforeStatusResult.stdout.trim().split('\n').length
            : 0,
        }),
      });

      // If nothing is staged, auto-stage all changes (VS Code behavior)
      const stagedExit = await runExitCode(['git', 'diff', '--cached', '--quiet'], {
        cwd: pathCheck.resolved,
      });
      console.log(
        '[git/commit/stream] Staged check exit code:',
        stagedExit,
        '(0=nothing staged, 1=has staged)',
      );
      // exit 0 = no staged changes, exit 1 = has staged changes
      if (stagedExit === 0) {
        console.log('[git/commit/stream] Nothing staged — auto-staging all changes');
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'status',
            message: 'Nothing staged — auto-staging all changes...',
          }),
        });
        const addResult = await run(['git', 'add', '-A'], { cwd: pathCheck.resolved });
        console.log('[git/commit/stream] git add -A result:', {
          exitCode: addResult.exitCode,
          stderr: addResult.stderr,
        });
        if (addResult.exitCode !== 0) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'error',
              message: `git add failed: ${addResult.stderr.trim()}`,
            }),
          });
          return;
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'status',
          message: 'Running pre-commit hooks and creating commit...',
        }),
      });

      console.log('[git/commit/stream] Running git commit -m:', message.trim());
      const commitProc = Bun.spawn(['git', 'commit', '-m', message.trim()], {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // For long-running commits (with hooks), we need to stream the output as it comes
      // Use separate decoders to avoid corrupting multi-byte state across concurrent streams
      const readStreamChunked = async (readable: ReadableStream): Promise<string> => {
        const dec = new TextDecoder();
        const reader = readable.getReader();
        let fullOutput = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = dec.decode(value, { stream: true });
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

      // Guard against pre-commit hooks that hang forever (e.g. waiting for input).
      // If the commit takes more than 5 minutes, kill it and report the timeout.
      const COMMIT_TIMEOUT_MS = 5 * 60 * 1000;
      const commitTimeout = setTimeout(() => {
        console.error(
          '[git/commit/stream] TIMEOUT after %dms — killing commit process',
          COMMIT_TIMEOUT_MS,
        );
        try {
          commitProc.kill();
        } catch {
          // already exited
        }
      }, COMMIT_TIMEOUT_MS);

      // Read both streams concurrently to prevent deadlock
      const [commitOut, commitErr] = await Promise.all([
        readStreamChunked(commitProc.stdout),
        readStreamChunked(commitProc.stderr),
      ]);
      const commitExit = await commitProc.exited;
      clearTimeout(commitTimeout);
      console.log('[git/commit/stream] git commit result:', {
        exitCode: commitExit,
        stdout: commitOut.slice(0, 200),
        stderr: commitErr.slice(0, 200),
      });

      if (commitExit !== 0) {
        const rawDetail = commitErr.trim() || commitOut.trim() || 'Unknown error';
        console.error('[git/commit/stream] Commit failed:', rawDetail);

        // Parse the failure into a human-readable summary
        const summary = parseCommitFailure(rawDetail, commitOut.trim());

        await stream.writeSSE({
          data: JSON.stringify({
            type: 'error',
            message: summary,
            detail: rawDetail.length > 500 ? rawDetail.slice(-500) : rawDetail,
          }),
        });
        return;
      }

      // Check status AFTER commit — stream to client
      const afterCommitResult = await run(['git', 'status', '--porcelain'], {
        cwd: pathCheck.resolved,
      });
      console.log('[git/commit/stream] Status AFTER commit:', afterCommitResult.stdout);

      const afterCommitClean = afterCommitResult.stdout.trim().length === 0;
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'diagnostic',
          phase: 'after-commit',
          message: afterCommitClean
            ? 'Working tree is clean after commit'
            : 'WARNING: Working tree still has changes after commit — some files may not have been included',
          porcelain: afterCommitResult.stdout.trim(),
          fileCount: afterCommitResult.stdout.trim()
            ? afterCommitResult.stdout.trim().split('\n').length
            : 0,
        }),
      });

      // Get the new HEAD sha
      const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: pathCheck.resolved });
      const sha = shaResult.stdout.trim();
      console.log('[git/commit/stream] Commit successful! SHA:', sha);

      await stream.writeSSE({
        data: JSON.stringify({ type: 'complete', sha, message: 'Commit successful!' }),
      });
    } catch (err) {
      console.error('[git/commit/stream] Unexpected error:', err);
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
    const diffResult = await run(['git', 'diff', 'HEAD'], { cwd: pathCheck.resolved });
    let diffText = diffResult.stdout;

    // Also capture untracked file names
    const untrackedResult = await run(['git', 'ls-files', '--others', '--exclude-standard'], {
      cwd: pathCheck.resolved,
    });
    const untrackedFiles = untrackedResult.stdout.trim();

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
      // Let the configured CLI provider use its default model — avoids
      // hardcoding a model ID that may not exist for all providers.
      timeoutMs: 30_000,
    });

    return c.json({ ok: true, data: { message: message.trim() } });
  } catch (err) {
    console.error('[git/generate-commit-message] LLM call failed:', err);
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
    // Log status BEFORE clean
    const beforeStatusResult = await run(['git', 'status', '--porcelain'], {
      cwd: pathCheck.resolved,
    });
    const beforeStatus = beforeStatusResult.stdout;
    console.log('[git/clean] Status BEFORE clean:', beforeStatus);

    // Unstage everything first — handles files left in the index after a failed commit
    const resetResult = await run(['git', 'reset', 'HEAD'], { cwd: pathCheck.resolved });
    if (resetResult.exitCode !== 0) {
      console.warn('[git/clean] git reset HEAD failed (non-fatal):', resetResult.stderr.trim());
    }

    // Restore tracked files
    const checkoutResult = await run(['git', 'checkout', '--', '.'], { cwd: pathCheck.resolved });
    if (checkoutResult.exitCode !== 0) {
      console.warn('[git/clean] git checkout -- . failed:', checkoutResult.stderr.trim());
    }

    // Remove untracked files and directories
    const cleanResult = await run(['git', 'clean', '-fd'], { cwd: pathCheck.resolved });
    if (cleanResult.exitCode !== 0) {
      console.warn('[git/clean] git clean -fd failed:', cleanResult.stderr.trim());
    }

    // Log status AFTER clean
    const afterStatusResult = await run(['git', 'status', '--porcelain'], {
      cwd: pathCheck.resolved,
    });
    const afterStatus = afterStatusResult.stdout;
    console.log('[git/clean] Status AFTER clean:', afterStatus);

    const stillDirty = afterStatus.trim().length > 0;
    if (stillDirty) {
      console.warn(
        '[git/clean] WARNING: Working tree still has changes after clean:',
        afterStatus.trim(),
      );
    }

    return c.json({
      ok: true,
      data: {
        cleaned: true,
        beforeFileCount: beforeStatus.trim() ? beforeStatus.trim().split('\n').length : 0,
        afterFileCount: afterStatus.trim() ? afterStatus.trim().split('\n').length : 0,
        fullyClean: !stillDirty,
      },
    });
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
      const branchResult = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: pathCheck.resolved,
      });
      targetBranch = branchResult.stdout.trim();
      if (branchResult.exitCode !== 0 || !targetBranch) {
        return c.json({ ok: false, error: 'Could not determine current branch' }, 500);
      }
    }

    // Push to remote (defaults to 'origin' if not specified)
    const targetRemote = remote || 'origin';
    const pushResult = await run(['git', 'push', targetRemote, targetBranch], {
      cwd: pathCheck.resolved,
    });

    if (pushResult.exitCode !== 0) {
      // Check if it's an upstream tracking error
      if (
        pushResult.stderr.includes('no upstream branch') ||
        pushResult.stderr.includes('has no upstream')
      ) {
        // Try push with --set-upstream
        const upstreamResult = await run(
          ['git', 'push', '--set-upstream', targetRemote, targetBranch],
          { cwd: pathCheck.resolved },
        );
        if (upstreamResult.exitCode !== 0) {
          return c.json(
            { ok: false, error: upstreamResult.stderr.trim() || 'git push failed' },
            500,
          );
        }
        return c.json({ ok: true, data: { pushed: true, setUpstream: true } });
      }
      return c.json({ ok: false, error: pushResult.stderr.trim() || 'git push failed' }, 500);
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
        const branchResult = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: pathCheck.resolved,
        });
        targetBranch = branchResult.stdout.trim();
        if (branchResult.exitCode !== 0 || !targetBranch) {
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

      // Use separate decoders per stream to avoid corrupting multi-byte state
      const readStream = async (readable: ReadableStream): Promise<string> => {
        const dec = new TextDecoder();
        const reader = readable.getReader();
        let fullOutput = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = dec.decode(value, { stream: true });
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

      // Read both streams concurrently to prevent deadlock
      const outputs: Promise<string>[] = [];
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

// ---------------------------------------------------------------------------
// Git diagnostics — helps debug staging and commit flow issues
// ---------------------------------------------------------------------------

interface DiagnosticCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  detail?: string;
}

app.get('/diagnose', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  const checks: DiagnosticCheck[] = [];

  try {
    // 1. Check if it's a git repo
    const repoResult = await run(['git', 'rev-parse', '--is-inside-work-tree'], {
      cwd: pathCheck.resolved,
    });
    const isRepo = repoResult.stdout.trim() === 'true';

    if (!isRepo) {
      checks.push({
        name: 'git-repo',
        status: 'error',
        message: 'Not a git repository',
        detail: `Path "${pathCheck.resolved}" is not inside a git work tree.`,
      });
      return c.json({ ok: true, data: { checks } });
    }
    checks.push({ name: 'git-repo', status: 'ok', message: 'Valid git repository' });

    // 2. Check for index.lock (indicates interrupted git operation)
    const gitDirResult = await run(['git', 'rev-parse', '--git-dir'], {
      cwd: pathCheck.resolved,
    });
    const gitDir = gitDirResult.stdout.trim();

    const lockPath = `${pathCheck.resolved}/${gitDir}/index.lock`;
    const lockExists = await Bun.file(lockPath).exists();
    if (lockExists) {
      checks.push({
        name: 'index-lock',
        status: 'error',
        message: 'Git index.lock file exists — a previous git operation may have been interrupted',
        detail: `Lock file at: ${lockPath}. Remove it manually if no git process is running.`,
      });
    } else {
      checks.push({ name: 'index-lock', status: 'ok', message: 'No stale lock files' });
    }

    // 3. Check HEAD validity
    const headResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: pathCheck.resolved });
    const headSha = headResult.stdout.trim();
    if (headResult.exitCode !== 0) {
      checks.push({
        name: 'head-ref',
        status: 'warn',
        message: 'HEAD is invalid (no commits yet?)',
        detail: 'This is expected for a brand-new repo with no commits.',
      });
    } else {
      checks.push({
        name: 'head-ref',
        status: 'ok',
        message: `HEAD is valid: ${headSha.slice(0, 8)}`,
      });
    }

    // 4. Working tree status summary
    const statusResult = await run(['git', 'status', '--porcelain'], { cwd: pathCheck.resolved });
    const statusOutput = statusResult.stdout.trim();

    if (statusOutput.length === 0) {
      checks.push({
        name: 'working-tree',
        status: 'ok',
        message: 'Working tree is clean',
      });
    } else {
      const lines = statusOutput.split('\n');
      const staged = lines.filter((l) => l[0] !== ' ' && l[0] !== '?').length;
      const unstaged = lines.filter((l) => l[1] === 'M' || l[1] === 'D').length;
      const untracked = lines.filter((l) => l.startsWith('??')).length;
      checks.push({
        name: 'working-tree',
        status: 'warn',
        message: `Working tree has changes: ${staged} staged, ${unstaged} unstaged, ${untracked} untracked (${lines.length} total)`,
        detail: statusOutput,
      });
    }

    // 5. Check for staged vs unstaged discrepancy (common source of confusion)
    const stagedDiffResult = await run(['git', 'diff', '--cached', '--stat'], {
      cwd: pathCheck.resolved,
    });
    const stagedDiff = stagedDiffResult.stdout.trim();

    const unstagedDiffResult = await run(['git', 'diff', '--stat'], { cwd: pathCheck.resolved });
    const unstagedDiff = unstagedDiffResult.stdout.trim();

    if (stagedDiff && unstagedDiff) {
      checks.push({
        name: 'staging-mismatch',
        status: 'warn',
        message: 'Both staged AND unstaged changes exist — commit may not include all changes',
        detail: `Staged:\n${stagedDiff}\n\nUnstaged:\n${unstagedDiff}`,
      });
    } else if (stagedDiff) {
      checks.push({
        name: 'staging-mismatch',
        status: 'ok',
        message: 'Only staged changes present — commit will include all intended changes',
      });
    } else if (unstagedDiff) {
      checks.push({
        name: 'staging-mismatch',
        status: 'ok',
        message: 'Only unstaged changes present — will need `git add` before commit',
      });
    } else {
      checks.push({
        name: 'staging-mismatch',
        status: 'ok',
        message: 'No staged/unstaged diff discrepancy',
      });
    }

    // 6. Check for merge conflicts
    const conflictResult = await run(['git', 'diff', '--name-only', '--diff-filter=U'], {
      cwd: pathCheck.resolved,
    });
    const conflictFiles = conflictResult.stdout.trim();

    if (conflictFiles.length > 0) {
      checks.push({
        name: 'merge-conflicts',
        status: 'error',
        message: `Merge conflicts detected in ${conflictFiles.split('\n').length} file(s)`,
        detail: conflictFiles,
      });
    } else {
      checks.push({
        name: 'merge-conflicts',
        status: 'ok',
        message: 'No merge conflicts',
      });
    }

    // 7. Check if there's a rebase or merge in progress
    const gitDirAbs = gitDir.startsWith('/') ? gitDir : `${pathCheck.resolved}/${gitDir}`;
    const rebaseMerge = await Bun.file(`${gitDirAbs}/rebase-merge`).exists();
    const rebaseApply = await Bun.file(`${gitDirAbs}/rebase-apply`).exists();
    const mergeHead = await Bun.file(`${gitDirAbs}/MERGE_HEAD`).exists();

    if (rebaseMerge || rebaseApply) {
      checks.push({
        name: 'in-progress-op',
        status: 'error',
        message: 'A rebase is in progress — complete or abort it before committing',
      });
    } else if (mergeHead) {
      checks.push({
        name: 'in-progress-op',
        status: 'warn',
        message: 'A merge is in progress — resolve conflicts and commit the merge',
      });
    } else {
      checks.push({
        name: 'in-progress-op',
        status: 'ok',
        message: 'No rebase or merge in progress',
      });
    }

    // 8. Check current branch
    const branchResult = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: pathCheck.resolved,
    });
    const currentBranch = branchResult.stdout.trim();

    if (currentBranch === 'HEAD') {
      checks.push({
        name: 'branch',
        status: 'warn',
        message: "Detached HEAD state — commits won't be on any branch",
        detail: 'You are in detached HEAD state. Create a branch to save your work.',
      });
    } else {
      checks.push({
        name: 'branch',
        status: 'ok',
        message: `On branch: ${currentBranch}`,
      });
    }

    // 9. Check for very large untracked files that could slow down staging
    const untrackedResult = await run(['git', 'ls-files', '--others', '--exclude-standard'], {
      cwd: pathCheck.resolved,
    });
    const untrackedFiles = untrackedResult.stdout.trim();

    if (untrackedFiles) {
      const fileList = untrackedFiles.split('\n');
      if (fileList.length > 100) {
        checks.push({
          name: 'untracked-count',
          status: 'warn',
          message: `${fileList.length} untracked files — consider adding them to .gitignore to speed up staging`,
          detail: `First 10:\n${fileList.slice(0, 10).join('\n')}${fileList.length > 10 ? '\n...' : ''}`,
        });
      } else {
        checks.push({
          name: 'untracked-count',
          status: 'ok',
          message: `${fileList.length} untracked file(s)`,
        });
      }
    } else {
      checks.push({
        name: 'untracked-count',
        status: 'ok',
        message: 'No untracked files',
      });
    }

    return c.json({ ok: true, data: { checks } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { app as gitRoutes };
