import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { claudeManager } from '../services/claude-process';
import { createOllamaStreamV2 } from '../services/ollama-provider-v2';
import { createBedrockStreamV2 } from '../services/bedrock-provider-v2';
import { getDb } from '../db/database';

const app = new Hono();

const PLAN_MODE_DIRECTIVE = `## Plan Mode

You are in PLAN MODE. Do NOT write code or make file changes. Instead:

1. **Analyze** the request and ask clarifying questions if the intent is ambiguous
2. **Break down** the work into clear, numbered implementation steps
3. **Identify** key files that need to change and what changes are needed
4. **Flag risks** — edge cases, breaking changes, dependencies, or unknowns
5. **Estimate scope** — is this a small tweak or a multi-file refactor?

Present your plan in clean markdown. Use headers, bullet points, and code references (backtick file paths and symbol names). Do NOT produce code blocks with full implementations — keep it at the planning level.

When the user is satisfied with the plan, they will turn off plan mode and ask you to execute.

`;

function getWorkspaceMemoryContext(workspacePath: string | null): string {
  if (!workspacePath) return '';
  try {
    const db = getDb();
    const rows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC, confidence DESC LIMIT 100`,
      )
      .all(workspacePath) as any[];
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
      context: 'Workspace Context',
    };
    let ctx = '\n\n## Workspace Memory\n\n';
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

  // Build system prompt: plan mode directive + user system prompt + workspace memories
  const memoryContext = getWorkspaceMemoryContext(conv.workspace_path);
  let systemPrompt = conv.system_prompt || '';

  if (conv.plan_mode) {
    systemPrompt = PLAN_MODE_DIRECTIVE + systemPrompt;
  }

  if (memoryContext) {
    systemPrompt = systemPrompt ? systemPrompt + memoryContext : memoryContext;
  }

  return {
    model: conv.model,
    systemPrompt: systemPrompt || undefined,
    workspacePath: conv.workspace_path,
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
    let ollamaSystemPrompt = conv.system_prompt || '';
    if (conv.plan_mode) {
      ollamaSystemPrompt = PLAN_MODE_DIRECTIVE + ollamaSystemPrompt;
    }

    // Get allowed/disallowed tools
    let allowedTools: string[] | undefined;
    let disallowedTools: string[] | undefined;
    try {
      if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
      if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
    } catch {}

    // Extract images from body if provided
    const images = body.images || [];

    const stream = createOllamaStreamV2({
      model: ollamaModel,
      content,
      conversationId,
      systemPrompt: ollamaSystemPrompt || undefined,
      workspacePath: conv.workspace_path,
      allowedTools,
      disallowedTools,
      images,
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

  // Route to Bedrock provider for AWS Bedrock models (prefixed with "bedrock:")
  const isBedrock = conv.model?.startsWith('bedrock:');
  if (isBedrock) {
    const bedrockModel = conv.model.replace('bedrock:', '');
    let bedrockSystemPrompt = conv.system_prompt || '';
    if (conv.plan_mode) {
      bedrockSystemPrompt = PLAN_MODE_DIRECTIVE + bedrockSystemPrompt;
    }

    // Get allowed/disallowed tools
    let allowedTools: string[] | undefined;
    let disallowedTools: string[] | undefined;
    try {
      if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
      if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
    } catch {}

    // Extract images from body if provided
    const images = body.images || [];

    const stream = createBedrockStreamV2({
      model: bedrockModel,
      content,
      conversationId,
      systemPrompt: bedrockSystemPrompt || undefined,
      workspacePath: conv.workspace_path,
      allowedTools,
      disallowedTools,
      permissionMode: conv.permission_mode,
      images,
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

  // Validate that a reused session belongs to this conversation.
  // If the client sends a stale session ID from a previous conversation,
  // discard it and create a fresh session to prevent the assistant
  // response from being persisted to the wrong conversation.
  if (sessionId) {
    const existing = claudeManager.getSession(sessionId);
    if (!existing || existing.conversationId !== conversationId) {
      sessionId = null;
    }
  }

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

// Submit answer to an AskUserQuestion prompt
app.post('/:conversationId/answer', async (c) => {
  const sessionId = c.req.header('x-session-id');
  if (!sessionId) return c.json({ ok: false, error: 'Missing session ID' }, 400);

  const body = await c.req.json();
  const { toolCallId, answers } = body;
  if (!toolCallId || !answers) {
    return c.json({ ok: false, error: 'Missing toolCallId or answers' }, 400);
  }

  // Format as JSON that the CLI can read as a tool result on stdin
  const answerPayload = JSON.stringify({ answers }) + '\n';
  const written = claudeManager.writeStdin(sessionId, answerPayload);
  if (!written) {
    return c.json({ ok: false, error: 'Failed to write to CLI stdin' }, 500);
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
