import { Hono } from 'hono';
import { commentatorService, PERSONALITY_PROMPTS } from '../services/commentator';
import { eventBridge } from '../services/event-bridge';
import { getDb } from '../db/database';
import type {
  StreamCommentary,
  CommentaryPersonality,
  CommentaryVerbosity,
  CommentarySettings,
} from '@e/shared';
import { DEFAULT_COMMENTARY_SETTINGS } from '@e/shared';

const app = new Hono();

/** All valid personality values (used for query-param validation). */
const VALID_PERSONALITIES = Object.keys(PERSONALITY_PROMPTS) as CommentaryPersonality[];

/** Read the user's preferred commentary personality from global settings, if any. */
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
 * Resolve the full commentary settings for a workspace.
 * Reads from the workspace's JSON settings column and applies defaults.
 *
 * Defaults: enabled=false, personality='technical_analyst', verbosity='medium'
 */
function getWorkspaceCommentarySettings(workspaceId: string): CommentarySettings {
  try {
    const db = getDb();
    const row = db.query('SELECT settings FROM workspaces WHERE id = ?').get(workspaceId) as {
      settings: string | null;
    } | null;
    if (row && row.settings) {
      const settings = JSON.parse(row.settings);
      return {
        enabled:
          settings.commentaryEnabled !== undefined
            ? Boolean(settings.commentaryEnabled)
            : DEFAULT_COMMENTARY_SETTINGS.enabled,
        personality:
          settings.commentaryPersonality &&
          VALID_PERSONALITIES.includes(settings.commentaryPersonality)
            ? (settings.commentaryPersonality as CommentaryPersonality)
            : DEFAULT_COMMENTARY_SETTINGS.personality,
        verbosity:
          settings.commentaryVerbosity &&
          ['low', 'medium', 'high'].includes(settings.commentaryVerbosity)
            ? (settings.commentaryVerbosity as CommentaryVerbosity)
            : DEFAULT_COMMENTARY_SETTINGS.verbosity,
      };
    }
  } catch {
    /* DB unavailable or parse error — fall through */
  }
  return { ...DEFAULT_COMMENTARY_SETTINGS };
}

// ---------------------------------------------------------------------------
// Commentary Status Endpoint (for multi-workspace monitoring)
// ---------------------------------------------------------------------------

/**
 * GET /commentary/status — Get the status of all active commentators.
 *
 * Returns per-workspace status including personality, client count, and
 * generation state. Useful for the Manager View dashboard.
 */
app.get('/status', (c) => {
  try {
    const commentators = commentatorService.getStatus();
    const subscribedWorkspaces = eventBridge.getSubscribedWorkspaces();

    return c.json({
      ok: true,
      data: {
        activeCommentators: commentators,
        subscribedWorkspaces,
        totalActive: commentatorService.activeCount,
        totalSubscribed: eventBridge.subscriberCount,
      },
    });
  } catch (err) {
    console.error('[commentary] Failed to get status:', err);
    return c.json({ ok: false, error: 'Failed to get commentary status' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Commentary Settings Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /commentary/:workspaceId/settings — Get commentary preferences for a workspace.
 *
 * Returns the resolved commentary settings with defaults applied:
 *   { ok: true, data: { enabled: bool, personality: string, verbosity: string } }
 */
app.get('/:workspaceId/settings', (c) => {
  const workspaceId = c.req.param('workspaceId');

  try {
    // Verify workspace exists
    const db = getDb();
    const workspace = db.query('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as any;
    if (!workspace) {
      return c.json({ ok: false, error: 'Workspace not found' }, 404);
    }

    const commentarySettings = getWorkspaceCommentarySettings(workspaceId);
    return c.json({ ok: true, data: commentarySettings });
  } catch (err) {
    console.error('[commentary] Failed to get settings:', err);
    return c.json({ ok: false, error: 'Failed to get commentary settings' }, 500);
  }
});

/**
 * PUT /commentary/:workspaceId/settings — Set commentary preferences for a workspace.
 *
 * Accepts a JSON body with any subset of: { enabled, personality, verbosity }
 * Merges with existing workspace settings. Returns the updated commentary settings.
 *
 * When commentary is disabled via settings, any active commentator for this workspace
 * is force-stopped and the event bridge subscription is removed.
 */
app.put('/:workspaceId/settings', async (c) => {
  const workspaceId = c.req.param('workspaceId');

  try {
    const body = await c.req.json();
    const db = getDb();

    // Verify workspace exists
    const workspace = db
      .query('SELECT id, settings FROM workspaces WHERE id = ?')
      .get(workspaceId) as any;
    if (!workspace) {
      return c.json({ ok: false, error: 'Workspace not found' }, 404);
    }

    // Build the settings update
    const settingsUpdate: Record<string, unknown> = {};

    if (body.enabled !== undefined) {
      settingsUpdate.commentaryEnabled = Boolean(body.enabled);
    }

    if (body.personality !== undefined) {
      if (!VALID_PERSONALITIES.includes(body.personality as CommentaryPersonality)) {
        return c.json(
          {
            ok: false,
            error: `Invalid personality. Valid values: ${VALID_PERSONALITIES.join(', ')}`,
          },
          400,
        );
      }
      settingsUpdate.commentaryPersonality = body.personality;
    }

    if (body.verbosity !== undefined) {
      if (!['low', 'medium', 'high'].includes(body.verbosity)) {
        return c.json(
          { ok: false, error: 'Invalid verbosity. Valid values: low, medium, high' },
          400,
        );
      }
      settingsUpdate.commentaryVerbosity = body.verbosity;
    }

    if (Object.keys(settingsUpdate).length === 0) {
      // No updates provided — return current settings
      const current = getWorkspaceCommentarySettings(workspaceId);
      return c.json({ ok: true, data: current });
    }

    // Merge with existing settings
    const existingSettings = workspace.settings ? JSON.parse(workspace.settings) : {};
    const mergedSettings = { ...existingSettings, ...settingsUpdate };

    db.query('UPDATE workspaces SET settings = ? WHERE id = ?').run(
      JSON.stringify(mergedSettings),
      workspaceId,
    );

    // AC 5: If commentary was just disabled, force-stop and cleanup
    if (settingsUpdate.commentaryEnabled === false) {
      commentatorService.forceStopCommentary(workspaceId);
      eventBridge.forceUnsubscribe(workspaceId);
    }

    // Return the updated commentary settings
    const updatedSettings = getWorkspaceCommentarySettings(workspaceId);
    return c.json({ ok: true, data: updatedSettings });
  } catch (err) {
    console.error('[commentary] Failed to update settings:', err);
    return c.json({ ok: false, error: 'Failed to update commentary settings' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Commentary History Endpoints
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SSE Commentary Stream
// ---------------------------------------------------------------------------

/**
 * GET /commentary/:workspaceId — SSE stream of commentary events.
 *
 * Query params:
 *   personality — one of CommentaryPersonality values
 *                 (defaults to workspace setting → user preference → technical_analyst)
 *   conversationId — optional conversation ID to link commentary to
 *
 * The endpoint starts the commentator for the given workspace when the client
 * connects and stops it when the client disconnects.
 *
 * Uses reference counting so multiple SSE clients can connect to the same
 * workspace without interfering with each other. The commentator stays alive
 * until the last client disconnects.
 *
 * If the workspace has commentary disabled (commentaryEnabled=false), the stream
 * still connects but the commentator will not be started until commentary is enabled.
 */
app.get('/:workspaceId', (c) => {
  const workspaceId = c.req.param('workspaceId');

  // Resolve commentary settings for this workspace
  const commentarySettings = getWorkspaceCommentarySettings(workspaceId);

  // Resolve personality: query param → workspace setting → user preference → default
  const rawPersonality = c.req.query('personality');
  let personality: CommentaryPersonality;
  if (rawPersonality && VALID_PERSONALITIES.includes(rawPersonality as CommentaryPersonality)) {
    personality = rawPersonality as CommentaryPersonality;
  } else {
    personality =
      commentarySettings.personality ??
      getUserPreferredPersonality() ??
      DEFAULT_COMMENTARY_SETTINGS.personality;
  }

  // Get optional conversation ID
  const conversationId = c.req.query('conversationId') || undefined;

  // Track whether this client acquired refs (only true if commentary is enabled).
  // This prevents the disconnect handler from releasing refs that were never acquired.
  let refsAcquired = false;

  // Only start the commentator if commentary is enabled for this workspace.
  // startCommentary is idempotent for the same personality — it won't restart
  // or discard buffered events when another client is already connected.
  if (commentarySettings.enabled) {
    commentatorService.startCommentary(workspaceId, personality, conversationId);
    commentatorService.acquireRef(workspaceId);
    eventBridge.subscribe(workspaceId);
    refsAcquired = true;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const handler = (commentary: StreamCommentary) => {
        // AC 3: Only forward commentary for THIS workspace — no crosstalk
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

      // Clean up on client disconnect — ref-counted so multiple clients work
      c.req.raw.signal.addEventListener('abort', () => {
        commentatorService.events.off('commentary', handler);
        clearInterval(pingInterval);

        // Only release refs if this client actually acquired them
        if (refsAcquired) {
          eventBridge.unsubscribe(workspaceId);
          const remainingRefs = commentatorService.releaseRef(workspaceId);

          // AC 5: Only stop the commentator when the last client disconnects
          if (remainingRefs === 0) {
            commentatorService.stopCommentary(workspaceId);
          }
        }

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
