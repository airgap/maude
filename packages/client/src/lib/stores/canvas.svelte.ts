import type { StreamCanvasUpdate } from '@e/shared';

export interface CanvasState {
  id: string;
  contentType: 'html' | 'svg' | 'mermaid' | 'table';
  content: string;
  title?: string;
  conversationId: string;
  lastUpdated: number;
}

function createCanvasStore() {
  let canvases = $state<CanvasState[]>([]);
  let currentConversationId = $state<string | null>(null);

  return {
    get canvases() {
      return canvases;
    },

    get currentConversationId() {
      return currentConversationId;
    },

    /** Get canvases for the current conversation */
    get current(): CanvasState[] {
      if (!currentConversationId) return [];
      return canvases.filter((c) => c.conversationId === currentConversationId);
    },

    /** Handle canvas update from SSE stream */
    handleUpdate(event: StreamCanvasUpdate) {
      const existing = canvases.find((c) => c.id === event.canvasId);

      if (existing) {
        // Update existing canvas
        canvases = canvases.map((c) =>
          c.id === event.canvasId
            ? {
                ...c,
                contentType: event.contentType,
                content: event.content,
                title: event.title || c.title,
                lastUpdated: Date.now(),
              }
            : c,
        );
      } else {
        // Add new canvas
        canvases = [
          ...canvases,
          {
            id: event.canvasId,
            contentType: event.contentType,
            content: event.content,
            title: event.title,
            conversationId: event.conversationId,
            lastUpdated: Date.now(),
          },
        ];
      }
    },

    /** Load canvases for a conversation */
    setConversation(conversationId: string | null) {
      currentConversationId = conversationId;
    },

    /** Clear all canvases for a conversation */
    clearConversation(conversationId: string) {
      canvases = canvases.filter((c) => c.conversationId !== conversationId);
    },

    /** Clear all canvases */
    clear() {
      canvases = [];
      currentConversationId = null;
    },

    /** Get a specific canvas by ID */
    getById(canvasId: string): CanvasState | undefined {
      return canvases.find((c) => c.id === canvasId);
    },

    /** Remove a canvas */
    remove(canvasId: string) {
      canvases = canvases.filter((c) => c.id !== canvasId);
    },
  };
}

export const canvasStore = createCanvasStore();
