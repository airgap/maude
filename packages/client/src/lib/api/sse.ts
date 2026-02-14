import type { StreamEvent } from '@maude/shared';
import { streamStore } from '$lib/stores/stream.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { projectMemoryStore } from '$lib/stores/project-memory.svelte';
import { api } from './client';

/**
 * Connect to SSE stream for a conversation.
 * Uses fetch() instead of EventSource to support POST with body.
 */
export async function sendAndStream(conversationId: string, content: string): Promise<void> {
  console.log('[sse] Starting stream for conversation:', conversationId, 'content:', content.slice(0, 100));
  const abortController = new AbortController();
  streamStore.setAbortController(abortController);
  streamStore.startStream();

  // Auto-snapshot before agent runs (fire-and-forget)
  const projectPath = conversationStore.active?.projectPath;
  if (projectPath) {
    api.git.snapshot(projectPath, conversationId, 'pre-agent').catch(() => {});
  }

  // Add user message to conversation immediately
  conversationStore.addMessage({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: content }],
    timestamp: Date.now(),
  });

  try {
    const response = await api.stream.send(conversationId, content, streamStore.sessionId);
    console.log('[sse] Got response:', response.status, response.ok);

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        errMsg = body.error || errMsg;
      } catch {
        try {
          const text = await response.text();
          errMsg = text.slice(0, 300) || errMsg;
        } catch { /* use status */ }
      }
      streamStore.handleEvent({ type: 'error', error: { type: 'http_error', message: errMsg } });
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
    console.log('[sse] Got reader:', !!reader);
    if (!reader) {
      streamStore.handleEvent({
        type: 'error',
        error: { type: 'no_body', message: 'No response body' },
      });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      console.log('[sse] Reading chunk...');
      const { done, value } = await reader.read();
      if (done) { console.log('[sse] Stream done'); break; }

      buffer += decoder.decode(value, { stream: true });
      console.log('[sse] Decoded buffer length:', buffer.length, 'contains:', buffer.slice(0, 100));
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event: StreamEvent = JSON.parse(data);
          console.log('[sse] Received event:', event.type, event);
          streamStore.handleEvent(event);

          // Sync content blocks to the assistant message
          conversationStore.updateLastAssistantMessage([...streamStore.contentBlocks]);
        } catch (parseErr) {
          console.warn('[sse] Failed to parse SSE data:', data, parseErr);
        }
      }
    }

    // Final sync
    if (streamStore.contentBlocks.length > 0) {
      conversationStore.updateLastAssistantMessage([...streamStore.contentBlocks]);
    }

    // Auto-extract project memories from this conversation
    const projectPath = conversationStore.active?.projectPath;
    if (projectPath) {
      const msgs = conversationStore.active?.messages ?? [];
      // Take last 10 messages for extraction (avoid processing huge histories)
      const recent = msgs.slice(-10).map((m) => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : String(m.content),
      }));
      if (recent.length > 0) {
        projectMemoryStore.extractFromConversation(projectPath, recent).catch(() => {});
      }
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
