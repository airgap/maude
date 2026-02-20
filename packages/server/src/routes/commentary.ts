import { Hono } from 'hono';
import {
  commentatorService,
  type CommentaryPersonality,
  PERSONALITY_PROMPTS,
} from '../services/commentator';
import { eventBridge } from '../services/event-bridge';
import { getDb } from '../db/database';
import type { StreamCommentary } from '@e/shared';

const app = new Hono();

/** All valid personality values (used for query-param validation). */
const VALID_PERSONALITIES = Object.keys(PERSONALITY_PROMPTS) as CommentaryPersonality[];
const FALLBACK_PERSONALITY: CommentaryPersonality = 'sports_announcer';

/** Read the user's preferred commentary personality from settings, if any. */
function getUserPreferredPersonality(): CommentaryPersonality | undefined {
  try {
    const db = getDb();
    const row = db
      .query('SELECT value FROM settings WHERE key = ?')
      .get('commentaryPersonality') as { value: string } | null;
    if (row) {
      const parsed = JSON.parse(row.value) as string;
      if (VALID_PERSONALITIES.includes(parsed as CommentaryPersonality)) {
        return parsed as CommentaryPersonality;
      }
    }
  } catch {
    /* settings unavailable — fall through */
  }
  return undefined;
}

/** Read verbosity setting for a workspace from the database. */
function getWorkspaceVerbosity(workspaceId: string): 'low' | 'medium' | 'high' {
  try {
    const db = getDb();
    const row = db.query('SELECT settings FROM workspaces WHERE id = ?').get(workspaceId) as {
      settings: string | null;
    } | null;
    if (row && row.settings) {
      const settings = JSON.parse(row.settings);
      const verbosity = settings.commentaryVerbosity;
      if (verbosity === 'low' || verbosity === 'medium' || verbosity === 'high') {
        return verbosity;
      }
    }
  } catch {
    /* DB unavailable or parse error — fall through */
  }
  return 'medium'; // Default to medium (strategic mode)
}
/**
 * GET /commentary/conversation/:conversationId — Fetch commentary for a conversation.
 *
 * Query params:
 *   limit — maximum number of entries to return (default: 100, max: 1000)
 *   offset — number of entries to skip (default: 0)
 *
 * Returns an array of commentary history entries for a specific conversation.
 */
app.get('/conversation/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 1000);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const db = getDb();
    const rows = db
      .query(
        `SELECT id, workspace_id, conversation_id, text, personality, timestamp
         FROM commentary_history
         WHERE conversation_id = ?
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(conversationId, limit, offset) as any[];

    const history = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      text: row.text,
      personality: row.personality,
      timestamp: row.timestamp,
    }));

    return c.json({ history });
  } catch (err) {
    console.error('[commentary] Failed to fetch conversation history:', err);
    return c.json({ error: 'Failed to fetch commentary history', history: [] }, 500);
  }
});

/**
 * GET /commentary/:workspaceId/history — Fetch commentary history for a workspace.
 *
 * Query params:
 *   limit — maximum number of entries to return (default: 100, max: 1000)
 *   offset — number of entries to skip (default: 0)
 *
 * Returns an array of commentary history entries sorted by timestamp DESC.
 */
app.get('/:workspaceId/history', (c) => {
  const workspaceId = c.req.param('workspaceId');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 1000);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const db = getDb();
    const rows = db
      .query(
        `SELECT id, workspace_id, conversation_id, text, personality, timestamp
         FROM commentary_history
         WHERE workspace_id = ?
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(workspaceId, limit, offset) as any[];

    const history = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      text: row.text,
      personality: row.personality,
      timestamp: row.timestamp,
    }));

    return c.json({ history });
  } catch (err) {
    console.error('[commentary] Failed to fetch history:', err);
    return c.json({ error: 'Failed to fetch commentary history', history: [] }, 500);
  }
});

/**
 * DELETE /commentary/:workspaceId/history — Delete all commentary history for a workspace.
 *
 * Returns { ok: true, data: { success: true } } on success.
 */
app.delete('/:workspaceId/history', (c) => {
  const workspaceId = c.req.param('workspaceId');

  try {
    const db = getDb();
    db.query('DELETE FROM commentary_history WHERE workspace_id = ?').run(workspaceId);
    return c.json({ ok: true, data: { success: true } });
  } catch (err) {
    console.error('[commentary] Failed to clear history:', err);
    return c.json({ ok: false, error: 'Failed to clear commentary history' }, 500);
  }
});

/**
 * GET /commentary/:workspaceId — SSE stream of commentary events.
 *
 * Query params:
 *   personality — one of CommentaryPersonality values
 *                 (defaults to user preference, then falls back to sports_announcer)
 *   conversationId — optional conversation ID to link commentary to
 *
 * The endpoint starts the commentator for the given workspace when the client
 * connects and stops it when the client disconnects.
 */
app.get('/:workspaceId', (c) => {
  const workspaceId = c.req.param('workspaceId');

  // Resolve personality: query param → user preference → fallback
  const rawPersonality = c.req.query('personality');
  let personality: CommentaryPersonality;
  if (rawPersonality && VALID_PERSONALITIES.includes(rawPersonality as CommentaryPersonality)) {
    personality = rawPersonality as CommentaryPersonality;
  } else {
    personality = getUserPreferredPersonality() ?? FALLBACK_PERSONALITY;
  }

  // Get optional conversation ID
  const conversationId = c.req.query('conversationId') || undefined;

  // Get verbosity setting from workspace configuration

  // Start (or restart) commentary for this workspace
  commentatorService.startCommentary(workspaceId, personality, conversationId);

  // Subscribe this workspace to the event bridge so stream events are
  // automatically mirrored to the commentator (AC 1, 4)
  eventBridge.subscribe(workspaceId);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const handler = (commentary: StreamCommentary) => {
        if (commentary.workspaceId === workspaceId) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(commentary)}\n\n`));
          } catch {
            /* client disconnected */
          }
        }
      };

      commentatorService.events.on('commentary', handler);

      // Ping every 15 seconds to keep the connection alive
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      // Clean up on client disconnect — stop the commentator and unsubscribe
      // from the event bridge for this workspace (AC 4: dynamic unsubscribe)
      c.req.raw.signal.addEventListener('abort', () => {
        commentatorService.events.off('commentary', handler);
        clearInterval(pingInterval);
        eventBridge.unsubscribe(workspaceId);
        commentatorService.stopCommentary(workspaceId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export { app as commentaryRoutes };
