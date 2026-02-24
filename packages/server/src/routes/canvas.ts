import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  getCanvas,
  getConversationCanvases,
  setCanvasConversation,
} from '../services/tool-executor';

/**
 * In-memory canvas store for direct API pushes.
 * Re-uses the same canvasStore from tool-executor for tool-based pushes,
 * but also supports direct creation via REST.
 */

// We need our own store reference for direct pushes since tool-executor's
// canvasStore is not exported. We'll use a parallel Map that stays in sync.
const directCanvasStore = new Map<
  string,
  {
    id: string;
    contentType: 'html' | 'svg' | 'mermaid' | 'table';
    content: string;
    title?: string;
    conversationId?: string;
    lastUpdated: number;
  }
>();

const app = new Hono();

/**
 * GET /api/canvas/:conversationId — list all canvases for a conversation
 */
app.get('/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');

  // Merge from tool-executor's store and direct store
  const toolCanvases = getConversationCanvases(conversationId);
  const directCanvases = Array.from(directCanvasStore.values()).filter(
    (cv) => cv.conversationId === conversationId,
  );

  // Deduplicate by ID (tool-executor takes precedence)
  const seen = new Set(toolCanvases.map((cv) => cv.id));
  const merged = [...toolCanvases, ...directCanvases.filter((cv) => !seen.has(cv.id))];

  return c.json({ ok: true, data: merged });
});

/**
 * POST /api/canvas — push content to canvas directly (no agent required)
 *
 * Body: { content_type, content, title?, canvas_id?, conversation_id }
 * Returns the canvas data including a canvas_update event payload.
 */
app.post('/', async (c) => {
  const body = await c.req.json();
  const contentType = body.content_type as 'html' | 'svg' | 'mermaid' | 'table';
  const content = body.content as string;
  const title = body.title as string | undefined;
  const canvasId = body.canvas_id as string | undefined;
  const conversationId = body.conversation_id as string | undefined;

  // Validate
  if (!contentType || !['html', 'svg', 'mermaid', 'table'].includes(contentType)) {
    return c.json(
      {
        ok: false,
        error: `Invalid content_type: ${contentType}. Must be html, svg, mermaid, or table`,
      },
      400,
    );
  }
  if (!content) {
    return c.json({ ok: false, error: 'content is required' }, 400);
  }
  if (contentType === 'table') {
    try {
      JSON.parse(content);
    } catch {
      return c.json({ ok: false, error: 'Table content must be valid JSON array' }, 400);
    }
  }

  const id = canvasId || nanoid(12);
  const now = Date.now();

  const canvasData = {
    id,
    contentType,
    content,
    title,
    conversationId,
    lastUpdated: now,
  };

  // Store in our direct store
  directCanvasStore.set(id, canvasData);

  // Also set conversation association in tool-executor's store if it exists there
  if (conversationId) {
    setCanvasConversation(id, conversationId);
  }

  return c.json({
    ok: true,
    data: canvasData,
    // Include the SSE event shape so clients can inject directly into canvasStore
    canvasEvent: {
      type: 'canvas_update',
      canvasId: id,
      contentType,
      content,
      title,
      conversationId: conversationId || '',
    },
  });
});

export { app as canvasRoutes };
