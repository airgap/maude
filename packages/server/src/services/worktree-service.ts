/**
 * Worktree Service — wraps git worktree operations with error handling,
 * per-workspace mutex locking, and structured logging.
 *
 * All operations return WorktreeResult<T> and never throw uncaught errors.
 * Concurrent operations on the same workspace are serialized via a
 * per-workspace mutex (Map<string, Promise<void>>).
 */

import { resolve, join } from 'path';
import { existsSync } from 'fs';
import type {
  WorktreeInfo,
  WorktreeCreateOptions,
  WorktreeResult,
  WorktreeValidation,
} from '@e/shared';

// ---------------------------------------------------------------------------
// Helpers — safe Bun.spawn (same pattern as routes/git/helpers.ts)
// ---------------------------------------------------------------------------

async function run(
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Per-workspace mutex — serializes concurrent ops on the same repo
// ---------------------------------------------------------------------------

const workspaceLocks = new Map<string, Promise<void>>();

/**
 * Acquire a per-workspace mutex. Returns a release function.
 * Concurrent callers on the same workspace path wait in FIFO order.
 * Different workspaces run in parallel with no contention.
 */
function withLock<T>(workspacePath: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(workspacePath);
  const prev = workspaceLocks.get(key) ?? Promise.resolve();

  let releaseFn: () => void;
  const gate = new Promise<void>((r) => {
    releaseFn = r;
  });
  workspaceLocks.set(key, gate);

  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      releaseFn!();
      // Clean up if we're the last waiter
      if (workspaceLocks.get(key) === gate) {
        workspaceLocks.delete(key);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Worktrees are stored under .e/worktrees/<storyId> inside the repo. */
const WORKTREE_DIR = '.e/worktrees';

/** Branch prefix for story worktrees. */
const BRANCH_PREFIX = 'story/';

// ---------------------------------------------------------------------------
// Porcelain parser
// ---------------------------------------------------------------------------

/**
 * Parse `git worktree list --porcelain` output into WorktreeInfo[].
 *
 * Format (one block per worktree, separated by blank line):
 *   worktree /absolute/path
 *   HEAD <sha>
 *   branch refs/heads/<name>
 *   locked [reason]
 *   prunable [reason]
 *
 * Detached HEAD uses "detached" instead of "branch refs/heads/...".
 */
export function parsePorcelain(output: string): Omit<WorktreeInfo, 'isDirty'>[] {
  const results: Omit<WorktreeInfo, 'isDirty'>[] = [];
  const blocks = output.trim().split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.split('\n');
    let path = '';
    let head = '';
    let branch: string | null = null;
    let isLocked = false;
    let isMain = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        // "branch refs/heads/story/my-story" → "story/my-story"
        const ref = line.slice('branch '.length);
        branch = ref.replace('refs/heads/', '');
      } else if (line === 'detached') {
        branch = null;
      } else if (line.startsWith('locked')) {
        isLocked = true;
      } else if (line === 'bare') {
        isMain = true;
      }
    }

    // The first worktree in the list is always the main one
    if (results.length === 0 && !isMain) {
      isMain = true;
    }

    // Extract storyId from "story/<storyId>" branch pattern
    let storyId: string | null = null;
    if (branch?.startsWith(BRANCH_PREFIX)) {
      storyId = branch.slice(BRANCH_PREFIX.length);
    }

    if (path) {
      results.push({ path, head, branch, storyId, isMain, isLocked });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create a new worktree for a story.
 *
 * Runs: git worktree add .e/worktrees/<storyId> -b story/<storyId> [baseBranch]
 * Returns the absolute path to the new worktree.
 */
export async function create(options: WorktreeCreateOptions): Promise<WorktreeResult<string>> {
  const { workspacePath, storyId, baseBranch } = options;

  return withLock(workspacePath, async () => {
    try {
      const worktreePath = join(workspacePath, WORKTREE_DIR, storyId);
      const branchName = `${BRANCH_PREFIX}${storyId}`;

      const args = ['git', 'worktree', 'add', worktreePath, '-b', branchName];
      if (baseBranch) {
        args.push(baseBranch);
      }

      console.log(`[worktree] Creating worktree: ${args.join(' ')} (cwd: ${workspacePath})`);
      const result = await run(args, { cwd: workspacePath });

      if (result.exitCode !== 0) {
        const msg = result.stderr.trim() || result.stdout.trim() || 'Unknown git error';
        console.error(`[worktree] create failed (exit ${result.exitCode}): ${msg}`);
        return { ok: false, error: `Failed to create worktree: ${msg}` };
      }

      const resolved = resolve(worktreePath);
      console.log(`[worktree] Created worktree at ${resolved}`);
      return { ok: true, data: resolved };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] create error: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

/**
 * Remove a worktree for a story.
 *
 * First checks `git status --porcelain` in the worktree. If dirty (uncommitted
 * changes), returns an error with the list of modified files. Otherwise runs
 * `git worktree remove`.
 */
export async function remove(
  workspacePath: string,
  storyId: string,
): Promise<WorktreeResult<void>> {
  return withLock(workspacePath, async () => {
    try {
      const worktreePath = join(workspacePath, WORKTREE_DIR, storyId);
      const resolved = resolve(worktreePath);

      // Check if the worktree directory exists
      if (!existsSync(resolved)) {
        return { ok: false, error: `Worktree not found: ${resolved}` };
      }

      // Check for dirty state
      const status = await run(['git', 'status', '--porcelain'], { cwd: resolved });
      if (status.exitCode !== 0) {
        return { ok: false, error: `Failed to check worktree status: ${status.stderr.trim()}` };
      }

      const dirtyFiles = status.stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0);

      if (dirtyFiles.length > 0) {
        console.warn(
          `[worktree] Cannot remove dirty worktree ${storyId}: ${dirtyFiles.length} file(s) modified`,
        );
        return {
          ok: false,
          error: `Worktree has uncommitted changes (${dirtyFiles.length} file(s))`,
          dirtyFiles,
        };
      }

      // Remove the worktree
      console.log(`[worktree] Removing worktree: ${resolved}`);
      const result = await run(['git', 'worktree', 'remove', resolved], { cwd: workspacePath });

      if (result.exitCode !== 0) {
        const msg = result.stderr.trim() || result.stdout.trim() || 'Unknown git error';
        console.error(`[worktree] remove failed (exit ${result.exitCode}): ${msg}`);
        return { ok: false, error: `Failed to remove worktree: ${msg}` };
      }

      console.log(`[worktree] Removed worktree ${storyId}`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] remove error: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

/**
 * List all worktrees for a workspace.
 *
 * Parses `git worktree list --porcelain` and augments each entry with
 * isDirty status by running `git status --porcelain` in each worktree.
 */
export async function list(workspacePath: string): Promise<WorktreeResult<WorktreeInfo[]>> {
  return withLock(workspacePath, async () => {
    try {
      const result = await run(['git', 'worktree', 'list', '--porcelain'], {
        cwd: workspacePath,
      });

      if (result.exitCode !== 0) {
        const msg = result.stderr.trim() || 'Failed to list worktrees';
        return { ok: false, error: msg };
      }

      const entries = parsePorcelain(result.stdout);

      // Check dirty state for each worktree
      const infos: WorktreeInfo[] = await Promise.all(
        entries.map(async (entry) => {
          let isDirty = false;
          try {
            if (existsSync(entry.path)) {
              const status = await run(['git', 'status', '--porcelain'], { cwd: entry.path });
              isDirty = status.exitCode === 0 && status.stdout.trim().length > 0;
            }
          } catch {
            // If we can't check status, assume not dirty
          }
          return { ...entry, isDirty };
        }),
      );

      return { ok: true, data: infos };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] list error: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

/**
 * Get the absolute path to a story's worktree, or null if it doesn't exist.
 */
export async function getPath(
  workspacePath: string,
  storyId: string,
): Promise<WorktreeResult<string | null>> {
  return withLock(workspacePath, async () => {
    try {
      const worktreePath = resolve(join(workspacePath, WORKTREE_DIR, storyId));

      if (!existsSync(worktreePath)) {
        return { ok: true, data: null };
      }

      return { ok: true, data: worktreePath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] getPath error: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

/**
 * Validate a worktree — checks directory exists, HEAD is valid, branch is intact.
 */
export async function validate(
  workspacePath: string,
  storyId: string,
): Promise<WorktreeResult<WorktreeValidation>> {
  return withLock(workspacePath, async () => {
    try {
      const worktreePath = resolve(join(workspacePath, WORKTREE_DIR, storyId));
      const branchName = `${BRANCH_PREFIX}${storyId}`;

      const validation: WorktreeValidation = {
        valid: false,
        dirExists: false,
        headValid: false,
        branchIntact: false,
      };

      // Check directory exists
      validation.dirExists = existsSync(worktreePath);
      if (!validation.dirExists) {
        return { ok: true, data: validation };
      }

      // Check HEAD is valid
      const headCheck = await run(['git', 'rev-parse', '--verify', 'HEAD'], {
        cwd: worktreePath,
      });
      validation.headValid = headCheck.exitCode === 0;

      // Check branch is intact
      const branchCheck = await run(['git', 'rev-parse', '--verify', `refs/heads/${branchName}`], {
        cwd: workspacePath,
      });
      validation.branchIntact = branchCheck.exitCode === 0;

      validation.valid = validation.dirExists && validation.headValid && validation.branchIntact;

      return { ok: true, data: validation };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] validate error: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

/**
 * Prune stale worktree references.
 *
 * Runs `git worktree prune` and compares the worktree list before/after
 * to determine how many entries were pruned.
 */
export async function prune(workspacePath: string): Promise<WorktreeResult<number>> {
  return withLock(workspacePath, async () => {
    try {
      // Count worktrees before prune
      const beforeResult = await run(['git', 'worktree', 'list', '--porcelain'], {
        cwd: workspacePath,
      });
      const beforeCount =
        beforeResult.exitCode === 0 ? parsePorcelain(beforeResult.stdout).length : 0;

      // Run prune
      console.log(`[worktree] Pruning stale worktrees in ${workspacePath}`);
      const result = await run(['git', 'worktree', 'prune'], { cwd: workspacePath });

      if (result.exitCode !== 0) {
        const msg = result.stderr.trim() || 'Failed to prune worktrees';
        console.error(`[worktree] prune failed: ${msg}`);
        return { ok: false, error: msg };
      }

      // Count worktrees after prune
      const afterResult = await run(['git', 'worktree', 'list', '--porcelain'], {
        cwd: workspacePath,
      });
      const afterCount = afterResult.exitCode === 0 ? parsePorcelain(afterResult.stdout).length : 0;

      const pruned = Math.max(0, beforeCount - afterCount);
      console.log(`[worktree] Pruned ${pruned} stale worktree(s)`);
      return { ok: true, data: pruned };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worktree] prune error: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------

/** @internal — exposed for unit tests to inspect/clear mutex state. */
export const _testHelpers = {
  getWorkspaceLocks: () => workspaceLocks,
  clearLocks: () => workspaceLocks.clear(),
};
