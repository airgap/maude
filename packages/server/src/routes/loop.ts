import { Hono } from 'hono';
import { loopOrchestrator } from '../services/loop-orchestrator';
import type { StreamLoopEvent } from '@maude/shared';

const app = new Hono();

// Start a new loop
app.post('/start', async (c) => {
  const body = await c.req.json();
  const { prdId, workspacePath, config } = body;

  if (!prdId || !workspacePath || !config) {
    return c.json({ ok: false, error: 'prdId, workspacePath, and config are required' }, 400);
  }

  try {
    const loopId = await loopOrchestrator.startLoop(prdId, workspacePath, config);
    return c.json({ ok: true, data: { loopId } }, 201);
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Pause a running loop
app.post('/:id/pause', async (c) => {
  try {
    await loopOrchestrator.pauseLoop(c.req.param('id'));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 404);
  }
});

// Resume a paused loop
app.post('/:id/resume', async (c) => {
  try {
    await loopOrchestrator.resumeLoop(c.req.param('id'));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 404);
  }
});

// Cancel a loop
app.post('/:id/cancel', async (c) => {
  try {
    await loopOrchestrator.cancelLoop(c.req.param('id'));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 404);
  }
});

// Get loop state
app.get('/:id', (c) => {
  const state = loopOrchestrator.getLoopState(c.req.param('id'));
  if (!state) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: state });
});

// List loops
app.get('/', (c) => {
  const status = c.req.query('status');
  const loops = loopOrchestrator.listLoops(status || undefined);
  return c.json({ ok: true, data: loops });
});

// Get iteration log
app.get('/:id/log', (c) => {
  const state = loopOrchestrator.getLoopState(c.req.param('id'));
  if (!state) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: state.iterationLog });
});

// SSE endpoint for real-time loop events
app.get('/:id/events', (c) => {
  const loopId = c.req.param('id');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const handler = (event: StreamLoopEvent) => {
        if (event.loopId === loopId) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            /* client disconnected */
          }
        }
      };

      loopOrchestrator.events.on('loop_event', handler);

      // Ping to keep connection alive
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      // Clean up on abort
      c.req.raw.signal.addEventListener('abort', () => {
        loopOrchestrator.events.off('loop_event', handler);
        clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      // Also clean up when loop ends
      const doneHandler = (doneLoopId: string) => {
        if (doneLoopId === loopId) {
          loopOrchestrator.events.off('loop_event', handler);
          clearInterval(pingInterval);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      loopOrchestrator.events.once('loop_done', doneHandler);
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

export { app as loopRoutes };
