import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { claudeManager } from '../services/claude-process';
import { getDb } from '../db/database';

const app = new Hono();

function getSessionOpts(conv: any) {
  let allowedTools: string[] | undefined;
  let disallowedTools: string[] | undefined;
  try {
    if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
  } catch {}
  try {
    if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
  } catch {}

  return {
    model: conv.model,
    systemPrompt: conv.system_prompt,
    projectPath: conv.project_path,
    effort: conv.effort,
    maxBudgetUsd: conv.max_budget_usd,
    maxTurns: conv.max_turns,
    allowedTools,
    disallowedTools,
    resumeSessionId: conv.cli_session_id || undefined,
  };
}

// Start or continue a streaming chat session
app.post('/:conversationId', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();
  const { content } = body;

  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  // Save user message to DB
  const userMsgId = nanoid();
  db.query(
    `
    INSERT INTO messages (id, conversation_id, role, content, timestamp)
    VALUES (?, ?, 'user', ?, ?)
  `,
  ).run(userMsgId, conversationId, JSON.stringify([{ type: 'text', text: content }]), Date.now());

  let sessionId = c.req.header('x-session-id') || null;

  if (!sessionId) {
    sessionId = await claudeManager.createSession(conversationId, getSessionOpts(conv));
  }
  const stream = await claudeManager.sendMessage(sessionId, content);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Session-Id': sessionId,
      'Access-Control-Expose-Headers': 'X-Session-Id',
    },
  });
});

// Cancel active generation
app.post('/:conversationId/cancel', (c) => {
  const sessionId = c.req.header('x-session-id');
  if (sessionId) {
    claudeManager.cancelGeneration(sessionId);
  }
  return c.json({ ok: true });
});

// List active sessions
app.get('/sessions', (c) => {
  return c.json({ ok: true, data: claudeManager.listSessions() });
});

export { app as streamRoutes };
