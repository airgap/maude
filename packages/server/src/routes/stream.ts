import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { claudeManager } from '../services/claude-process';
import { createOllamaStream } from '../services/ollama-provider';
import { getDb } from '../db/database';

const app = new Hono();

function getProjectMemoryContext(projectPath: string | null): string {
  if (!projectPath) return '';
  try {
    const db = getDb();
    const rows = db
      .query(
        `SELECT * FROM project_memories WHERE project_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC, confidence DESC LIMIT 100`,
      )
      .all(projectPath) as any[];
    if (rows.length === 0) return '';

    const grouped: Record<string, string[]> = {};
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(`- ${row.key}: ${row.content}`);
    }
    const labels: Record<string, string> = {
      convention: 'Coding Conventions',
      decision: 'Architecture Decisions',
      preference: 'User Preferences',
      pattern: 'Common Patterns',
      context: 'Project Context',
    };
    let ctx = '\n\n## Project Memory\n\n';
    for (const [cat, items] of Object.entries(grouped)) {
      ctx += `### ${labels[cat] || cat}\n${items.join('\n')}\n\n`;
    }
    return ctx.trimEnd();
  } catch {
    return '';
  }
}

function getSessionOpts(conv: any) {
  let allowedTools: string[] | undefined;
  let disallowedTools: string[] | undefined;
  try {
    if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
  } catch {}
  try {
    if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
  } catch {}

  // Inject project memories into system prompt
  const memoryContext = getProjectMemoryContext(conv.project_path);
  const systemPrompt = conv.system_prompt
    ? conv.system_prompt + memoryContext
    : memoryContext || undefined;

  return {
    model: conv.model,
    systemPrompt,
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

  // Route to Ollama provider for local models (prefixed with "ollama:")
  const isOllama = conv.model?.startsWith('ollama:');
  if (isOllama) {
    const ollamaModel = conv.model.replace('ollama:', '');
    const stream = createOllamaStream({
      model: ollamaModel,
      content,
      conversationId,
      systemPrompt: conv.system_prompt || undefined,
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Expose-Headers': 'X-Session-Id',
      },
    });
  }

  let sessionId = c.req.header('x-session-id') || null;

  try {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[stream] Failed to start:', msg);
    return c.json({ ok: false, error: msg }, 500);
  }
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

// Reconnect to an in-flight or just-completed stream.
// Replays all buffered SSE events and continues streaming if still active.
app.get('/reconnect/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId');
  const stream = claudeManager.reconnectStream(sessionId);
  if (!stream) {
    return c.json({ ok: false, error: 'No active or recent stream for this session' }, 404);
  }

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

export { app as streamRoutes };
