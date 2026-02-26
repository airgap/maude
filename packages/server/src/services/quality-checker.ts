import { existsSync } from 'fs';
import { join } from 'path';
import type { QualityCheckConfig, QualityCheckResult } from '@e/shared';
import { resolveWorkspacePath } from './worktree-service';

/**
 * Options for running quality checks, optionally scoped to a story's worktree.
 */
export interface QualityCheckOptions {
  /** Story ID — when provided, CWD resolves to the story's worktree path */
  storyId?: string;
}

/**
 * Track which worktree paths have already had `bun install` run,
 * to avoid running it multiple times per worktree within a process lifetime.
 */
const installedWorktrees = new Set<string>();

/** @internal — exposed for testing */
export const _testHelpers = {
  getInstalledWorktrees: () => installedWorktrees,
  clearInstalledWorktrees: () => installedWorktrees.clear(),
};

/**
 * Ensure node_modules exists in the given directory.
 * If missing, runs `bun install --frozen-lockfile` once per worktree.
 * Returns true if install was run, false if already present.
 */
export async function ensureDependencies(cwd: string): Promise<boolean> {
  const nodeModulesPath = join(cwd, 'node_modules');

  // Already installed in this process lifetime
  if (installedWorktrees.has(cwd)) {
    return false;
  }

  // node_modules already exists on disk
  if (existsSync(nodeModulesPath)) {
    installedWorktrees.add(cwd);
    return false;
  }

  // Need to install — check for a package.json first (no package.json = not a JS project)
  const packageJsonPath = join(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  console.log(
    `[quality-checker] node_modules missing in ${cwd}, running bun install --frozen-lockfile`,
  );

  try {
    const proc = Bun.spawn(['bun', 'install', '--frozen-lockfile'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      console.log(`[quality-checker] bun install succeeded in ${cwd}`);
      installedWorktrees.add(cwd);
      return true;
    } else {
      console.error(
        `[quality-checker] bun install failed in ${cwd} (exit ${exitCode}): ${(stdout + '\n' + stderr).trim().slice(0, 1000)}`,
      );
      // Mark as attempted to avoid retrying every check
      installedWorktrees.add(cwd);
      return true;
    }
  } catch (err) {
    console.error(`[quality-checker] bun install error in ${cwd}:`, err);
    // Mark as attempted
    installedWorktrees.add(cwd);
    return true;
  }
}

/**
 * Run a single quality check by spawning the configured command.
 *
 * When `options.storyId` is provided, the CWD is resolved to the story's
 * worktree path and the result is tagged with the storyId.
 */
export async function runQualityCheck(
  check: QualityCheckConfig,
  workspacePath: string,
  options?: QualityCheckOptions,
): Promise<QualityCheckResult> {
  const start = Date.now();
  const storyId = options?.storyId;

  // Resolve CWD: use worktree path if story context is active
  const cwd = resolveWorkspacePath(workspacePath, storyId);

  try {
    // Auto-install dependencies if node_modules is missing in the worktree
    if (storyId) {
      await ensureDependencies(cwd);
    }

    // Split command respecting quotes
    const parts = check.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [check.command];
    const cleanParts = parts.map((p) => p.replace(/^["']|["']$/g, ''));

    const proc = Bun.spawn(cleanParts, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    // Apply timeout
    const timeoutId = setTimeout(() => proc.kill(), check.timeout);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    const result: QualityCheckResult = {
      checkId: check.id,
      checkName: check.name,
      checkType: check.type,
      passed: exitCode === 0,
      output: (stdout + '\n' + stderr).trim().slice(0, 5000),
      duration: Date.now() - start,
      exitCode,
    };
    if (storyId) result.storyId = storyId;
    return result;
  } catch (err) {
    const result: QualityCheckResult = {
      checkId: check.id,
      checkName: check.name,
      checkType: check.type,
      passed: false,
      output: String(err).slice(0, 2000),
      duration: Date.now() - start,
      exitCode: -1,
    };
    if (storyId) result.storyId = storyId;
    return result;
  }
}

/**
 * Run all enabled quality checks sequentially.
 *
 * When `options.storyId` is provided, all checks run in the story's
 * worktree directory and results are tagged with the storyId.
 */
export async function runAllQualityChecks(
  checks: QualityCheckConfig[],
  workspacePath: string,
  options?: QualityCheckOptions,
): Promise<QualityCheckResult[]> {
  const enabledChecks = checks.filter((c) => c.enabled);
  const results: QualityCheckResult[] = [];
  for (const check of enabledChecks) {
    results.push(await runQualityCheck(check, workspacePath, options));
  }
  return results;
}
