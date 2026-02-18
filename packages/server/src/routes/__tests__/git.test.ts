import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

import { gitRoutes as app } from '../git';

function clearTables() {
  testDb.exec('DELETE FROM git_snapshots');
}

describe('Git Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  describe('GET /snapshots — list snapshots', () => {
    test('requires path query param', async () => {
      const res = await app.request('/snapshots');
      expect(res.status).toBe(400);
    });

    test('returns empty array when no snapshots', async () => {
      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns snapshots ordered by created_at DESC', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'abc123', 'pre-agent', 0, 100);
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-2', '/test', 'def456', 'pre-agent', 1, 200);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0].id).toBe('snap-2');
      expect(json.data[1].id).toBe('snap-1');
    });

    test('maps snapshot fields to camelCase', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'conv-1', 'abc123', 'stash456', 'pre-agent', 1, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      const snap = json.data[0];
      expect(snap.id).toBe('snap-1');
      expect(snap.workspacePath).toBe('/test');
      expect(snap.conversationId).toBe('conv-1');
      expect(snap.headSha).toBe('abc123');
      expect(snap.stashSha).toBe('stash456');
      expect(snap.reason).toBe('pre-agent');
      expect(snap.hasChanges).toBe(true);
      expect(snap.createdAt).toBe(1000);
    });

    test('hasChanges is false when has_changes is 0', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'abc123', 'pre-agent', 0, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].hasChanges).toBe(false);
    });

    test('filters by workspace_path', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/project-a', 'abc', 'pre-agent', 0, 100);
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-2', '/project-b', 'def', 'pre-agent', 0, 200);

      const res = await app.request('/snapshots?path=/project-a');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('snap-1');
    });

    test('returns null conversationId when not set', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', null, 'abc123', 'pre-agent', 0, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].conversationId).toBeNull();
    });

    test('returns null stashSha when not set', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'abc123', null, 'pre-agent', 0, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].stashSha).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot — create snapshot (validation)
  // ---------------------------------------------------------------
  describe('POST /snapshot — validation', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot/:id/restore — restore snapshot
  // ---------------------------------------------------------------
  describe('POST /snapshot/:id/restore — restore snapshot', () => {
    test('returns 404 for non-existent snapshot', async () => {
      const res = await app.request('/snapshot/nonexistent/restore', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Snapshot not found');
    });
  });

  // ---------------------------------------------------------------
  // GET /diff — git diff
  // ---------------------------------------------------------------
  describe('GET /diff — validation', () => {
    test('returns 400 when file parameter is missing', async () => {
      const res = await app.request('/diff');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('file parameter required');
    });

    test('returns 400 when file parameter is missing but path is provided', async () => {
      const res = await app.request('/diff?path=/test');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('file parameter required');
    });
  });
});

// ---------------------------------------------------------------------------
// Helper: create a mock Bun.spawn process
// ---------------------------------------------------------------------------
function mockProc(stdout: string, exitCode: number, stderr = '') {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(exitCode),
    pid: 1234,
    stdin: undefined,
    kill: () => {},
    ref: () => {},
    unref: () => {},
    exitCode: null,
    signalCode: null,
    killed: false,
    readable: new ReadableStream(),
    resourceUsage: () => ({
      userCPUTime: 0,
      systemCPUTime: 0,
      maxRSS: 0,
      sharedMemorySize: 0,
      unsharedDataSize: 0,
      unsharedStackSize: 0,
      minorPageFault: 0,
      majorPageFault: 0,
      swappedOut: 0,
      fsRead: 0,
      fsWrite: 0,
      ipcSent: 0,
      ipcReceived: 0,
      signalsCount: 0,
      voluntaryContextSwitches: 0,
      involuntaryContextSwitches: 0,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests that mock Bun.spawn for git command endpoints
// ---------------------------------------------------------------------------
describe('Git Routes — Bun.spawn mocked', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Reset DB tables used by snapshot endpoints
    testDb.exec('DELETE FROM git_snapshots');
  });

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  // ---------------------------------------------------------------
  // GET /status
  // ---------------------------------------------------------------
  describe('GET /status', () => {
    test('parses porcelain output with modified files', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc(' M src/app.ts\n M README.md\n', 0) as any,
      );

      const res = await app.request('/status?path=/myproject');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.isRepo).toBe(true);
      expect(json.data.files).toHaveLength(2);
      expect(json.data.files[0]).toEqual({ path: 'src/app.ts', status: 'M', staged: false });
      expect(json.data.files[1]).toEqual({ path: 'README.md', status: 'M', staged: false });
    });

    test('parses untracked files', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('?? newfile.ts\n', 0) as any);

      const res = await app.request('/status?path=/myproject');
      const json = await res.json();
      expect(json.data.files).toHaveLength(1);
      expect(json.data.files[0]).toEqual({ path: 'newfile.ts', status: 'U', staged: false });
    });

    test('parses staged added files', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('A  new.ts\n', 0) as any);

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0]).toEqual({ path: 'new.ts', status: 'A', staged: true });
    });

    test('parses staged deleted files', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('D  removed.ts\n', 0) as any);

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0]).toEqual({ path: 'removed.ts', status: 'D', staged: true });
    });

    test('parses renamed files', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('R  old.ts -> new.ts\n', 0) as any);

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0].status).toBe('R');
      expect(json.data.files[0].staged).toBe(true);
    });

    test('parses staged modified files (M in index)', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('M  staged.ts\n', 0) as any);

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0]).toEqual({ path: 'staged.ts', status: 'M', staged: true });
    });

    test('returns isRepo=false when exit code is non-zero', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 128, 'fatal: not a git repository') as any,
      );

      const res = await app.request('/status?path=/not-a-repo');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.isRepo).toBe(false);
      expect(json.data.files).toEqual([]);
    });

    test('returns empty files array for clean repo', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 0) as any);

      const res = await app.request('/status?path=/clean');
      const json = await res.json();
      expect(json.data.isRepo).toBe(true);
      expect(json.data.files).toEqual([]);
    });

    test('returns isRepo=false when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn failed');
      });

      const res = await app.request('/status?path=/err');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.isRepo).toBe(false);
      expect(json.data.files).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // GET /branch
  // ---------------------------------------------------------------
  describe('GET /branch', () => {
    test('returns the current branch name', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('main\n', 0) as any);

      const res = await app.request('/branch?path=/proj');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.branch).toBe('main');
    });

    test('trims whitespace from branch name', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('  feature/foo  \n', 0) as any);

      const res = await app.request('/branch?path=/proj');
      const json = await res.json();
      expect(json.data.branch).toBe('feature/foo');
    });

    test('returns empty branch when exit code is non-zero', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 128, 'fatal: not a git repository') as any,
      );

      const res = await app.request('/branch?path=/not-a-repo');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.branch).toBe('');
    });

    test('returns empty branch when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn failed');
      });

      const res = await app.request('/branch?path=/err');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.branch).toBe('');
    });
  });

  // ---------------------------------------------------------------
  // GET /diff
  // ---------------------------------------------------------------
  describe('GET /diff', () => {
    test('returns diff output for a file', async () => {
      const diffOutput = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
+import { foo } from 'bar';
 const x = 1;
`;
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc(diffOutput, 0) as any);

      const res = await app.request('/diff?path=/proj&file=src/app.ts');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.diff).toBe(diffOutput);
    });

    test('passes staged flag to git diff --cached', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('staged diff output', 0) as any);

      const res = await app.request('/diff?path=/proj&file=src/app.ts&staged=true');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.diff).toBe('staged diff output');

      // Verify that git diff --cached was called
      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      expect(callArgs).toContain('--cached');
    });

    test('does not pass --cached without staged=true', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('unstaged diff', 0) as any);

      const res = await app.request('/diff?path=/proj&file=src/app.ts');
      await res.json();

      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      expect(callArgs).not.toContain('--cached');
      expect(callArgs).toContain('--');
      expect(callArgs).toContain('src/app.ts');
    });

    test('returns error when git diff fails with non-zero exit', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 1, 'fatal: bad file') as any);

      const res = await app.request('/diff?path=/proj&file=bad.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('fatal: bad file');
    });

    test('returns generic error when git diff fails with empty stderr', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 1, '') as any);

      const res = await app.request('/diff?path=/proj&file=bad.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('git diff failed');
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn error');
      });

      const res = await app.request('/diff?path=/proj&file=x.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('spawn error');
    });

    test('returns empty diff for unchanged file', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 0) as any);

      const res = await app.request('/diff?path=/proj&file=clean.ts');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.diff).toBe('');
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot — with mocked Bun.spawn
  // ---------------------------------------------------------------
  describe('POST /snapshot — git commands mocked', () => {
    test('creates a snapshot when repo has changes', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse HEAD
            return mockProc('abc123def456\n', 0) as any;
          case 3: // git status --porcelain
            return mockProc(' M src/app.ts\n', 0) as any;
          case 4: // git stash create
            return mockProc('stash789xyz\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/myproject', conversationId: 'conv-1', reason: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.headSha).toBe('abc123def456');
      expect(json.data.stashSha).toBe('stash789xyz');
      expect(json.data.hasChanges).toBe(true);
      expect(json.data.id).toBeDefined();

      // Verify it was stored in the database
      const row = testDb.query('SELECT * FROM git_snapshots WHERE id = ?').get(json.data.id) as any;
      expect(row).toBeDefined();
      expect(row.head_sha).toBe('abc123def456');
      expect(row.stash_sha).toBe('stash789xyz');
      expect(row.has_changes).toBe(1);
      expect(row.reason).toBe('test');
      expect(row.conversation_id).toBe('conv-1');
    });

    test('creates a snapshot without stash when no changes', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse HEAD
            return mockProc('headsha123\n', 0) as any;
          case 3: // git status --porcelain
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/clean-project' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.headSha).toBe('headsha123');
      expect(json.data.stashSha).toBeNull();
      expect(json.data.hasChanges).toBe(false);

      // Should NOT have called stash create (only 3 spawn calls)
      expect(spawnSpy).toHaveBeenCalledTimes(3);
    });

    test('returns 400 when not a git repo', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('false\n', 0) as any);

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/not-a-repo' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not a git repo');
    });

    test('returns 400 when no commits yet', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse HEAD — fails (no commits)
            return mockProc('', 128, 'fatal: bad default revision') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/empty-repo' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('No commits yet');
    });

    test('returns 500 when an unexpected error occurs', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('something went wrong');
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('something went wrong');
    });

    test('uses default reason when not provided', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('sha456\n', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const row = testDb.query('SELECT * FROM git_snapshots WHERE id = ?').get(json.data.id) as any;
      expect(row.reason).toBe('pre-agent');
    });

    test('stores null stashSha when stash create returns empty', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('headabc\n', 0) as any;
          case 3:
            return mockProc(' M file.ts\n', 0) as any;
          case 4: // git stash create returns empty (no stash needed)
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.stashSha).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot/:id/restore — with mocked Bun.spawn
  // ---------------------------------------------------------------
  describe('POST /snapshot/:id/restore — git commands mocked', () => {
    test('restores a snapshot without stash', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-1', '/proj', 'headabc', null, 'pre-agent', 0, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('HEAD is now at headabc\n', 0) as any,
      );

      const res = await app.request('/snapshot/restore-1/restore', { method: 'POST' });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.restored).toBe(true);

      // Only reset was called, no stash apply
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    });

    test('restores a snapshot with stash apply', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-2', '/proj', 'headabc', 'stash123', 'pre-agent', 1, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 0) as any);

      const res = await app.request('/snapshot/restore-2/restore', { method: 'POST' });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.restored).toBe(true);

      // Both reset and stash apply were called
      expect(spawnSpy).toHaveBeenCalledTimes(2);
    });

    test('returns 500 when git reset fails', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-fail', '/proj', 'badsha', null, 'pre-agent', 0, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 1, 'fatal: could not reset') as any,
      );

      const res = await app.request('/snapshot/restore-fail/restore', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Reset failed');
    });

    test('returns 500 when spawn throws during restore', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-err', '/proj', 'sha', null, 'pre-agent', 0, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('restore spawn failed');
      });

      const res = await app.request('/snapshot/restore-err/restore', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('restore spawn failed');
    });
  });
});
