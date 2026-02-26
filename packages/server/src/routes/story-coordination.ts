import { Hono } from 'hono';
import { storyCoordinator } from '../services/story-coordinator';
import type {
  StoryClaimRequest,
  StoryHeartbeatRequest,
  StoryResultReport,
  AvailableStoriesRequest,
  CoordinationEvent,
} from '@e/shared';

const app = new Hono();

// ---------------------------------------------------------------------------
// POST /claim — Claim a story for execution
// ---------------------------------------------------------------------------
// Remote golems call this to atomically claim a story. The coordinator
// performs compare-and-swap on the story status, dependency validation,
// and lease creation in a single SQLite transaction.
// ---------------------------------------------------------------------------
app.post('/claim', async (c) => {
  try {
    const body = await c.req.json<StoryClaimRequest>();

    if (
      !body.storyId ||
      !body.executorId ||
      !body.executorType ||
      !body.machineId ||
      !body.assignedBranch
    ) {
      return c.json(
        {
          ok: false,
          error:
            'Missing required fields: storyId, executorId, executorType, machineId, assignedBranch',
        },
        400,
      );
    }

    const result = storyCoordinator.claimStory(body);

    if (result.claimed) {
      return c.json({ ok: true, data: result }, 200);
    } else {
      // 409 Conflict for concurrent claim attempts, 400 for other rejections
      const status = result.currentExecutorId ? 409 : 400;
      return c.json({ ok: false, data: result, error: result.reason }, status);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:storyId/heartbeat — Renew heartbeat for a claimed story
// ---------------------------------------------------------------------------
// Executors call this periodically (default every 60s) to extend their lease.
// If the executor fails to heartbeat before the lease expires (default 5min),
// the coordinator releases the story and marks it for retry.
// ---------------------------------------------------------------------------
app.post('/:storyId/heartbeat', async (c) => {
  try {
    const storyId = c.req.param('storyId');
    const body = await c.req.json<StoryHeartbeatRequest>();

    if (!body.executorId) {
      return c.json({ ok: false, error: 'Missing required field: executorId' }, 400);
    }

    const result = storyCoordinator.renewHeartbeat(storyId, body);

    if (result.renewed) {
      return c.json({ ok: true, data: result }, 200);
    } else {
      const status = result.reason === 'lease_expired' ? 410 : 400;
      return c.json({ ok: false, data: result, error: result.reason }, status);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:storyId/result — Report execution result
// ---------------------------------------------------------------------------
// Executors call this when they complete (or fail) a story execution.
// The coordinator validates the executor holds the lease, updates the
// story status, releases the lease, and optionally triggers merge-back.
// ---------------------------------------------------------------------------
app.post('/:storyId/result', async (c) => {
  try {
    const storyId = c.req.param('storyId');
    const body = await c.req.json<StoryResultReport>();

    if (!body.executorId || !body.status) {
      return c.json({ ok: false, error: 'Missing required fields: executorId, status' }, 400);
    }

    const validStatuses = ['success', 'failure', 'timeout', 'cancelled'];
    if (!validStatuses.includes(body.status)) {
      return c.json(
        {
          ok: false,
          error: `Invalid status: ${body.status}. Must be one of: ${validStatuses.join(', ')}`,
        },
        400,
      );
    }

    const result = storyCoordinator.reportResult(storyId, body);

    if (result.accepted) {
      return c.json({ ok: true, data: result }, 200);
    } else {
      return c.json({ ok: false, data: result, error: result.reason }, 400);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /available — List stories available for claiming
// ---------------------------------------------------------------------------
// Remote golems poll this endpoint to discover stories they can work on.
// Returns stories that are pending/failed_timeout, have attempts remaining,
// are not research-only, and have all dependencies met.
// ---------------------------------------------------------------------------
app.get('/available', (c) => {
  try {
    const request: AvailableStoriesRequest = {
      workspacePath: c.req.query('workspacePath') || undefined,
      prdId: c.req.query('prdId') || undefined,
      executorType: c.req.query('executorType') || undefined,
    };

    const stories = storyCoordinator.getAvailableStories(request);
    return c.json({ ok: true, data: stories });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /leases — List active leases (monitoring)
// ---------------------------------------------------------------------------
app.get('/leases', (c) => {
  try {
    const leases = storyCoordinator.getActiveLeases();
    return c.json({ ok: true, data: leases });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:storyId/lease — Force-release a lease (admin)
// ---------------------------------------------------------------------------
app.delete('/:storyId/lease', (c) => {
  try {
    const storyId = c.req.param('storyId');
    const released = storyCoordinator.forceReleaseLease(storyId);

    if (released) {
      return c.json({ ok: true, data: { released: true } });
    } else {
      return c.json({ ok: false, error: 'No active lease found for this story' }, 404);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /config — Get coordination configuration
// ---------------------------------------------------------------------------
app.get('/config', (c) => {
  return c.json({ ok: true, data: storyCoordinator.getConfig() });
});

// ---------------------------------------------------------------------------
// PUT /config — Update coordination configuration
// ---------------------------------------------------------------------------
app.put('/config', async (c) => {
  try {
    const body = await c.req.json();
    storyCoordinator.updateConfig(body);
    return c.json({ ok: true, data: storyCoordinator.getConfig() });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /events — SSE endpoint for real-time coordination events
// ---------------------------------------------------------------------------
app.get('/events', (c) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const handler = (event: CoordinationEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };

      storyCoordinator.events.on('coordination_event', handler);

      // Ping to keep connection alive
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"ping","timestamp":${Date.now()}}\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      // Clean up on abort
      c.req.raw.signal.addEventListener('abort', () => {
        storyCoordinator.events.off('coordination_event', handler);
        clearInterval(pingInterval);
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

export { app as storyCoordinationRoutes };
