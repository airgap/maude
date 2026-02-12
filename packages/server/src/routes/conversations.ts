import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { calculateCost } from '../services/cost-calculator';

const app = new Hono();

// List conversations
app.get('/', (c) => {
  const db = getDb();
  const rows = db
    .query(
      `
    SELECT id, title, model, project_path, plan_mode, total_tokens, permission_mode, effort,
           created_at, updated_at,
           (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) as message_count
    FROM conversations
    ORDER BY updated_at DESC
  `,
    )
    .all();

  return c.json({
    ok: true,
    data: (rows as any[]).map((r) => ({
      id: r.id,
      title: r.title,
      model: r.model,
      projectPath: r.project_path,
      permissionMode: r.permission_mode,
      effort: r.effort,
      messageCount: r.message_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

// Get conversation with messages
app.get('/:id', (c) => {
  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(c.req.param('id')) as any;
  if (!conv) return c.json({ ok: false, error: 'Not found' }, 404);

  const messages = db
    .query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(c.req.param('id'));

  return c.json({
    ok: true,
    data: {
      id: conv.id,
      title: conv.title,
      model: conv.model,
      systemPrompt: conv.system_prompt,
      projectPath: conv.project_path,
      planMode: Boolean(conv.plan_mode),
      planFile: conv.plan_file,
      totalTokens: conv.total_tokens,
      permissionMode: conv.permission_mode,
      effort: conv.effort,
      maxBudgetUsd: conv.max_budget_usd,
      maxTurns: conv.max_turns,
      allowedTools: conv.allowed_tools ? JSON.parse(conv.allowed_tools) : undefined,
      disallowedTools: conv.disallowed_tools ? JSON.parse(conv.disallowed_tools) : undefined,
      cliSessionId: conv.cli_session_id,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: (messages as any[]).map((m) => ({
        id: m.id,
        role: m.role,
        content: JSON.parse(m.content),
        model: m.model,
        tokenCount: m.token_count,
        timestamp: m.timestamp,
      })),
    },
  });
});

// Create conversation
app.post('/', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  db.query(
    `
    INSERT INTO conversations (id, title, model, system_prompt, project_path,
      permission_mode, effort, max_budget_usd, max_turns, allowed_tools, disallowed_tools,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    body.title || 'New Conversation',
    body.model || 'claude-sonnet-4-5-20250929',
    body.systemPrompt || null,
    body.projectPath || process.cwd(),
    body.permissionMode || 'default',
    body.effort || 'high',
    body.maxBudgetUsd ?? null,
    body.maxTurns ?? null,
    body.allowedTools ? JSON.stringify(body.allowedTools) : null,
    body.disallowedTools ? JSON.stringify(body.disallowedTools) : null,
    now,
    now,
  );

  return c.json({ ok: true, data: { id } }, 201);
});

// Update conversation
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = c.req.param('id');

  const updates: string[] = [];
  const values: any[] = [];

  if (body.title !== undefined) {
    updates.push('title = ?');
    values.push(body.title);
  }
  if (body.projectPath !== undefined) {
    updates.push('project_path = ?');
    values.push(body.projectPath);
  }
  if (body.model !== undefined) {
    updates.push('model = ?');
    values.push(body.model);
  }
  if (body.planMode !== undefined) {
    updates.push('plan_mode = ?');
    values.push(body.planMode ? 1 : 0);
  }
  if (body.planFile !== undefined) {
    updates.push('plan_file = ?');
    values.push(body.planFile);
  }
  if (body.permissionMode !== undefined) {
    updates.push('permission_mode = ?');
    values.push(body.permissionMode);
  }
  if (body.effort !== undefined) {
    updates.push('effort = ?');
    values.push(body.effort);
  }
  if (body.maxBudgetUsd !== undefined) {
    updates.push('max_budget_usd = ?');
    values.push(body.maxBudgetUsd);
  }
  if (body.maxTurns !== undefined) {
    updates.push('max_turns = ?');
    values.push(body.maxTurns);
  }
  if (body.allowedTools !== undefined) {
    updates.push('allowed_tools = ?');
    values.push(JSON.stringify(body.allowedTools));
  }
  if (body.disallowedTools !== undefined) {
    updates.push('disallowed_tools = ?');
    values.push(JSON.stringify(body.disallowedTools));
  }
  if (body.cliSessionId !== undefined) {
    updates.push('cli_session_id = ?');
    values.push(body.cliSessionId);
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return c.json({ ok: true });
});

// Get cost information for a conversation
app.get('/:id/cost', (c) => {
  const db = getDb();
  const conv = db
    .query('SELECT model, total_tokens FROM conversations WHERE id = ?')
    .get(c.req.param('id')) as any;
  if (!conv) return c.json({ ok: false, error: 'Not found' }, 404);

  // Get per-message token counts for input/output breakdown
  const messages = db
    .query('SELECT role, token_count FROM messages WHERE conversation_id = ?')
    .all(c.req.param('id')) as any[];

  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of messages) {
    if (m.role === 'user') inputTokens += m.token_count || 0;
    else if (m.role === 'assistant') outputTokens += m.token_count || 0;
  }

  // Use total_tokens as fallback and split 30/70 if no per-message data
  if (inputTokens === 0 && outputTokens === 0 && conv.total_tokens > 0) {
    inputTokens = Math.round(conv.total_tokens * 0.3);
    outputTokens = conv.total_tokens - inputTokens;
  }

  const cost = calculateCost(conv.model, inputTokens, outputTokens);

  return c.json({
    ok: true,
    data: {
      model: conv.model,
      totalTokens: conv.total_tokens,
      inputTokens,
      outputTokens,
      estimatedCostUsd: Math.round(cost * 10000) / 10000,
    },
  });
});

// Delete conversation
app.delete('/:id', (c) => {
  const db = getDb();
  db.query('DELETE FROM conversations WHERE id = ?').run(c.req.param('id'));
  return c.json({ ok: true });
});

export { app as conversationRoutes };
