import type { StreamEvent, Conversation, Attachment, ImageContent } from '@e/shared';
import { streamStore } from '$lib/stores/stream.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import { workspaceMemoryStore } from '$lib/stores/project-memory.svelte';
import { api } from './client';
import { uuid } from '$lib/utils/uuid';

/**
 * Generation counter to prevent duplicate processing from HMR or concurrent streams.
 * Each sendAndStream/reconnect call increments this. If a reader loop detects that
 * the generation has changed (because a new stream started or HMR triggered), it
 * stops processing to avoid duplicate messages.
 */
let streamGeneration = 0;

/**
 * Abort any currently active stream. Called before starting a new stream or
 * during HMR cleanup to ensure only one reader loop is active at a time.
 */
export function abortActiveStream(): void {
  streamGeneration++;
  if (streamStore.abortController) {
    try {
      streamStore.abortController.abort();
    } catch {
      // Already aborted
    }
  }
}

/**
 * Connect to SSE stream for a conversation.
 * Uses fetch() instead of EventSource to support POST with body.
 *
 * IMPORTANT: This function captures a reference to the target conversation
 * at stream start and routes ALL updates through it, regardless of whether
 * the user switches to a different conversation during streaming.
 */
export async function sendAndStream(
  conversationId: string,
  content: string,
  attachments?: Attachment[],
): Promise<void> {
  // Abort any existing stream to prevent duplicate readers
  abortActiveStream();

  const myGeneration = streamGeneration;
  // console.log('[sse] Starting stream for conversation:', conversationId, 'gen:', myGeneration);
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
    api.git
      .snapshot(wsPath, conversationId, 'pre-agent', assistantMsgIdForSnapshot)
      .catch(() => {});
  }

  // Build user message content blocks (text + optional images)
  const userContentBlocks: Array<any> = [{ type: 'text', text: content }];
  if (attachments?.length) {
    for (const att of attachments) {
      if (att.type === 'image' && att.content && att.mimeType) {
        userContentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.mimeType,
            data: att.content,
          },
        } satisfies ImageContent);
      }
    }
  }

  // Add user message to the target conversation
  conversationStore.addMessageTo(targetConversation, {
    id: uuid(),
    role: 'user',
    content: userContentBlocks,
    timestamp: Date.now(),
  });

  try {
    const response = await api.stream.send(
      conversationId,
      content,
      streamStore.sessionId,
      abortController.signal,
      attachments,
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
    // Track seen event signatures for deduplication (safety net for HMR/reconnect races)
    const seenEvents = new Set<string>();

    while (true) {
      // Check if a newer stream has superseded this one (e.g. HMR triggered reconnect)
      if (myGeneration !== streamGeneration) {
        console.log('[sse] Stream superseded by newer generation, stopping reader');
        reader.cancel().catch(() => {});
        return; // Exit without cleaning up — the new stream owns state now
      }

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

        // Skip duplicate events (can happen during HMR race conditions)
        // Use the raw JSON string as a fingerprint for content_block_start and tool events
        const eventKey = deduplicationKey(data);
        if (eventKey && seenEvents.has(eventKey)) {
          console.log('[sse] Skipping duplicate event:', data.slice(0, 80));
          continue;
        }
        if (eventKey) seenEvents.add(eventKey);

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

    // If superseded while processing the final batch, bail out
    if (myGeneration !== streamGeneration) return;

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
    // If superseded by a newer stream, don't touch state
    if (myGeneration !== streamGeneration) return;

    if ((err as Error).name === 'AbortError') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    } else {
      streamStore.handleEvent({
        type: 'error',
        error: { type: 'network_error', message: (err as Error).message },
      });

      // Auto-reconnect: if the stream died unexpectedly (not user-cancelled),
      // try to reconnect after a short delay. The server buffers all events,
      // so reconnection will replay any missed data.
      if (streamStore.sessionId) {
        console.log('[sse] Stream died unexpectedly, attempting auto-reconnect in 2s...');
        setTimeout(() => {
          // Only reconnect if no newer stream has started
          if (myGeneration === streamGeneration) {
            reconnectActiveStream().catch(() => {});
          }
        }, 2000);
      }
    }
  }
}

/**
 * Check for active streaming sessions and reconnect if found.
 * Called on page load to resume displaying in-progress streams.
 * Returns the conversation ID of the reconnected session, or null.
 */
export async function reconnectActiveStream(): Promise<string | null> {
  // Abort any existing stream reader to prevent duplicate processing
  abortActiveStream();
  const myGeneration = streamGeneration;

  // Signal reconnection intent synchronously BEFORE any awaits so concurrent
  // code (e.g. ConversationList auto-restore) knows not to call
  // streamStore.reset() and wipe out state we're about to rebuild.
  streamStore.setReconnecting(true);

  try {
    // Retry the sessions check a few times — on page load the backend or
    // dev-proxy may not be fully ready yet, returning non-JSON (e.g. HTML).
    let sessionsRes: Awaited<ReturnType<typeof api.stream.sessions>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        sessionsRes = await api.stream.sessions();
        break; // success
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    if (!sessionsRes || !sessionsRes.ok || !sessionsRes.data.length) {
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

    // Check if superseded before continuing
    if (myGeneration !== streamGeneration) {
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
    const seenEvents = new Set<string>();

    while (true) {
      // Check if a newer stream has superseded this reconnection
      if (myGeneration !== streamGeneration) {
        console.log('[sse] Reconnect superseded by newer generation, stopping');
        reader.cancel().catch(() => {});
        streamStore.setReconnecting(false);
        return target.conversationId;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        // Skip duplicate events
        const eventKey = deduplicationKey(data);
        if (eventKey && seenEvents.has(eventKey)) continue;
        if (eventKey) seenEvents.add(eventKey);

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

    // If superseded, bail
    if (myGeneration !== streamGeneration) {
      streamStore.setReconnecting(false);
      return target.conversationId;
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

/**
 * Generate a deduplication key for SSE events that should not be duplicated.
 * Returns null for events that are inherently idempotent or should always be processed.
 *
 * We only deduplicate events that would cause visible duplication:
 * - content_block_start: duplicate would create an extra content block
 * - tool_approval_request / user_question_request: duplicate would show two dialogs
 * - tool_result: duplicate would add two results
 *
 * We do NOT deduplicate:
 * - content_block_delta: these are append-only and must all be processed
 * - message_start/stop: these are state transitions
 * - ping: harmless
 */
function deduplicationKey(rawData: string): string | null {
  try {
    // Quick check for event types that need deduplication
    if (rawData.includes('"content_block_start"')) {
      const evt = JSON.parse(rawData);
      // Use index + block type + id (for tool_use) as key
      const block = evt.content_block || {};
      return `cbs:${evt.index}:${block.type}:${block.id || ''}:${block.name || ''}`;
    }
    if (rawData.includes('"tool_approval_request"')) {
      const evt = JSON.parse(rawData);
      return `tar:${evt.toolCallId}`;
    }
    if (rawData.includes('"user_question_request"')) {
      const evt = JSON.parse(rawData);
      return `uqr:${evt.toolCallId}`;
    }
    if (rawData.includes('"tool_result"')) {
      const evt = JSON.parse(rawData);
      return `tr:${evt.toolCallId}`;
    }
  } catch {
    // Parse failed — don't deduplicate
  }
  return null;
}

/**
 * HMR cleanup: When Vite performs Hot Module Replacement, abort any active
 * stream reader to prevent orphaned loops from processing events into stale state.
 * The new module will re-establish the connection via reconnectActiveStream().
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log('[sse:hmr] Module disposing — aborting active stream');
    abortActiveStream();
  });
}
