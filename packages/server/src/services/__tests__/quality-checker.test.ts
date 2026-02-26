import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock worktree-service — resolveWorkspacePath returns worktree path for known
// stories, falls back to workspacePath otherwise.
// ---------------------------------------------------------------------------

const ACTIVE_STORY_ID = 'story-active-1';
const ACTIVE_WORKTREE = '/workspace/project/.e/worktrees/story-active-1';
const WORKSPACE = '/workspace/project';

mock.module('../worktree-service', () => ({
  resolveWorkspacePath: (workspacePath: string, storyId?: string | null) => {
    if (storyId === ACTIVE_STORY_ID) return ACTIVE_WORKTREE;
    return workspacePath;
  },
  getForStory: (storyId: string) => {
    if (storyId === ACTIVE_STORY_ID) {
      return {
        id: 'wt-1',
        story_id: ACTIVE_STORY_ID,
        worktree_path: ACTIVE_WORKTREE,
        status: 'active',
      };
    }
    return null;
  },
}));

// ---------------------------------------------------------------------------
// Track Bun.spawn calls and fs checks
// ---------------------------------------------------------------------------

let spawnCalls: Array<{ cmd: string[]; cwd: string }> = [];
let spawnExitCode = 0;
let existingPaths = new Set<string>();

const originalSpawn = Bun.spawn;

(Bun as any).spawn = (cmd: string[], opts?: any) => {
  spawnCalls.push({ cmd, cwd: opts?.cwd ?? '' });
  return {
    stdout: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode('check output'));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode(''));
        controller.close();
      },
    }),
    exited: Promise.resolve(spawnExitCode),
    exitCode: spawnExitCode,
    kill: () => {},
  };
};

// Mock fs.existsSync
mock.module('fs', () => ({
  existsSync: (p: string) => existingPaths.has(p),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  runQualityCheck,
  runAllQualityChecks,
  ensureDependencies,
  _testHelpers,
} from '../quality-checker';
import type { QualityCheckConfig } from '@e/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheck(overrides: Partial<QualityCheckConfig> = {}): QualityCheckConfig {
  return {
    id: 'check-1',
    name: 'Test Check',
    type: 'custom',
    command: 'echo hello',
    timeout: 30000,
    required: true,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('quality-checker', () => {
  beforeEach(() => {
    spawnCalls = [];
    spawnExitCode = 0;
    existingPaths = new Set();
    _testHelpers.clearInstalledWorktrees();
  });

  // -------------------------------------------------------------------------
  // runQualityCheck — basic behavior
  // -------------------------------------------------------------------------

  describe('runQualityCheck', () => {
    test('returns passing result on exit code 0', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.checkId).toBe('check-1');
      expect(result.checkName).toBe('Test Check');
      expect(result.checkType).toBe('custom');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    test('returns failing result on non-zero exit', async () => {
      spawnExitCode = 1;
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    test('uses workspacePath as CWD without storyId', async () => {
      await runQualityCheck(makeCheck(), WORKSPACE);
      expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
      const checkCall = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(checkCall?.cwd).toBe(WORKSPACE);
    });

    test('output is captured', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.output).toContain('check output');
    });
  });

  // -------------------------------------------------------------------------
  // runQualityCheck — worktree scoping (AC3: quality checks use worktree CWD)
  // -------------------------------------------------------------------------

  describe('worktree-scoped execution', () => {
    test('uses worktree CWD when storyId provided', async () => {
      // Ensure ensureDependencies doesn't trigger install
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      const checkCall = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(checkCall?.cwd).toBe(ACTIVE_WORKTREE);
    });

    test('falls back to workspacePath for unknown story', async () => {
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: 'unknown-story' });
      const checkCall = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(checkCall?.cwd).toBe(WORKSPACE);
    });
  });

  // -------------------------------------------------------------------------
  // storyId tagging (AC4: results tagged with storyId)
  // -------------------------------------------------------------------------

  describe('storyId tagging', () => {
    test('result includes storyId when provided', async () => {
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      const result = await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      expect(result.storyId).toBe(ACTIVE_STORY_ID);
    });

    test('result has no storyId when not provided', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.storyId).toBeUndefined();
    });

    test('result has no storyId when options empty', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE, {});
      expect(result.storyId).toBeUndefined();
    });

    test('failing result still tagged with storyId', async () => {
      spawnExitCode = 1;
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      const result = await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      expect(result.storyId).toBe(ACTIVE_STORY_ID);
      expect(result.passed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ensureDependencies (AC5: auto bun install)
  // -------------------------------------------------------------------------

  describe('ensureDependencies', () => {
    test('skips when node_modules exists', async () => {
      existingPaths.add('/some/path/node_modules');
      const result = await ensureDependencies('/some/path');
      expect(result).toBe(false); // skipped
      expect(spawnCalls).toHaveLength(0);
    });

    test('skips when already installed this process', async () => {
      // First call: no node_modules, has package.json → installs
      existingPaths.add('/some/path/package.json');
      const first = await ensureDependencies('/some/path');
      expect(first).toBe(true); // install attempted

      // Second call: already tracked → skips
      const second = await ensureDependencies('/some/path');
      expect(second).toBe(false); // skipped
    });

    test('runs bun install when node_modules missing and package.json present', async () => {
      existingPaths.add('/wp/package.json');
      const result = await ensureDependencies('/wp');
      expect(result).toBe(true);
      const installCall = spawnCalls.find((c) => c.cmd.includes('install'));
      expect(installCall).toBeTruthy();
      expect(installCall!.cmd).toEqual(['bun', 'install', '--frozen-lockfile']);
      expect(installCall!.cwd).toBe('/wp');
    });

    test('skips when no package.json', async () => {
      // neither node_modules nor package.json
      const result = await ensureDependencies('/empty/dir');
      expect(result).toBe(false);
      expect(spawnCalls).toHaveLength(0);
    });

    test('marks worktree as installed even if install fails', async () => {
      existingPaths.add('/fail/path/package.json');
      spawnExitCode = 1;
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});
      await ensureDependencies('/fail/path');
      // Should be tracked so it doesn't retry
      expect(_testHelpers.getInstalledWorktrees().has('/fail/path')).toBe(true);
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Auto-install triggered by runQualityCheck (AC5 integration)
  // -------------------------------------------------------------------------

  describe('auto-install in worktree context', () => {
    test('triggers ensureDependencies for worktree-scoped checks', async () => {
      // No node_modules, has package.json → should trigger install
      existingPaths.add(ACTIVE_WORKTREE + '/package.json');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      // Should have a bun install call
      const installCall = spawnCalls.find(
        (c) => c.cmd.includes('install') && c.cwd === ACTIVE_WORKTREE,
      );
      expect(installCall).toBeTruthy();
      logSpy.mockRestore();
    });

    test('does not trigger install without storyId', async () => {
      await runQualityCheck(makeCheck(), WORKSPACE);
      const installCall = spawnCalls.find((c) => c.cmd.includes('install'));
      expect(installCall).toBeUndefined();
    });

    test('does not trigger install when CWD matches workspace (no worktree)', async () => {
      // unknown story falls back to workspace path
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: 'unknown-story' });
      const installCall = spawnCalls.find((c) => c.cmd.includes('install'));
      expect(installCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // runAllQualityChecks
  // -------------------------------------------------------------------------

  describe('runAllQualityChecks', () => {
    test('runs all enabled checks', async () => {
      const checks = [
        makeCheck({ id: 'c1', enabled: true }),
        makeCheck({ id: 'c2', enabled: false }),
        makeCheck({ id: 'c3', enabled: true }),
      ];
      const results = await runAllQualityChecks(checks, WORKSPACE);
      expect(results).toHaveLength(2);
      expect(results[0].checkId).toBe('c1');
      expect(results[1].checkId).toBe('c3');
    });

    test('passes storyId options through to each check', async () => {
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      const checks = [makeCheck({ id: 'c1' }), makeCheck({ id: 'c2' })];
      const results = await runAllQualityChecks(checks, WORKSPACE, {
        storyId: ACTIVE_STORY_ID,
      });
      expect(results).toHaveLength(2);
      expect(results[0].storyId).toBe(ACTIVE_STORY_ID);
      expect(results[1].storyId).toBe(ACTIVE_STORY_ID);
    });

    test('returns empty array when no checks enabled', async () => {
      const checks = [makeCheck({ enabled: false })];
      const results = await runAllQualityChecks(checks, WORKSPACE);
      expect(results).toEqual([]);
    });

    test('backward compat: works without options', async () => {
      const checks = [makeCheck()];
      const results = await runAllQualityChecks(checks, WORKSPACE);
      expect(results).toHaveLength(1);
      expect(results[0].storyId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // _testHelpers
  // -------------------------------------------------------------------------

  describe('_testHelpers', () => {
    test('clearInstalledWorktrees resets tracking', async () => {
      existingPaths.add('/x/package.json');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});
      await ensureDependencies('/x');
      expect(_testHelpers.getInstalledWorktrees().size).toBeGreaterThan(0);
      _testHelpers.clearInstalledWorktrees();
      expect(_testHelpers.getInstalledWorktrees().size).toBe(0);
      logSpy.mockRestore();
    });

    test('getInstalledWorktrees returns the set', () => {
      expect(_testHelpers.getInstalledWorktrees()).toBeInstanceOf(Set);
    });
  });

  // -------------------------------------------------------------------------
  // Backward compatibility (AC6)
  // -------------------------------------------------------------------------

  describe('backward compatibility', () => {
    test('runQualityCheck works with two args (no options)', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.passed).toBe(true);
      expect(result.storyId).toBeUndefined();
    });

    test('runAllQualityChecks works with two args (no options)', async () => {
      const results = await runAllQualityChecks([makeCheck()], WORKSPACE);
      expect(results).toHaveLength(1);
      expect(results[0].storyId).toBeUndefined();
    });

    test('CWD is workspacePath without storyId', async () => {
      await runQualityCheck(makeCheck(), '/my/workspace');
      const call = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(call?.cwd).toBe('/my/workspace');
    });
  });
});
