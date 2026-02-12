import type { StreamEvent } from '@maude/shared';
import { streamStore } from '$lib/stores/stream.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { api } from './client';

/**
 * Connect to SSE stream for a conversation.
 * Uses fetch() instead of EventSource to support POST with body.
 */
export async function sendAndStream(conversationId: string, content: string): Promise<void> {
  const abortController = new AbortController();
  streamStore.setAbortController(abortController);
  streamStore.startStream();

  // Add user message to conversation immediately
  conversationStore.addMessage({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: content }],
    timestamp: Date.now(),
  });

  try {
    const response = await api.stream.send(
      conversationId,
      content,
      streamStore.sessionId,
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Stream failed' }));
      streamStore.handleEvent({ type: 'error', error: { type: 'http_error', message: err.error } });
      return;
    }

    // Capture session ID from response header
    const newSessionId = response.headers.get('X-Session-Id');
    if (newSessionId) {
      streamStore.setSessionId(newSessionId);
    }

    // Add empty assistant message that we'll build up
    const assistantMsgId = crypto.randomUUID();
    conversationStore.addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      model: conversationStore.active?.model,
    });

    const reader = response.body?.getReader();
    if (!reader) {
      streamStore.handleEvent({ type: 'error', error: { type: 'no_body', message: 'No response body' } });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event: StreamEvent = JSON.parse(data);
          streamStore.handleEvent(event);

          // Sync content blocks to the assistant message
          conversationStore.updateLastAssistantMessage([...streamStore.contentBlocks]);
        } catch {
          // Non-JSON SSE line, ignore
        }
      }
    }

    // Final sync
    if (streamStore.contentBlocks.length > 0) {
      conversationStore.updateLastAssistantMessage([...streamStore.contentBlocks]);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    } else {
      streamStore.handleEvent({
        type: 'error',
        error: { type: 'network_error', message: (err as Error).message },
      });
    }
  }
}

export async function cancelStream(conversationId: string): Promise<void> {
  streamStore.cancel();
  if (streamStore.sessionId) {
    try {
      await api.stream.cancel(conversationId, streamStore.sessionId);
    } catch {
      // Best effort
    }
  }
}
