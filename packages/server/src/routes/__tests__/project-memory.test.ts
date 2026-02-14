import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

import { projectMemoryRoutes as app } from '../project-memory';

function clearTables() {
  testDb.exec('DELETE FROM project_memories');
}

describe('Project Memory Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  describe('GET / — list memories', () => {
    test('returns empty array when no memories', async () => {
      const res = await app.request('/?projectPath=/test');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns memories for project path', async () => {
      testDb
        .query(
          'INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-1', '/test', 'convention', 'tabs', 'Use 2 spaces', 'manual', 1.0, 1, 1000, 1000);

      const res = await app.request('/?projectPath=/test');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].key).toBe('tabs');
    });

    test('filters by category', async () => {
      testDb
        .query(
          'INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-1', '/test', 'convention', 'tabs', 'Use 2 spaces', 'manual', 1.0, 1, 1000, 1000);
      testDb
        .query(
          'INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-2', '/test', 'decision', 'db', 'Use SQLite', 'manual', 1.0, 1, 1000, 1000);

      const res = await app.request('/?projectPath=/test&category=convention');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].category).toBe('convention');
    });
  });

  describe('POST / — create memory', () => {
    test('creates a new memory', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          projectPath: '/test',
          category: 'convention',
          key: 'indent',
          content: 'Use 2 spaces',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
    });

    test('reinforces existing memory by key', async () => {
      testDb
        .query(
          'INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'mem-1',
          '/test',
          'convention',
          'indent',
          'Use 2 spaces',
          'manual',
          0.5,
          1,
          1000,
          1000,
        );

      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          projectPath: '/test',
          category: 'convention',
          key: 'indent',
          content: 'Use 2 spaces for indent',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM project_memories WHERE id = ?').get('mem-1') as any;
      expect(row.times_seen).toBe(2);
      expect(row.content).toBe('Use 2 spaces for indent');
    });
  });

  describe('DELETE /:id — delete memory', () => {
    test('deletes a memory', async () => {
      testDb
        .query(
          'INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-1', '/test', 'convention', 'tabs', 'Use 2 spaces', 'manual', 1.0, 1, 1000, 1000);

      const res = await app.request('/mem-1', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const row = testDb.query('SELECT * FROM project_memories WHERE id = ?').get('mem-1');
      expect(row).toBeNull();
    });
  });

  describe('GET /context — format for system prompt', () => {
    test('returns formatted context', async () => {
      testDb
        .query(
          'INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'mem-1',
          '/test',
          'convention',
          'indent',
          'Use 2 spaces',
          'manual',
          1.0,
          1,
          1000,
          1000,
        );

      const res = await app.request('/context?projectPath=/test');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.context).toContain('indent');
    });
  });
});
