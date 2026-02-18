import type { StreamEvent, Conversation } from '@e/shared';
import { streamStore } from '$lib/stores/stream.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import { workspaceMemoryStore } from '$lib/stores/project-memory.svelte';
import { api } from './client';
import { uuid } from '$lib/utils/uuid';

/**
 * Connect to SSE stream for a conversation.
 * Uses fetch() instead of EventSource to support POST with body.
 *
 * IMPORTANT: This function captures a reference to the target conversation
 * at stream start and routes ALL updates through it, regardless of whether
 * the user switches to a different conversation during streaming.
 */
export async function sendAndStream(conversationId: string, content: string): Promise<void> {
  // console.log('[sse] Starting stream for conversation:', conversationId);
  const abortController = new AbortController();
  streamStore.setAbortController(abortController);
  streamStore.startStream(conversationId);

  // Capture a reference to the conversation we're streaming to.
  // This reference stays valid even if the user switches conversations.
  const targetConversation = conversationStore.active;
  if (!targetConversation || targetConversation.id !== conversationId) {
    streamStore.handleEvent({
      type: 'error',
      error: { type: 'state_error', message: 'Target conversation not active' },
    });
    return;
  }

  // Pre-generate the assistant message ID so snapshots can link to it
  const assistantMsgIdForSnapshot = uuid();

  // Auto-snapshot before agent runs (fire-and-forget), linked to the upcoming assistant message
  const wsPath = targetConversation.workspacePath;
  if (wsPath) {
    api.git.snapshot(wsPath, conversationId, 'pre-agent', assistantMsgIdForSnapshot).catch(() => {});
  }

  // Add user message to the target conversation
  conversationStore.addMessageTo(targetConversation, {
    id: uuid(),
    role: 'user',
    content: [{ type: 'text', text: content }],
    timestamp: Date.now(),
  });

  try {
    const response = await api.stream.send(
      conversationId,
      content,
      streamStore.sessionId,
      abortController.signal,
    );
    // console.log('[sse] Got response:', response.status, response.ok);

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        errMsg = body.error || errMsg;
      } catch {
        try {
          const text = await response.text();
          errMsg = text.slice(0, 300) || errMsg;
        } catch {
          /* use status */
        }
      }
      streamStore.handleEvent({ type: 'error', error: { type: 'http_error', message: errMsg } });
      return;
    }

    // Capture session ID from response header
    const newSessionId = response.headers.get('X-Session-Id');
    if (newSessionId) {
      streamStore.setSessionId(newSessionId);
    }

    // Add empty assistant message to the target conversation (using pre-generated ID for snapshot linkage)
    conversationStore.addMessageTo(targetConversation, {
      id: assistantMsgIdForSnapshot,
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      model: targetConversation.model,
    });

    const reader = response.body?.getReader();
    // console.log('[sse] Got reader:', !!reader);
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
      // console.log('[sse] Reading chunk...');
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

          // Sync content blocks to the target conversation's assistant message
          conversationStore.updateLastAssistantMessageIn(targetConversation, [
            ...streamStore.contentBlocks,
          ]);
        } catch (parseErr) {
          console.warn('[sse] Failed to parse SSE data:', data, parseErr);
        }
      }
    }

    // Final sync from stream store
    if (streamStore.contentBlocks.length > 0) {
      conversationStore.updateLastAssistantMessageIn(targetConversation, [
        ...streamStore.contentBlocks,
      ]);
    }

    // Ensure streaming state is cleared when the SSE connection closes.
    // The message_stop event should have already done this, but if it was
    // lost (e.g. stream closed before the event was flushed), clean up.
    // Do NOT reset tool_pending — approval/question dialogs are still live
    // and waiting for user input. They will resolve themselves.
    if (streamStore.isStreaming || streamStore.status === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }

    // Reload conversation from DB to pick up server-persisted messages.
    // This handles cases where the stream produced no content_block events
    // (e.g. /compact, /init) but the server still saved an assistant message.
    await conversationStore.reloadById(conversationId);

    // Auto-extract workspace memories from this conversation
    const convWorkspacePath = targetConversation.workspacePath;
    if (convWorkspacePath) {
      const msgs = targetConversation.messages ?? [];
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
        workspaceMemoryStore.extractFromConversation(convWorkspacePath, recent).catch(() => {});
      }
    }

    // Auto-generate a compact summary for this conversation (background, fire-and-forget).
    // Only runs when there are enough messages to warrant a summary (>= 4 messages).
    // The summarize endpoint is idempotent — if a summary already exists it returns it cached.
    const msgCount = targetConversation.messages?.length ?? 0;
    if (msgCount >= 4) {
      api.conversations.summarize(conversationId).catch(() => {});
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

/**
 * Check for active streaming sessions and reconnect if found.
 * Called on page load to resume displaying in-progress streams.
 * Returns the conversation ID of the reconnected session, or null.
 */
export async function reconnectActiveStream(): Promise<string | null> {
  // Signal reconnection intent synchronously BEFORE any awaits so concurrent
  // code (e.g. ConversationList auto-restore) knows not to call
  // streamStore.reset() and wipe out state we're about to rebuild.
  streamStore.setReconnecting(true);

  try {
    const sessionsRes = await api.stream.sessions();
    if (!sessionsRes.ok || !sessionsRes.data.length) {
      streamStore.setReconnecting(false);
      return null;
    }

    // Find a session that's still running or just completed with buffered events
    const active = sessionsRes.data.find(
      (s) => s.status === 'running' || (s.bufferedEvents > 0 && !s.streamComplete),
    );

    // For completed sessions, only reconnect if the conversation matches the
    // one the user was last looking at. Otherwise stale completed sessions
    // (whose events were never consumed) hijack the page on reload and load
    // an old conversation instead of the most recent one.
    const savedConversationId = workspaceStore.activeWorkspace?.snapshot.activeConversationId;
    const justCompleted = sessionsRes.data.find(
      (s) => s.streamComplete && s.bufferedEvents > 0 && s.conversationId === savedConversationId,
    );

    const target = active || justCompleted;
    if (!target) {
      streamStore.setReconnecting(false);
      return null;
    }

    console.log(
      '[sse] Reconnecting to session:',
      target.id,
      'for conversation:',
      target.conversationId,
    );

    streamStore.startStream(target.conversationId);
    streamStore.setSessionId(target.id);

    // Load the conversation so the UI can display it
    const convRes = await api.conversations.get(target.conversationId);
    if (!convRes.ok || !convRes.data) {
      streamStore.handleEvent({ type: 'message_stop' } as any);
      streamStore.setReconnecting(false);
      return null;
    }
    conversationStore.setActive(convRes.data);
    const targetConversation = convRes.data as Conversation;

    const abortController = new AbortController();
    streamStore.setAbortController(abortController);
    const response = await api.stream.reconnect(target.id, abortController.signal);
    if (!response.ok || !response.body) {
      streamStore.handleEvent({ type: 'message_stop' } as any);
      streamStore.setReconnecting(false);
      return null;
    }

    // Add empty assistant message placeholder that we'll build up from replayed events
    conversationStore.addMessageTo(targetConversation, {
      id: uuid(),
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      model: targetConversation.model,
    });

    const reader = response.body.getReader();
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
          conversationStore.updateLastAssistantMessageIn(targetConversation, [
            ...streamStore.contentBlocks,
          ]);
        } catch {
          // Non-JSON line
        }
      }
    }

    // Final sync
    if (streamStore.contentBlocks.length > 0) {
      conversationStore.updateLastAssistantMessageIn(targetConversation, [
        ...streamStore.contentBlocks,
      ]);
    }

    // Ensure streaming state is cleared when the SSE connection closes.
    // Do NOT reset tool_pending — approval/question dialogs are still live.
    const s = streamStore.status;
    if (s === 'streaming' || s === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }

    // Reload conversation from DB for the authoritative server-saved version.
    // By this point the stream has completed and the server has persisted the
    // assistant message, so the DB version will include it.
    await conversationStore.reloadById(target.conversationId);
    streamStore.setReconnecting(false);

    return target.conversationId;
  } catch (err) {
    console.error('[sse] Reconnection failed:', err);
    const errStatus = streamStore.status;
    if (errStatus === 'streaming' || errStatus === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }
    streamStore.setReconnecting(false);
    return null;
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
