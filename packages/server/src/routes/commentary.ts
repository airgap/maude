import { Hono } from 'hono';
import {
  commentatorService,
  type CommentaryPersonality,
  PERSONALITY_PROMPTS,
} from '../services/commentator';
import type { StreamCommentary } from '@e/shared';

const app = new Hono();

/** All valid personality values (used for query-param validation). */
const VALID_PERSONALITIES = Object.keys(PERSONALITY_PROMPTS) as CommentaryPersonality[];
const DEFAULT_PERSONALITY: CommentaryPersonality = 'sports_announcer';

/**
 * GET /commentary/:workspaceId — SSE stream of commentary events.
 *
 * Query params:
 *   personality — one of CommentaryPersonality values (defaults to sports_announcer)
 *
 * The endpoint starts the commentator for the given workspace when the client
 * connects and stops it when the client disconnects.
 */
app.get('/:workspaceId', (c) => {
  const workspaceId = c.req.param('workspaceId');

  // Resolve personality from query param, falling back to the default
  const rawPersonality = c.req.query('personality');
  const personality: CommentaryPersonality =
    rawPersonality && VALID_PERSONALITIES.includes(rawPersonality as CommentaryPersonality)
      ? (rawPersonality as CommentaryPersonality)
      : DEFAULT_PERSONALITY;

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
