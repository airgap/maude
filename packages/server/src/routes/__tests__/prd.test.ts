import { describe, test, expect, beforeEach, mock, afterEach } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock the Anthropic API calls — we don't want real API calls in tests
let mockFetchResponse: any = null;
const originalFetch = globalThis.fetch;

import { prdRoutes as app } from '../prd';

function clearTables() {
  testDb.exec('DELETE FROM prd_stories');
  testDb.exec('DELETE FROM prds');
  testDb.exec('DELETE FROM project_memories');
  testDb.exec('DELETE FROM conversations');
}

function insertPrd(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'prd-1',
    project_path: '/test/project',
    name: 'Test PRD',
    description: 'A test product requirements document',
    branch_name: null,
    quality_checks: '[]',
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO prds (id, project_path, name, description, branch_name, quality_checks, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.project_path,
      row.name,
      row.description,
      row.branch_name,
      row.quality_checks,
      row.created_at,
      row.updated_at,
    );
}

function insertStory(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'story-1',
    prd_id: 'prd-1',
    title: 'Test Story',
    description: 'A test story description',
    acceptance_criteria: JSON.stringify([
      { id: 'ac-1', description: 'First criterion', passed: false },
      { id: 'ac-2', description: 'Second criterion', passed: false },
      { id: 'ac-3', description: 'Third criterion', passed: false },
    ]),
    priority: 'medium',
    depends_on: '[]',
    status: 'pending',
    task_id: null,
    agent_id: null,
    conversation_id: null,
    commit_sha: null,
    attempts: 0,
    max_attempts: 3,
    learnings: '[]',
    sort_order: 0,
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, status, task_id, agent_id, conversation_id, commit_sha, attempts, max_attempts, learnings, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.prd_id,
      row.title,
      row.description,
      row.acceptance_criteria,
      row.priority,
      row.depends_on,
      row.status,
      row.task_id,
      row.agent_id,
      row.conversation_id,
      row.commit_sha,
      row.attempts,
      row.max_attempts,
      row.learnings,
      row.sort_order,
      row.created_at,
      row.updated_at,
    );
}

function insertMemory(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'mem-1',
    project_path: '/test/project',
    category: 'convention',
    key: 'test-convention',
    content: 'Use TypeScript strict mode',
    source: 'manual',
    confidence: 0.9,
    times_seen: 1,
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO project_memories (id, project_path, category, key, content, source, confidence, times_seen, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.project_path,
      row.category,
      row.key,
      row.content,
      row.source,
      row.confidence,
      row.times_seen,
      row.created_at,
      row.updated_at,
    );
}

describe('PRD Routes', () => {
  beforeEach(() => {
    clearTables();
    mockFetchResponse = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------------------------------------------------------------
  // GET / — List PRDs
  // ---------------------------------------------------------------
  describe('GET / — list PRDs', () => {
    test('returns empty array when no PRDs exist', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns all PRDs ordered by updated_at DESC', async () => {
      insertPrd({ id: 'prd-old', name: 'Old', updated_at: 100 });
      insertPrd({ id: 'prd-new', name: 'New', updated_at: 200 });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0].id).toBe('prd-new');
      expect(json.data[1].id).toBe('prd-old');
    });

    test('filters by projectPath query param', async () => {
      insertPrd({ id: 'prd-a', project_path: '/project-a' });
      insertPrd({ id: 'prd-b', project_path: '/project-b' });

      const res = await app.request('/?projectPath=/project-a');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('prd-a');
    });

    test('maps row to camelCase shape', async () => {
      insertPrd({
        id: 'prd-1',
        project_path: '/my/project',
        name: 'My PRD',
        description: 'desc',
        branch_name: 'feature/test',
        quality_checks: '[{"id":"qc-1","type":"typecheck"}]',
        created_at: 100,
        updated_at: 200,
      });

      const res = await app.request('/');
      const json = await res.json();
      const prd = json.data[0];
      expect(prd.id).toBe('prd-1');
      expect(prd.projectPath).toBe('/my/project');
      expect(prd.name).toBe('My PRD');
      expect(prd.description).toBe('desc');
      expect(prd.branchName).toBe('feature/test');
      expect(prd.qualityChecks).toEqual([{ id: 'qc-1', type: 'typecheck' }]);
      expect(prd.createdAt).toBe(100);
      expect(prd.updatedAt).toBe(200);
    });
  });

  // ---------------------------------------------------------------
  // GET /:id — Get single PRD with stories
  // ---------------------------------------------------------------
  describe('GET /:id — get PRD', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns PRD with stories', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', sort_order: 1, title: 'Second' });
      insertStory({ id: 'story-2', prd_id: 'prd-1', sort_order: 0, title: 'First' });

      const res = await app.request('/prd-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('prd-1');
      expect(json.data.stories).toHaveLength(2);
      // Ordered by sort_order ASC
      expect(json.data.stories[0].title).toBe('First');
      expect(json.data.stories[1].title).toBe('Second');
    });

    test('returns stories with properly mapped fields', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({
        id: 'story-1',
        prd_id: 'prd-1',
        title: 'My Story',
        description: 'Story desc',
        priority: 'high',
        status: 'in_progress',
        depends_on: '["story-0"]',
        learnings: '["learned something"]',
        attempts: 2,
        max_attempts: 5,
      });

      const res = await app.request('/prd-1');
      const json = await res.json();
      const story = json.data.stories[0];
      expect(story.id).toBe('story-1');
      expect(story.prdId).toBe('prd-1');
      expect(story.title).toBe('My Story');
      expect(story.description).toBe('Story desc');
      expect(story.priority).toBe('high');
      expect(story.status).toBe('in_progress');
      expect(story.dependsOn).toEqual(['story-0']);
      expect(story.learnings).toEqual(['learned something']);
      expect(story.attempts).toBe(2);
      expect(story.maxAttempts).toBe(5);
      expect(story.acceptanceCriteria).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------
  // POST / — Create PRD with stories
  // ---------------------------------------------------------------
  describe('POST / — create PRD', () => {
    test('creates a PRD with stories', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          projectPath: '/test/project',
          name: 'New PRD',
          description: 'Build a thing',
          stories: [
            {
              title: 'Story One',
              description: 'First story',
              acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
              priority: 'high',
            },
            {
              title: 'Story Two',
              description: 'Second story',
              acceptanceCriteria: ['AC A', 'AC B', 'AC C'],
            },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
      expect(json.data.storyIds).toHaveLength(2);

      // Verify stories in DB
      const stories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order')
        .all(json.data.id) as any[];
      expect(stories).toHaveLength(2);
      expect(stories[0].title).toBe('Story One');
      expect(stories[0].priority).toBe('high');
      expect(stories[1].title).toBe('Story Two');
      expect(stories[1].priority).toBe('medium'); // default

      // Verify acceptance criteria are properly formed
      const criteria = JSON.parse(stories[0].acceptance_criteria);
      expect(criteria).toHaveLength(3);
      expect(criteria[0].description).toBe('AC 1');
      expect(criteria[0].passed).toBe(false);
      expect(criteria[0].id).toBeDefined();
    });

    test('creates PRD with no stories', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          projectPath: '/test/project',
          name: 'Empty PRD',
          description: '',
          stories: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.storyIds).toHaveLength(0);
    });

    test('creates PRD with quality checks', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          projectPath: '/test/project',
          name: 'PRD with Checks',
          stories: [],
          qualityChecks: [
            { id: 'qc-1', type: 'typecheck', name: 'TypeCheck', command: 'bun run check', timeout: 30000, required: true, enabled: true },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const row = testDb.query('SELECT quality_checks FROM prds WHERE id = ?').get(json.data.id) as any;
      const checks = JSON.parse(row.quality_checks);
      expect(checks).toHaveLength(1);
      expect(checks[0].type).toBe('typecheck');
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:id — Update PRD
  // ---------------------------------------------------------------
  describe('PATCH /:id — update PRD', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('updates name and description', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name', description: 'New desc' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.name).toBe('Updated Name');
      expect(row.description).toBe('New desc');
    });

    test('updates branchName', async () => {
      insertPrd({ id: 'prd-1' });

      await app.request('/prd-1', {
        method: 'PATCH',
        body: JSON.stringify({ branchName: 'feature/new-branch' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT branch_name FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.branch_name).toBe('feature/new-branch');
    });

    test('returns 400 when no fields to update', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:id — Delete PRD
  // ---------------------------------------------------------------
  describe('DELETE /:id — delete PRD', () => {
    test('deletes a PRD', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM prds WHERE id = ?').get('prd-1');
      expect(row).toBeNull();
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    test('cascades delete to stories', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });
      insertStory({ id: 'story-2', prd_id: 'prd-1' });

      await app.request('/prd-1', { method: 'DELETE' });

      const stories = testDb.query('SELECT * FROM prd_stories WHERE prd_id = ?').all('prd-1');
      expect(stories).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/stories — Add story to PRD
  // ---------------------------------------------------------------
  describe('POST /:id/stories — add story', () => {
    test('adds a story to an existing PRD', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'New Story',
          description: 'A new story',
          acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
          priority: 'high',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/stories', {
        method: 'POST',
        body: JSON.stringify({ title: 'Story', acceptanceCriteria: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('increments sort_order based on existing stories', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', sort_order: 0 });
      insertStory({ id: 'story-2', prd_id: 'prd-1', sort_order: 1 });

      const res = await app.request('/prd-1/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Third Story',
          acceptanceCriteria: ['AC'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const row = testDb.query('SELECT sort_order FROM prd_stories WHERE id = ?').get(json.data.id) as any;
      expect(row.sort_order).toBe(2);
    });

    test('touches PRD updated_at', async () => {
      insertPrd({ id: 'prd-1', updated_at: 1000 });

      await app.request('/prd-1/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Story',
          acceptanceCriteria: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:prdId/stories/:storyId — Update story
  // ---------------------------------------------------------------
  describe('PATCH /:prdId/stories/:storyId — update story', () => {
    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('updates title and description', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title', description: 'Updated Description' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.title).toBe('Updated Title');
      expect(json.data.description).toBe('Updated Description');
    });

    test('updates status and priority', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', status: 'pending', priority: 'medium' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', priority: 'critical' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.status).toBe('completed');
      expect(json.data.priority).toBe('critical');
    });

    test('appends a learning with addLearning', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', learnings: '["first learning"]' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ addLearning: 'second learning' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.learnings).toEqual(['first learning', 'second learning']);
    });

    test('returns 400 when no fields to update', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:prdId/stories/:storyId — Delete story
  // ---------------------------------------------------------------
  describe('DELETE /:prdId/stories/:storyId — delete story', () => {
    test('deletes a story', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM prd_stories WHERE id = ?').get('story-1');
      expect(row).toBeNull();
    });

    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    test('touches PRD updated_at', async () => {
      insertPrd({ id: 'prd-1', updated_at: 1000 });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      await app.request('/prd-1/stories/story-1', { method: 'DELETE' });

      const row = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // POST /import — Import Ralph-format PRD
  // ---------------------------------------------------------------
  describe('POST /import — import PRD', () => {
    test('imports a Ralph-format PRD', async () => {
      const ralphPrd = {
        project: 'My Project',
        branchName: 'ralph/my-project',
        description: 'A project',
        userStories: [
          {
            id: 'US-001',
            title: 'Story A',
            description: 'First story',
            acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
            priority: 2,
            passes: false,
          },
          {
            id: 'US-002',
            title: 'Story B',
            description: 'Second story',
            acceptanceCriteria: ['AC4'],
            priority: 1,
            passes: true,
          },
        ],
      };

      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({ projectPath: '/test/project', prdJson: ralphPrd }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.imported).toBe(2);

      // Check stories
      const stories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order')
        .all(json.data.id) as any[];
      expect(stories).toHaveLength(2);
      expect(stories[0].priority).toBe('high'); // priority 2 maps to 'high'
      expect(stories[1].priority).toBe('critical'); // priority 1 maps to 'critical'
      expect(stories[1].status).toBe('completed'); // passes: true maps to 'completed'
    });

    test('returns 400 when missing required fields', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------
  // GET /:id/export — Export PRD as Ralph-compatible format
  // ---------------------------------------------------------------
  describe('GET /:id/export — export PRD', () => {
    test('exports a PRD in Ralph format', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD', branch_name: 'feature/test' });
      insertStory({
        id: 'story-1',
        prd_id: 'prd-1',
        title: 'Story A',
        description: 'First',
        priority: 'high',
        status: 'completed',
        sort_order: 0,
      });
      insertStory({
        id: 'story-2',
        prd_id: 'prd-1',
        title: 'Story B',
        description: 'Second',
        priority: 'low',
        status: 'pending',
        sort_order: 1,
      });

      const res = await app.request('/prd-1/export');
      expect(res.status).toBe(200);
      const json = await res.json();
      const data = json.data;

      expect(data.project).toBe('My PRD');
      expect(data.branchName).toBe('feature/test');
      expect(data.description).toBe('A PRD');
      expect(data.userStories).toHaveLength(2);
      expect(data.userStories[0].id).toBe('US-001');
      expect(data.userStories[0].priority).toBe(2); // 'high' → 2
      expect(data.userStories[0].passes).toBe(true); // 'completed' → true
      expect(data.userStories[1].priority).toBe(4); // 'low' → 4
      expect(data.userStories[1].passes).toBe(false);
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/export');
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/generate/accept — Accept generated stories
  // ---------------------------------------------------------------
  describe('POST /:id/generate/accept — accept generated stories', () => {
    test('bulk-adds generated stories to a PRD', async () => {
      insertPrd({ id: 'prd-1' });

      const stories = [
        {
          title: 'Generated Story 1',
          description: 'First gen story',
          acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
          priority: 'high' as const,
        },
        {
          title: 'Generated Story 2',
          description: 'Second gen story',
          acceptanceCriteria: ['AC A', 'AC B', 'AC C'],
          priority: 'medium' as const,
        },
      ];

      const res = await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.accepted).toBe(2);
      expect(json.data.storyIds).toHaveLength(2);

      // Verify stories in DB
      const dbStories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order')
        .all('prd-1') as any[];
      expect(dbStories).toHaveLength(2);
      expect(dbStories[0].title).toBe('Generated Story 1');
      expect(dbStories[0].priority).toBe('high');
      expect(dbStories[1].title).toBe('Generated Story 2');

      // Verify acceptance criteria
      const criteria = JSON.parse(dbStories[0].acceptance_criteria);
      expect(criteria).toHaveLength(3);
      expect(criteria[0].description).toBe('AC 1');
      expect(criteria[0].passed).toBe(false);
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories: [{ title: 'Story', acceptanceCriteria: [] }] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when no stories provided', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('appends to existing stories with correct sort order', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'existing-1', prd_id: 'prd-1', sort_order: 0 });
      insertStory({ id: 'existing-2', prd_id: 'prd-1', sort_order: 1 });

      const stories = [
        { title: 'New Story', description: 'New', acceptanceCriteria: ['AC'], priority: 'medium' as const },
      ];

      const res = await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const newStoryRow = testDb
        .query('SELECT sort_order FROM prd_stories WHERE id = ?')
        .get(json.data.storyIds[0]) as any;
      expect(newStoryRow.sort_order).toBe(2);
    });

    test('touches PRD updated_at', async () => {
      insertPrd({ id: 'prd-1', updated_at: 1000 });

      const stories = [
        { title: 'Story', description: '', acceptanceCriteria: ['AC'], priority: 'medium' as const },
      ];

      await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/generate — Generate stories (mocked AI)
  // ---------------------------------------------------------------
  describe('POST /:id/generate — generate stories', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when no description provided', async () => {
      insertPrd({ id: 'prd-1', description: '' });

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: '' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('uses PRD description as fallback when request description is empty', async () => {
      insertPrd({ id: 'prd-1', description: 'Build a user auth system' });

      // Mock fetch to simulate AI response
      const mockStories = [
        { title: 'Login', description: 'User login', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'high' },
        { title: 'Register', description: 'User registration', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'high' },
      ];

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify(mockStories) }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      // Set env var for auth
      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.stories).toHaveLength(2);
        expect(json.data.prdId).toBe('prd-1');
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('generates stories with valid structure from AI response', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        {
          title: 'Story One',
          description: 'First story desc',
          acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
          priority: 'critical',
        },
        {
          title: 'Story Two',
          description: 'Second story desc',
          acceptanceCriteria: ['AC A', 'AC B', 'AC C', 'AC D'],
          priority: 'medium',
        },
      ];

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify(mockStories) }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build authentication', count: 5 }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.stories).toHaveLength(2);

        const story1 = json.data.stories[0];
        expect(story1.title).toBe('Story One');
        expect(story1.description).toBe('First story desc');
        expect(story1.acceptanceCriteria).toEqual(['AC 1', 'AC 2', 'AC 3']);
        expect(story1.priority).toBe('critical');

        const story2 = json.data.stories[1];
        expect(story2.acceptanceCriteria).toHaveLength(4);
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('handles markdown code fences in AI response', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        { title: 'Story', description: 'Desc', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'medium' },
      ];

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: '```json\n' + JSON.stringify(mockStories) + '\n```' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.stories).toHaveLength(1);
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('ensures minimum 3 acceptance criteria per story', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        { title: 'Story', description: 'Desc', acceptanceCriteria: ['Only one'], priority: 'medium' },
      ];

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify(mockStories) }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        const story = json.data.stories[0];
        expect(story.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
        expect(story.acceptanceCriteria[0]).toBe('Only one');
        // Placeholder criteria should be added
        expect(story.acceptanceCriteria[1]).toContain('Needs acceptance criterion');
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('validates and defaults invalid priority', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        { title: 'Story', description: 'Desc', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'invalid-priority' },
      ];

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify(mockStories) }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.data.stories[0].priority).toBe('medium'); // defaults to medium
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('filters out stories without titles', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        { title: 'Good Story', description: 'Valid', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'medium' },
        { title: '', description: 'No title', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'medium' },
        { description: 'Missing title field', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'medium' },
      ];

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify(mockStories) }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.data.stories).toHaveLength(1);
        expect(json.data.stories[0].title).toBe('Good Story');
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('handles AI API error gracefully', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response('Rate limited', { status: 429 });
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(502);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error).toContain('AI generation failed');
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('handles invalid JSON in AI response', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: 'This is not valid JSON at all' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        const res = await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(502);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error).toContain('Failed to parse');
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('includes existing stories in prompt context to avoid duplicates', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });
      insertStory({ id: 'existing-1', prd_id: 'prd-1', title: 'Existing Story' });

      let capturedBody: any = null;
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify([
                { title: 'New Story', description: 'New', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'medium' },
              ]) }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        // System prompt should include existing story context
        expect(capturedBody.system).toContain('Existing Story');
        expect(capturedBody.system).toContain('avoid duplicating');
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });

    test('includes project memory context in system prompt', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD', project_path: '/test/project' });
      insertMemory({
        id: 'mem-1',
        project_path: '/test/project',
        category: 'convention',
        key: 'language',
        content: 'Use TypeScript',
        confidence: 0.9,
      });

      let capturedBody: any = null;
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('api.anthropic.com')) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify([
                { title: 'Story', description: 'Desc', acceptanceCriteria: ['AC1', 'AC2', 'AC3'], priority: 'medium' },
              ]) }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const origKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      try {
        await app.request('/prd-1/generate', {
          method: 'POST',
          body: JSON.stringify({ description: 'Build a thing' }),
          headers: { 'Content-Type': 'application/json' },
        });

        // System prompt should include project memory
        expect(capturedBody.system).toContain('Project Memory');
        expect(capturedBody.system).toContain('Use TypeScript');
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
      }
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/plan — Sprint planning
  // ---------------------------------------------------------------
  describe('POST /:id/plan — sprint planning', () => {
    test('creates a planning conversation', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD' });

      const res = await app.request('/prd-1/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'locked' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.conversationId).toBeDefined();
      expect(json.data.prdId).toBe('prd-1');
      expect(json.data.mode).toBe('chat');
      expect(json.data.editMode).toBe('locked');

      // Verify conversation was created
      const conv = testDb.query('SELECT * FROM conversations WHERE id = ?').get(json.data.conversationId) as any;
      expect(conv).toBeDefined();
      expect(conv.title).toContain('[Plan]');
      expect(conv.plan_mode).toBe(1);
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'locked' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('includes story edit blocks for propose mode', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD' });

      const res = await app.request('/prd-1/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'propose' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const conv = testDb.query('SELECT system_prompt FROM conversations WHERE id = ?').get(json.data.conversationId) as any;
      expect(conv.system_prompt).toContain('story-add');
      expect(conv.system_prompt).toContain('story-edit');
      expect(conv.system_prompt).toContain('user will see each suggestion');
    });

    test('includes existing stories context in system prompt', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'Auth Story' });

      const res = await app.request('/prd-1/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'locked' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const conv = testDb.query('SELECT system_prompt FROM conversations WHERE id = ?').get(json.data.conversationId) as any;
      expect(conv.system_prompt).toContain('Auth Story');
    });
  });
});
