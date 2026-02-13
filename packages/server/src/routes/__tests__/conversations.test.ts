import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Import after mock setup so the module picks up the mock
import { conversationRoutes as app } from '../conversations';

function clearTables() {
  testDb.exec('DELETE FROM messages');
  testDb.exec('DELETE FROM conversations');
}

function insertConversation(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'conv-1',
    title: 'Test Conversation',
    model: 'claude-sonnet-4-5-20250929',
    system_prompt: null,
    project_path: '/tmp/test',
    plan_mode: 0,
    plan_file: null,
    total_tokens: 0,
    permission_mode: 'safe',
    effort: 'high',
    max_budget_usd: null,
    max_turns: null,
    allowed_tools: null,
    disallowed_tools: null,
    cli_session_id: null,
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO conversations (id, title, model, system_prompt, project_path, plan_mode, plan_file,
        total_tokens, permission_mode, effort, max_budget_usd, max_turns, allowed_tools, disallowed_tools,
        cli_session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.title,
      row.model,
      row.system_prompt,
      row.project_path,
      row.plan_mode,
      row.plan_file,
      row.total_tokens,
      row.permission_mode,
      row.effort,
      row.max_budget_usd,
      row.max_turns,
      row.allowed_tools,
      row.disallowed_tools,
      row.cli_session_id,
      row.created_at,
      row.updated_at,
    );
}

function insertMessage(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
    model: null,
    token_count: 0,
    timestamp: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO messages (id, conversation_id, role, content, model, token_count, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.conversation_id,
      row.role,
      row.content,
      row.model,
      row.token_count,
      row.timestamp,
    );
}

describe('Conversation Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  // ---------------------------------------------------------------
  // GET / — List conversations
  // ---------------------------------------------------------------
  describe('GET / — list conversations', () => {
    test('returns empty array when no conversations exist', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns all conversations ordered by updated_at DESC', async () => {
      insertConversation({ id: 'conv-old', title: 'Old', updated_at: 100 });
      insertConversation({ id: 'conv-new', title: 'New', updated_at: 200 });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].id).toBe('conv-new');
      expect(json.data[1].id).toBe('conv-old');
    });

    test('includes message count for each conversation', async () => {
      insertConversation({ id: 'conv-1' });
      insertMessage({ id: 'msg-1', conversation_id: 'conv-1' });
      insertMessage({ id: 'msg-2', conversation_id: 'conv-1' });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data[0].messageCount).toBe(2);
    });

    test('maps snake_case fields to camelCase', async () => {
      insertConversation({
        id: 'conv-1',
        project_path: '/my/project',
        permission_mode: 'trusted',
        effort: 'low',
      });

      const res = await app.request('/');
      const json = await res.json();
      const conv = json.data[0];
      expect(conv.projectPath).toBe('/my/project');
      expect(conv.permissionMode).toBe('trusted');
      expect(conv.effort).toBe('low');
      expect(conv.createdAt).toBeDefined();
      expect(conv.updatedAt).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // GET /:id — Get conversation with messages
  // ---------------------------------------------------------------
  describe('GET /:id — get conversation', () => {
    test('returns 404 for non-existent conversation', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns conversation with messages', async () => {
      insertConversation({ id: 'conv-1', title: 'My Chat', model: 'claude-opus-4-6' });
      insertMessage({
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: JSON.stringify([{ type: 'text', text: 'Hi' }]),
        token_count: 10,
        timestamp: 100,
      });
      insertMessage({
        id: 'msg-2',
        conversation_id: 'conv-1',
        role: 'assistant',
        content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
        model: 'claude-opus-4-6',
        token_count: 20,
        timestamp: 200,
      });

      const res = await app.request('/conv-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('conv-1');
      expect(json.data.title).toBe('My Chat');
      expect(json.data.model).toBe('claude-opus-4-6');
      expect(json.data.messages).toHaveLength(2);
      expect(json.data.messages[0].role).toBe('user');
      expect(json.data.messages[0].content).toEqual([{ type: 'text', text: 'Hi' }]);
      expect(json.data.messages[1].role).toBe('assistant');
    });

    test('returns messages ordered by timestamp ASC', async () => {
      insertConversation({ id: 'conv-1' });
      insertMessage({ id: 'msg-late', conversation_id: 'conv-1', timestamp: 300 });
      insertMessage({ id: 'msg-early', conversation_id: 'conv-1', timestamp: 100 });

      const res = await app.request('/conv-1');
      const json = await res.json();
      expect(json.data.messages[0].id).toBe('msg-early');
      expect(json.data.messages[1].id).toBe('msg-late');
    });

    test('parses plan_mode as boolean', async () => {
      insertConversation({ id: 'conv-1', plan_mode: 1 });
      const res = await app.request('/conv-1');
      const json = await res.json();
      expect(json.data.planMode).toBe(true);
    });

    test('parses allowed_tools and disallowed_tools as arrays', async () => {
      insertConversation({
        id: 'conv-1',
        allowed_tools: JSON.stringify(['Read', 'Write']),
        disallowed_tools: JSON.stringify(['Bash']),
      });
      const res = await app.request('/conv-1');
      const json = await res.json();
      expect(json.data.allowedTools).toEqual(['Read', 'Write']);
      expect(json.data.disallowedTools).toEqual(['Bash']);
    });

    test('returns undefined for null allowed_tools/disallowed_tools', async () => {
      insertConversation({ id: 'conv-1' });
      const res = await app.request('/conv-1');
      const json = await res.json();
      expect(json.data.allowedTools).toBeUndefined();
      expect(json.data.disallowedTools).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // POST / — Create conversation
  // ---------------------------------------------------------------
  describe('POST / — create conversation', () => {
    test('creates a conversation with defaults', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();

      // Verify the record exists in DB
      const row = testDb.query('SELECT * FROM conversations WHERE id = ?').get(json.data.id) as any;
      expect(row.title).toBe('New Conversation');
      expect(row.model).toBe('claude-sonnet-4-5-20250929');
      expect(row.permission_mode).toBe('default');
      expect(row.effort).toBe('high');
    });

    test('creates a conversation with custom values', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Custom Chat',
          model: 'claude-opus-4-6',
          systemPrompt: 'Be helpful',
          projectPath: '/my/project',
          permissionMode: 'trusted',
          effort: 'low',
          maxBudgetUsd: 5.0,
          maxTurns: 10,
          allowedTools: ['Read', 'Grep'],
          disallowedTools: ['Bash'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      const id = json.data.id;

      const row = testDb.query('SELECT * FROM conversations WHERE id = ?').get(id) as any;
      expect(row.title).toBe('Custom Chat');
      expect(row.model).toBe('claude-opus-4-6');
      expect(row.system_prompt).toBe('Be helpful');
      expect(row.project_path).toBe('/my/project');
      expect(row.permission_mode).toBe('trusted');
      expect(row.effort).toBe('low');
      expect(row.max_budget_usd).toBe(5.0);
      expect(row.max_turns).toBe(10);
      expect(JSON.parse(row.allowed_tools)).toEqual(['Read', 'Grep']);
      expect(JSON.parse(row.disallowed_tools)).toEqual(['Bash']);
    });

    test('returns unique ids for multiple creates', async () => {
      const res1 = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res2 = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const json1 = await res1.json();
      const json2 = await res2.json();
      expect(json1.data.id).not.toBe(json2.data.id);
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:id — Update conversation
  // ---------------------------------------------------------------
  describe('PATCH /:id — update conversation', () => {
    test('updates title', async () => {
      insertConversation({ id: 'conv-1', title: 'Old Title' });
      const res = await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'New Title' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT title FROM conversations WHERE id = ?').get('conv-1') as any;
      expect(row.title).toBe('New Title');
    });

    test('updates model', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ model: 'claude-opus-4-6' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb.query('SELECT model FROM conversations WHERE id = ?').get('conv-1') as any;
      expect(row.model).toBe('claude-opus-4-6');
    });

    test('updates projectPath', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ projectPath: '/new/path' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT project_path FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.project_path).toBe('/new/path');
    });

    test('updates planMode as integer', async () => {
      insertConversation({ id: 'conv-1', plan_mode: 0 });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ planMode: true }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT plan_mode FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.plan_mode).toBe(1);
    });

    test('updates planFile', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ planFile: '/tmp/plan.md' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT plan_file FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.plan_file).toBe('/tmp/plan.md');
    });

    test('updates permissionMode', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ permissionMode: 'trusted' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT permission_mode FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.permission_mode).toBe('trusted');
    });

    test('updates effort', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ effort: 'low' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT effort FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.effort).toBe('low');
    });

    test('updates maxBudgetUsd and maxTurns', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ maxBudgetUsd: 10.5, maxTurns: 25 }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT max_budget_usd, max_turns FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.max_budget_usd).toBe(10.5);
      expect(row.max_turns).toBe(25);
    });

    test('updates allowedTools and disallowedTools as JSON', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ allowedTools: ['Read'], disallowedTools: ['Bash'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT allowed_tools, disallowed_tools FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(JSON.parse(row.allowed_tools)).toEqual(['Read']);
      expect(JSON.parse(row.disallowed_tools)).toEqual(['Bash']);
    });

    test('updates cliSessionId', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ cliSessionId: 'session-abc' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT cli_session_id FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.cli_session_id).toBe('session-abc');
    });

    test('updates updated_at timestamp', async () => {
      insertConversation({ id: 'conv-1', updated_at: 1000 });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Changed' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT updated_at FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });

    test('updates multiple fields at once', async () => {
      insertConversation({ id: 'conv-1' });
      await app.request('/conv-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated', model: 'claude-opus-4-6', effort: 'low' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb
        .query('SELECT title, model, effort FROM conversations WHERE id = ?')
        .get('conv-1') as any;
      expect(row.title).toBe('Updated');
      expect(row.model).toBe('claude-opus-4-6');
      expect(row.effort).toBe('low');
    });
  });

  // ---------------------------------------------------------------
  // GET /:id/cost — Cost endpoint
  // ---------------------------------------------------------------
  describe('GET /:id/cost — cost calculation', () => {
    test('returns 404 for non-existent conversation', async () => {
      const res = await app.request('/nonexistent/cost');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns zero cost when no tokens', async () => {
      insertConversation({ id: 'conv-1', total_tokens: 0 });

      const res = await app.request('/conv-1/cost');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.totalTokens).toBe(0);
      expect(json.data.inputTokens).toBe(0);
      expect(json.data.outputTokens).toBe(0);
      expect(json.data.estimatedCostUsd).toBe(0);
    });

    test('calculates cost from per-message token counts', async () => {
      insertConversation({ id: 'conv-1', model: 'claude-sonnet-4-5-20250929', total_tokens: 1000 });
      insertMessage({
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        token_count: 400,
      });
      insertMessage({
        id: 'msg-2',
        conversation_id: 'conv-1',
        role: 'assistant',
        token_count: 600,
      });

      const res = await app.request('/conv-1/cost');
      const json = await res.json();
      expect(json.data.inputTokens).toBe(400);
      expect(json.data.outputTokens).toBe(600);
      expect(json.data.model).toBe('claude-sonnet-4-5-20250929');
      // Sonnet pricing: input $3/M, output $15/M
      // (400/1M * 3) + (600/1M * 15) = 0.0012 + 0.009 = 0.0102
      expect(json.data.estimatedCostUsd).toBe(0.0102);
    });

    test('falls back to 30/70 split when no per-message data', async () => {
      insertConversation({
        id: 'conv-1',
        model: 'claude-sonnet-4-5-20250929',
        total_tokens: 10000,
      });

      const res = await app.request('/conv-1/cost');
      const json = await res.json();
      // 30% input = 3000, 70% output = 7000
      expect(json.data.inputTokens).toBe(3000);
      expect(json.data.outputTokens).toBe(7000);
      // (3000/1M * 3) + (7000/1M * 15) = 0.009 + 0.105 = 0.114
      expect(json.data.estimatedCostUsd).toBe(0.114);
    });

    test('uses opus pricing for opus model', async () => {
      insertConversation({ id: 'conv-1', model: 'claude-opus-4-6', total_tokens: 10000 });

      const res = await app.request('/conv-1/cost');
      const json = await res.json();
      // 30% input = 3000, 70% output = 7000
      // Opus pricing: input $15/M, output $75/M
      // (3000/1M * 15) + (7000/1M * 75) = 0.045 + 0.525 = 0.57
      expect(json.data.estimatedCostUsd).toBe(0.57);
    });

    test('uses per-message data even when total_tokens is set', async () => {
      // If messages have token counts, those should be used instead of the fallback split
      insertConversation({ id: 'conv-1', model: 'claude-sonnet-4-5-20250929', total_tokens: 5000 });
      insertMessage({
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        token_count: 100,
      });
      insertMessage({
        id: 'msg-2',
        conversation_id: 'conv-1',
        role: 'assistant',
        token_count: 200,
      });

      const res = await app.request('/conv-1/cost');
      const json = await res.json();
      expect(json.data.inputTokens).toBe(100);
      expect(json.data.outputTokens).toBe(200);
    });

    test('handles messages with null token_count', async () => {
      insertConversation({ id: 'conv-1', model: 'claude-sonnet-4-5-20250929', total_tokens: 1000 });
      insertMessage({
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        token_count: null as any,
      });
      insertMessage({
        id: 'msg-2',
        conversation_id: 'conv-1',
        role: 'assistant',
        token_count: null as any,
      });

      const res = await app.request('/conv-1/cost');
      const json = await res.json();
      // All token_counts are null/0, so fallback to 30/70 split
      expect(json.data.inputTokens).toBe(300);
      expect(json.data.outputTokens).toBe(700);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:id — Delete conversation
  // ---------------------------------------------------------------
  describe('DELETE /:id — delete conversation', () => {
    test('deletes an existing conversation', async () => {
      insertConversation({ id: 'conv-1' });

      const res = await app.request('/conv-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM conversations WHERE id = ?').get('conv-1');
      expect(row).toBeNull();
    });

    test('returns ok even when conversation does not exist', async () => {
      const res = await app.request('/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('cascade deletes messages', async () => {
      insertConversation({ id: 'conv-1' });
      insertMessage({ id: 'msg-1', conversation_id: 'conv-1' });
      insertMessage({ id: 'msg-2', conversation_id: 'conv-1' });

      await app.request('/conv-1', { method: 'DELETE' });

      const messages = testDb
        .query('SELECT * FROM messages WHERE conversation_id = ?')
        .all('conv-1');
      expect(messages).toHaveLength(0);
    });
  });
});
