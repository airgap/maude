import { describe, test, expect, beforeEach, mock } from 'bun:test';
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
  });
});
