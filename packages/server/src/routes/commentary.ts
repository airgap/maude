import { Hono } from 'hono';
import {
  commentatorService,
  type CommentaryPersonality,
  PERSONALITY_PROMPTS,
} from '../services/commentator';
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

/**
 * GET /commentary/:workspaceId — SSE stream of commentary events.
 *
 * Query params:
 *   personality — one of CommentaryPersonality values
 *                 (defaults to user preference, then falls back to sports_announcer)
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

  // Start (or restart) commentary for this workspace
  commentatorService.startCommentary(workspaceId, personality);

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

      // Clean up on client disconnect — stop the commentator for this workspace
      c.req.raw.signal.addEventListener('abort', () => {
        commentatorService.events.off('commentary', handler);
        clearInterval(pingInterval);
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
