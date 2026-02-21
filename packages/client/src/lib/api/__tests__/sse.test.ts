import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to define mocks that can be referenced in vi.mock factories
const { mockStreamStore, mockConversationStore, mockSend, mockCancel } = vi.hoisted(() => ({
  mockStreamStore: {
    setAbortController: vi.fn(),
    startStream: vi.fn(),
    handleEvent: vi.fn(),
    setSessionId: vi.fn(),
    setReconnecting: vi.fn(),
    isStreaming: false,
    status: 'idle' as string,
    sessionId: 'session-1' as string | null,
    conversationId: null as string | null,
    contentBlocks: [] as any[],
    cancel: vi.fn(),
    abortController: null as AbortController | null,
    reset: vi.fn(),
  },
  mockConversationStore: {
    addMessage: vi.fn(),
    addMessageTo: vi.fn(),
    updateLastAssistantMessage: vi.fn(),
    updateLastAssistantMessageIn: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    reloadById: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn(),
    onActiveChange: vi.fn(),
    setInflight: vi.fn(),
    clearInflight: vi.fn(),
    getInflight: vi.fn().mockReturnValue(undefined),
    active: {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [],
    } as any,
    activeId: 'conv-1' as string | null,
  },
  mockSend: vi.fn(),
  mockCancel: vi.fn(),
}));

vi.mock('$lib/stores/stream.svelte', () => ({
  streamStore: mockStreamStore,
}));

vi.mock('$lib/stores/conversation.svelte', () => ({
  conversationStore: mockConversationStore,
}));

vi.mock('$lib/stores/project-memory.svelte', () => ({
  workspaceMemoryStore: {
    extractFromConversation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  workspaceStore: {
    activeWorkspace: null,
    updateActiveSnapshot: vi.fn(),
  },
}));

vi.mock('../client', () => ({
  api: {
    stream: {
      send: mockSend,
      cancel: mockCancel,
    },
    git: {
      snapshot: vi.fn().mockResolvedValue(undefined),
    },
    conversations: {
      summarize: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('$lib/utils/uuid', () => ({
  uuid: vi.fn().mockReturnValue('mock-uuid-12345'),
}));

import {
  sendAndStream,
  cancelStream,
  reconnectActiveStream,
  abortActiveStream,
  getReconnectionPromise,
} from '../sse';

beforeEach(() => {
  vi.clearAllMocks();
  mockStreamStore.contentBlocks = [];
  mockStreamStore.sessionId = 'session-1';
  mockStreamStore.conversationId = null;
  mockStreamStore.isStreaming = false;
  mockStreamStore.status = 'idle';
  mockStreamStore.abortController = null;
  mockConversationStore.active = {
    id: 'conv-1',
    model: 'claude-sonnet-4-5-20250929',
    workspacePath: null,
    messages: [],
  };
  mockConversationStore.activeId = 'conv-1';
});

function createMockResponse(body: string, ok = true, headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return {
    ok,
    status: ok ? 200 : 500,
    body: stream,
    headers: new Headers(headers),
    json: () => Promise.resolve({ error: 'Stream failed' }),
  };
}

function createMultiChunkResponse(
  chunks: string[],
  ok = true,
  headers: Record<string, string> = {},
) {
  const encoder = new TextEncoder();
  let chunkIndex = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok,
    status: ok ? 200 : 500,
    body: stream,
    headers: new Headers(headers),
    json: () => Promise.resolve({ error: 'Stream failed' }),
  };
}

// ============================================================================
// sendAndStream
// ============================================================================
describe('sendAndStream', () => {
  test('initializes stream and adds user message', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.setAbortController).toHaveBeenCalled();
    expect(mockStreamStore.startStream).toHaveBeenCalledWith('conv-1');
    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      mockConversationStore.active,
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      }),
    );
  });

  test('handles non-ok response', async () => {
    mockSend.mockResolvedValue(createMockResponse('', false));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ type: 'http_error' }),
      }),
    );
  });

  test('captures session ID from response header', async () => {
    mockSend.mockResolvedValue(createMockResponse('', true, { 'X-Session-Id': 'new-session' }));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('new-session');
  });

  test('does not set session ID when header is absent', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.setSessionId).not.toHaveBeenCalled();
  });

  test('adds empty assistant message', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledTimes(2);
    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      mockConversationStore.active,
      expect.objectContaining({
        role: 'assistant',
        content: [],
      }),
    );
  });

  test('parses SSE events from stream', async () => {
    const sseData =
      'data: {"type":"message_start","message":{"id":"msg-1","role":"assistant"}}\n\ndata: {"type":"message_stop"}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_start' }),
    );
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
  });

  test('ignores non-data lines', async () => {
    const sseData = ':comment\nretry: 1000\ndata: {"type":"ping"}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ping' }),
    );
  });

  test('handles response with no body', async () => {
    mockSend.mockResolvedValue({
      ok: true,
      body: null,
      headers: new Headers(),
    });

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ type: 'no_body' }),
      }),
    );
  });

  test('handles network error', async () => {
    mockSend.mockRejectedValue(new Error('Network failure'));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'network_error',
          message: 'Network failure',
        }),
      }),
    );
  });

  test('handles abort error', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSend.mockRejectedValue(abortError);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
  });

  test('syncs content blocks after stream completes', async () => {
    mockStreamStore.contentBlocks = [{ type: 'text', text: 'Hello' }];
    mockSend.mockResolvedValue(createMockResponse('data: {"type":"ping"}\n\n'));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.updateLastAssistantMessageIn).toHaveBeenCalled();
  });
});

// ============================================================================
// cancelStream
// ============================================================================
describe('cancelStream', () => {
  test('calls streamStore.cancel', async () => {
    await cancelStream('conv-1');
    expect(mockStreamStore.cancel).toHaveBeenCalled();
  });

  test('sends cancel to API with session ID', async () => {
    mockCancel.mockResolvedValue({});
    await cancelStream('conv-1');
    expect(mockCancel).toHaveBeenCalledWith('conv-1', 'session-1');
  });

  test('handles cancel API failure gracefully', async () => {
    mockCancel.mockRejectedValue(new Error('fail'));
    await cancelStream('conv-1');
  });

  test('skips API call when no session ID', async () => {
    mockStreamStore.sessionId = null;
    await cancelStream('conv-1');
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

// ============================================================================
// sendAndStream — edge cases
// ============================================================================
describe('sendAndStream (additional paths)', () => {
  test('handles state_error when target conversation is not active', async () => {
    mockConversationStore.active = null;

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ type: 'state_error' }),
      }),
    );
    // Should not attempt to send
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('handles state_error when active conversation ID mismatches', async () => {
    mockConversationStore.active = {
      id: 'conv-other',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [],
    };

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'state_error',
          message: 'Target conversation not active',
        }),
      }),
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('fires auto-snapshot when conversation has workspacePath', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: '/my/project',
      messages: [],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.git.snapshot).toHaveBeenCalledWith(
      '/my/project',
      'conv-1',
      'pre-agent',
      expect.any(String),
    );
  });

  test('does not fire auto-snapshot when no workspacePath', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.git.snapshot).not.toHaveBeenCalled();
  });

  test('handles HTTP error by reading JSON error body', async () => {
    const errorResponse = {
      ok: false,
      status: 400,
      body: null,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'Invalid request body' }),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'Invalid request body',
        }),
      }),
    );
  });

  test('handles HTTP error by falling back to text when JSON parse fails', async () => {
    const errorResponse = {
      ok: false,
      status: 502,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('Bad Gateway from proxy'),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'Bad Gateway from proxy',
        }),
      }),
    );
  });

  test('handles HTTP error with status code fallback when both json and text fail', async () => {
    const errorResponse = {
      ok: false,
      status: 503,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.reject(new Error('not text')),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'HTTP 503',
        }),
      }),
    );
  });

  test('handles malformed SSE JSON gracefully (parse error)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sseData = 'data: {invalid json}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    expect(consoleWarn).toHaveBeenCalledWith(
      '[sse] Failed to parse SSE data:',
      '{invalid json}',
      expect.any(Error),
    );
    consoleWarn.mockRestore();
  });

  test('forces message_stop when stream ends in streaming state', async () => {
    mockStreamStore.isStreaming = true;
    mockStreamStore.status = 'streaming';
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('forces message_stop when stream ends in connecting state', async () => {
    mockStreamStore.status = 'connecting';
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('does NOT force message_stop when stream ends in tool_pending state', async () => {
    // tool_pending means user is looking at an approval/question dialog — don't dismiss it
    mockStreamStore.status = 'tool_pending';
    mockStreamStore.isStreaming = false;
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
  });

  test('does NOT force message_stop when stream ends in idle state', async () => {
    mockStreamStore.status = 'idle';
    mockStreamStore.isStreaming = false;
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
  });

  test('reloads conversation after stream completes', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-1');
  });

  test('clears in-flight reference after stream completes', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('clears in-flight reference after abort', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSend.mockRejectedValue(abortError);

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('sets in-flight tracking on stream start', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.setInflight).toHaveBeenCalledWith(
      'conv-1',
      mockConversationStore.active,
    );
  });

  test('extracts workspace memory when conversation has workspacePath and messages', async () => {
    const { workspaceMemoryStore } = await import('$lib/stores/project-memory.svelte');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: '/my/project',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Write a function' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Here is the function' }] },
      ],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(workspaceMemoryStore.extractFromConversation).toHaveBeenCalledWith(
      '/my/project',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
    );
  });

  test('does not extract workspace memory when no workspacePath', async () => {
    const { workspaceMemoryStore } = await import('$lib/stores/project-memory.svelte');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(workspaceMemoryStore.extractFromConversation).not.toHaveBeenCalled();
  });

  test('passes signal to api.stream.send', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockSend).toHaveBeenCalledWith(
      'conv-1',
      'Hello',
      'session-1',
      expect.any(AbortSignal),
      undefined,
    );
  });

  test('includes model in assistant message', async () => {
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-opus-4-6',
      workspacePath: null,
      messages: [],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const assistantCall = mockConversationStore.addMessageTo.mock.calls[1];
    expect(assistantCall[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        model: 'claude-opus-4-6',
      }),
    );
  });

  test('handles multiple SSE events with buffering across chunks', async () => {
    const response = createMultiChunkResponse([
      'data: {"type":"message_start","message":{"id":"m1"}}\n\ndata: {"typ',
      'e":"content_block_delta","delta":{"text":"hi"}}\n\ndata: {"type":"message_stop"}\n\n',
    ]);

    mockSend.mockResolvedValue(response);

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('message_stop');
  });

  test('passes image attachments to stream send', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    const attachments = [
      { type: 'image' as const, name: 'test.png', content: 'base64data', mimeType: 'image/png' },
    ];
    await sendAndStream('conv-1', 'Hello', attachments);

    expect(mockSend).toHaveBeenCalledWith(
      'conv-1',
      'Hello',
      'session-1',
      expect.any(AbortSignal),
      attachments,
    );
  });

  test('includes image content blocks in user message', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    const attachments = [
      { type: 'image' as const, name: 'test.png', content: 'base64data', mimeType: 'image/png' },
    ];
    await sendAndStream('conv-1', 'Describe this', attachments);

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      mockConversationStore.active,
      expect.objectContaining({
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'base64data' },
          },
        ],
      }),
    );
  });

  test('triggers auto-summarize for conversations with >= 4 messages', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
        { role: 'user', content: [{ type: 'text', text: 'c' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'd' }] },
      ],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.conversations.summarize).toHaveBeenCalledWith('conv-1');
  });

  test('does NOT trigger auto-summarize for conversations with < 4 messages', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
      ],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.conversations.summarize).not.toHaveBeenCalled();
  });

  test('handles empty data lines gracefully', async () => {
    const sseData = 'data: \n\ndata: {"type":"ping"}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // Only the ping should be processed, empty data should be skipped
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ping' }),
    );
    expect(mockStreamStore.handleEvent).toHaveBeenCalledTimes(1);
  });

  test('handles stream with only newlines', async () => {
    const sseData = '\n\n\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // No handleEvent calls for empty lines (except possibly forced message_stop)
    const nonStopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type !== 'message_stop',
    );
    expect(nonStopCalls.length).toBe(0);
  });
});

// ============================================================================
// sendAndStream — deduplication
// ============================================================================
describe('sendAndStream deduplication', () => {
  test('deduplicates content_block_start events with same index/type/id', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // Should see message_start, one content_block_start, and message_stop
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbsCount = eventTypes.filter((t: string) => t === 'content_block_start').length;
    expect(cbsCount).toBe(1); // Second should be deduped
    consoleLog.mockRestore();
  });

  test('deduplicates tool_approval_request events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"tool_approval_request","toolCallId":"tc-1","toolName":"Bash","input":{},"description":"run ls"}\n\n',
      'data: {"type":"tool_approval_request","toolCallId":"tc-1","toolName":"Bash","input":{},"description":"run ls"}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const tarCount = eventTypes.filter((t: string) => t === 'tool_approval_request').length;
    expect(tarCount).toBe(1);
    consoleLog.mockRestore();
  });

  test('deduplicates user_question_request events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"user_question_request","toolCallId":"q-1","questions":[{"question":"Which?"}]}\n\n',
      'data: {"type":"user_question_request","toolCallId":"q-1","questions":[{"question":"Which?"}]}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const uqrCount = eventTypes.filter((t: string) => t === 'user_question_request').length;
    expect(uqrCount).toBe(1);
    consoleLog.mockRestore();
  });

  test('deduplicates tool_result events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"tool_result","toolCallId":"tr-1","result":"ok","isError":false}\n\n',
      'data: {"type":"tool_result","toolCallId":"tr-1","result":"ok","isError":false}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const trCount = eventTypes.filter((t: string) => t === 'tool_result').length;
    expect(trCount).toBe(1);
    consoleLog.mockRestore();
  });

  test('does NOT deduplicate content_block_delta events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"b"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbdCount = eventTypes.filter((t: string) => t === 'content_block_delta').length;
    expect(cbdCount).toBe(2); // Both should be processed
  });

  test('clears dedup set on message_start', async () => {
    // Turn 1: message_start, content_block_start at index 0
    // Turn 2: message_start, content_block_start at index 0 (same key as turn 1)
    // Without clearing, turn 2's cbs would be deduped incorrectly
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"message_stop"}\n\n',
      'data: {"type":"message_start","message":{"id":"m2"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbsCount = eventTypes.filter((t: string) => t === 'content_block_start').length;
    expect(cbsCount).toBe(2); // Both should pass since dedup set was cleared by message_start
  });

  test('does NOT deduplicate ping events', async () => {
    const sseData = [
      'data: {"type":"ping"}\n\n',
      'data: {"type":"ping"}\n\n',
      'data: {"type":"ping"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const pingCount = eventTypes.filter((t: string) => t === 'ping').length;
    expect(pingCount).toBe(3);
  });

  test('does NOT deduplicate message_start/stop events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
      'data: {"type":"message_start","message":{"id":"m2"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes.filter((t: string) => t === 'message_start').length).toBe(2);
    expect(eventTypes.filter((t: string) => t === 'message_stop').length).toBe(2);
  });
});

// ============================================================================
// sendAndStream — auto-reconnect on network error
// ============================================================================
describe('sendAndStream auto-reconnect', () => {
  test('triggers auto-reconnect after network error when sessionId exists', async () => {
    vi.useFakeTimers();
    mockStreamStore.sessionId = 'session-1';
    mockSend.mockRejectedValue(new Error('Connection reset'));

    // Also mock sessions/reconnect for when reconnectActiveStream is called
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = vi.fn().mockResolvedValue({ ok: true, data: [] });

    const promise = sendAndStream('conv-1', 'Hello');
    await promise;

    // Should have set up a setTimeout for 2000ms
    // The auto-reconnect fires after 2 seconds
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );

    vi.useRealTimers();
  });

  test('does NOT trigger auto-reconnect when no sessionId', async () => {
    mockStreamStore.sessionId = null;
    mockSend.mockRejectedValue(new Error('Connection reset'));

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendAndStream('conv-1', 'Hello');

    // Should NOT have logged auto-reconnect message
    const reconnectLogs = consoleLog.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('auto-reconnect'),
    );
    expect(reconnectLogs.length).toBe(0);
    consoleLog.mockRestore();
  });

  test('does NOT trigger auto-reconnect for AbortError', async () => {
    mockStreamStore.sessionId = 'session-1';
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSend.mockRejectedValue(abortError);

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendAndStream('conv-1', 'Hello');

    // AbortError is user-cancelled, not an unexpected death
    const reconnectLogs = consoleLog.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('auto-reconnect'),
    );
    expect(reconnectLogs.length).toBe(0);
    consoleLog.mockRestore();
  });
});

// ============================================================================
// sendAndStream — generation counter (concurrent stream prevention)
// ============================================================================
describe('sendAndStream generation counter', () => {
  test('abortActiveStream increments generation and aborts controller', () => {
    const mockCtrl = new AbortController();
    const abortSpy = vi.spyOn(mockCtrl, 'abort');
    mockStreamStore.abortController = mockCtrl;

    abortActiveStream();

    expect(abortSpy).toHaveBeenCalled();
  });

  test('abortActiveStream handles already-aborted controller', () => {
    const mockCtrl = new AbortController();
    mockCtrl.abort();
    mockStreamStore.abortController = mockCtrl;

    // Should not throw
    abortActiveStream();
  });

  test('abortActiveStream handles null controller', () => {
    mockStreamStore.abortController = null;
    // Should not throw
    abortActiveStream();
  });
});

// ============================================================================
// getReconnectionPromise
// ============================================================================
describe('getReconnectionPromise', () => {
  test('returns a promise that resolves to null initially', async () => {
    const result = await getReconnectionPromise();
    // The initial reconnectionDone resolves to null
    expect(result).toBeNull();
  });
});

// ============================================================================
// reconnectActiveStream
// ============================================================================
describe('reconnectActiveStream', () => {
  // Additional mocks needed for reconnect
  const mockSessions = vi.fn();
  const mockReconnect = vi.fn();
  const mockConversationsGet = vi.fn();

  beforeEach(async () => {
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = mockSessions;
    apiMock.stream.reconnect = mockReconnect;
    apiMock.conversations = {
      get: mockConversationsGet,
      summarize: vi.fn().mockResolvedValue(undefined),
    };

    mockSessions.mockReset();
    mockReconnect.mockReset();
    mockConversationsGet.mockReset();
  });

  test('returns null when no active sessions', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(true);
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('returns null when sessions request fails', async () => {
    mockSessions.mockResolvedValue({ ok: false, data: [] });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('clears streaming state when all session retries fail', async () => {
    mockSessions.mockRejectedValue(new Error('Network error'));
    mockStreamStore.status = 'streaming';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    // Should emit message_stop to clear streaming state
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('retries sessions request up to 3 times on failure', async () => {
    // Fail first two, succeed on third
    mockSessions
      .mockRejectedValueOnce(new Error('Network 1'))
      .mockRejectedValueOnce(new Error('Network 2'))
      .mockResolvedValueOnce({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    expect(mockSessions).toHaveBeenCalledTimes(3);
    expect(result).toBeNull(); // no sessions found
  });

  test('reconnects to active running session', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"message_start","message":{"id":"m1"}}\n\n'),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 5,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'claude-sonnet-4-5-20250929', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-1');
    expect(mockStreamStore.startStream).toHaveBeenCalledWith('conv-1');
    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('sess-1');
    expect(mockConversationStore.setActive).toHaveBeenCalled();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('prefers running session over completed session', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-old',
          conversationId: 'conv-old',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 10,
        },
        {
          id: 'sess-active',
          conversationId: 'conv-active',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-active', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-active');
    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('sess-active');
  });

  test('falls back to completed session with buffered events when no running session', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    // Use workspace store to set savedConversationId to null (no workspace loaded)
    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = null; // No savedConversationId

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-completed',
          conversationId: 'conv-completed',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 5,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-completed', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    // Should fall back to first completed session when no savedConversationId
    expect(result).toBe('conv-completed');
  });

  test('matches completed session to saved conversation ID', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    // Set workspace with activeConversationId
    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = { snapshot: { activeConversationId: 'conv-matching' } };

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-other',
          conversationId: 'conv-other',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 3,
        },
        {
          id: 'sess-matching',
          conversationId: 'conv-matching',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 8,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-matching', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-matching');
    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('sess-matching');

    // Clean up
    wsStore.activeWorkspace = null;
  });

  test('returns null when saved conversation ID set but no completed session matches', async () => {
    // Set workspace with activeConversationId that doesn't match any session
    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = { snapshot: { activeConversationId: 'conv-nonexistent' } };

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-other',
          conversationId: 'conv-other',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 3,
        },
      ],
    });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    consoleLog.mockRestore();
    wsStore.activeWorkspace = null;
  });

  test('returns null when conversation is not found', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-missing',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({ ok: false, data: null });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
  });

  test('returns null when reconnect response is not ok', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: false, body: null, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('returns null when reconnect has no body', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: null, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('returns null when no matching sessions found', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'completed',
          streamComplete: true,
          bufferedEvents: 0,
        },
      ],
    });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('handles reconnection error gracefully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSessions.mockRejectedValue(new Error('Network error'));
    mockStreamStore.status = 'connecting';

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('emits message_stop on error when status is streaming', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSessions.mockRejectedValue(new Error('Fail'));
    mockStreamStore.status = 'streaming';

    await reconnectActiveStream();

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
    consoleError.mockRestore();
  });

  test('does not emit message_stop on error when status is idle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSessions.mockRejectedValue(new Error('Fail'));
    mockStreamStore.status = 'idle';

    await reconnectActiveStream();

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
    consoleError.mockRestore();
  });

  test('syncs final content blocks during reconnection', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n'),
        );
        controller.close();
      },
    });

    mockStreamStore.contentBlocks = [{ type: 'text', text: 'hi' }];

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 1,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.updateLastAssistantMessageIn).toHaveBeenCalled();
  });

  test('adds assistant message placeholder during reconnection when last message is not assistant', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-1',
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1' }),
      expect.objectContaining({
        role: 'assistant',
        content: [],
        model: 'claude-opus-4-6',
      }),
    );
  });

  test('skips adding assistant message when last message IS already assistant', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-1',
        model: 'test',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'partial...' }] },
        ],
      },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    // Should NOT add another assistant message
    expect(mockConversationStore.addMessageTo).not.toHaveBeenCalled();
  });

  test('adds assistant message when messages array is empty', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'assistant', content: [] }),
    );
  });

  test('reloads conversation from DB after reconnection completes', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-1');
  });

  test('clears in-flight after reconnection completes', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('sets in-flight during reconnection', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    const conv = { id: 'conv-1', model: 'test', messages: [] };
    mockConversationsGet.mockResolvedValue({ ok: true, data: conv });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.setInflight).toHaveBeenCalledWith('conv-1', conv);
  });

  test('replays multiple buffered events during reconnection', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 5,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('content_block_stop');
    expect(eventTypes).toContain('message_stop');
  });

  test('handles malformed JSON in reconnection stream gracefully', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {bad json}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    // Should still process the valid events
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('message_stop');
  });

  test('handles reconnection with partial chunks across buffer boundaries', async () => {
    const response = createMultiChunkResponse([
      'data: {"type":"message_start","message":{"id":"m1"}}\n\ndata: {"type":"content_block_del',
      'ta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\ndata: {"type":"message_stop"}\n\n',
    ]);

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue(response);

    await reconnectActiveStream();

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('message_stop');
  });

  test('forces message_stop during reconnection when stream ends in streaming state', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockStreamStore.status = 'streaming';
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('does NOT force message_stop during reconnection when status is tool_pending', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockStreamStore.status = 'tool_pending';
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
  });

  test('deduplicates events during reconnection', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 4,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbsCount = eventTypes.filter((t: string) => t === 'content_block_start').length;
    expect(cbsCount).toBe(1);
  });

  test('handles session with bufferedEvents>0 but not running (has events not yet streamed)', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'idle', // not 'running'
          streamComplete: false, // not complete
          bufferedEvents: 5, // has events
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    // Should find this as an active session (bufferedEvents > 0 && !streamComplete)
    expect(result).toBe('conv-1');
  });

  test('sets reconnecting flag before any async work', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: [] });

    // The order of setReconnecting calls matters
    let reconnectingSetBeforeSessions = false;
    mockStreamStore.setReconnecting.mockImplementation((val: boolean) => {
      if (val === true && mockSessions.mock.calls.length === 0) {
        reconnectingSetBeforeSessions = true;
      }
    });

    await reconnectActiveStream();

    expect(reconnectingSetBeforeSessions).toBe(true);
  });

  test('getReconnectionPromise returns same promise as reconnectActiveStream', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: [] });

    const promise = reconnectActiveStream();
    const reconnectionPromise = getReconnectionPromise();

    // Both should resolve to the same value
    const [result1, result2] = await Promise.all([promise, reconnectionPromise]);
    expect(result1).toBe(result2);
  });

  test('handles reconnection with empty stream body', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    // Should complete successfully even with empty body
    expect(result).toBe('conv-1');
    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-1');
  });

  test('handles reconnection fetch error (e.g. reconnect endpoint down)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('handles reconnection with reader.read() throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create a stream that errors during read
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error('Stream read error'));
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('sessions request returns null data', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: null });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('handles sessions with undefined data field', async () => {
    mockSessions.mockResolvedValue({ ok: true });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });
});

// ============================================================================
// Edge cases: network interruption scenarios
// ============================================================================
describe('network interruption scenarios', () => {
  test('stream reader error mid-read triggers error event', async () => {
    // Simulate a stream that errors partway through
    const encoder = new TextEncoder();
    let readerCallCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        readerCallCount++;
        if (readerCallCount === 1) {
          controller.enqueue(
            encoder.encode('data: {"type":"message_start","message":{"id":"m1"}}\n\n'),
          );
        } else {
          controller.error(new Error('Network interrupted'));
        }
      },
    });

    mockSend.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      headers: new Headers({ 'X-Session-Id': 'sess-mid-error' }),
    });

    await sendAndStream('conv-1', 'Hello');

    // Should have processed message_start then hit error
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    // The error should be caught and emitted
    expect(eventTypes).toContain('error');
  });

  test('stream aborted during read loop returns gracefully', async () => {
    const ref: { resolve: (() => void) | null } = { resolve: null };
    const stream = new ReadableStream({
      pull(controller) {
        return new Promise<void>((resolve) => {
          ref.resolve = () => {
            controller.close();
            resolve();
          };
        });
      },
    });

    mockSend.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      headers: new Headers(),
    });

    // Start stream but don't await — it will hang until resolved
    const promise = sendAndStream('conv-1', 'Hello');

    // Abort the stream
    abortActiveStream();

    // Resolve the hanging read
    if (ref.resolve) ref.resolve();

    // Now the promise should complete (either via abort or done)
    await promise;
  });

  test('fetch timeout (simulated via AbortController)', async () => {
    // Simulate a fetch timeout via AbortError
    const timeoutError = new DOMException('The operation was aborted.', 'AbortError');
    mockSend.mockRejectedValue(timeoutError);

    await sendAndStream('conv-1', 'Hello');

    // Should be treated like user cancellation
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('server sends 429 Too Many Requests', async () => {
    const errorResponse = {
      ok: false,
      status: 429,
      body: null,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'Rate limit exceeded',
        }),
      }),
    );
  });

  test('server sends 500 with HTML error page (json fails, text returns HTML)', async () => {
    const errorResponse = {
      ok: false,
      status: 500,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('<html><body>Internal Server Error</body></html>'),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: '<html><body>Internal Server Error</body></html>',
        }),
      }),
    );
  });

  test('very long error text is truncated to 300 chars', async () => {
    const longText = 'x'.repeat(500);
    const errorResponse = {
      ok: false,
      status: 500,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve(longText),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    const errorCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (c: any) => c[0]?.type === 'error',
    );
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][0].error.message.length).toBeLessThanOrEqual(300);
  });
});

// ============================================================================
// Page reload scenarios (integration-style)
// ============================================================================
describe('page reload simulation', () => {
  const reloadMockSessions = vi.fn();
  const reloadMockReconnect = vi.fn();
  const reloadMockConversationsGet = vi.fn();

  beforeEach(async () => {
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = reloadMockSessions;
    apiMock.stream.reconnect = reloadMockReconnect;
    apiMock.conversations = {
      get: reloadMockConversationsGet,
      summarize: vi.fn().mockResolvedValue(undefined),
    };

    reloadMockSessions.mockReset();
    reloadMockReconnect.mockReset();
    reloadMockConversationsGet.mockReset();
  });

  test('full page reload → running stream → resume with buffered events', async () => {
    // Simulate: user reloads page while agent is mid-response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // These are the buffered events from the server
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1","role":"assistant","model":"claude-sonnet-4-5-20250929"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me analyze..."}}\n\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my analysis"}}\n\n' +
              'data: {"type":"content_block_stop","index":1}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    reloadMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-reload-1',
          conversationId: 'conv-reload-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 8,
        },
      ],
    });
    reloadMockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-reload-1',
        model: 'claude-sonnet-4-5-20250929',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Analyze this code' }] }],
      },
    });
    reloadMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-reload-1');
    expect(mockConversationStore.setActive).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-reload-1' }),
    );
    // Should have processed all events
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_stop',
    ]);
    // Should reload from DB at the end
    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-reload-1');
  });

  test('full page reload → stream already completed → replay and close', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done!"}}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = { snapshot: { activeConversationId: 'conv-completed' } };

    reloadMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-done',
          conversationId: 'conv-completed',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 4,
        },
      ],
    });
    reloadMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-completed', model: 'test', messages: [] },
    });
    reloadMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-completed');
    wsStore.activeWorkspace = null;
  });

  test('full page reload → no sessions → returns null', async () => {
    reloadMockSessions.mockResolvedValue({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('full page reload → server not ready → retries and eventually fails', async () => {
    // All 3 retries fail
    reloadMockSessions
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStreamStore.status = 'connecting';

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(reloadMockSessions).toHaveBeenCalledTimes(3);
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('full page reload → server returns HTML instead of JSON → retries', async () => {
    // First attempt throws (non-JSON response), second succeeds
    reloadMockSessions
      .mockRejectedValueOnce(new SyntaxError('Unexpected token <'))
      .mockResolvedValueOnce({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    expect(reloadMockSessions).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  test('page reload with tool_pending session preserves pending state', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"tool_approval_request","toolCallId":"tc-1","toolName":"Bash","input":{"command":"rm -rf /"},"description":"Delete everything"}\n\n',
          ),
        );
        // Stream stays open (tool pending)
        controller.close();
      },
    });

    mockStreamStore.status = 'tool_pending'; // simulate the state after replay

    reloadMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-pending',
          conversationId: 'conv-pending',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 2,
        },
      ],
    });
    reloadMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-pending', model: 'test', messages: [] },
    });
    reloadMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-pending');
    // Should have received the tool_approval_request
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('tool_approval_request');
    // Should NOT have forced message_stop (tool_pending state)
    const stopCalls = eventTypes.filter((t: string) => t === 'message_stop');
    expect(stopCalls.length).toBe(0);
  });
});

// ============================================================================
// Content sync edge cases
// ============================================================================
describe('content sync edge cases', () => {
  test('syncs content blocks to conversation on each event during send', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockStreamStore.contentBlocks = [{ type: 'text', text: 'hi' }];
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // updateLastAssistantMessageIn should be called for each event
    expect(mockConversationStore.updateLastAssistantMessageIn).toHaveBeenCalled();
  });

  test('does not sync empty content blocks on final sync', async () => {
    mockStreamStore.contentBlocks = [];
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    // The final sync only runs if contentBlocks.length > 0
    // But in-loop syncs still happen for each event
    // Since no events were processed, updateLastAssistantMessageIn should not be called
    expect(mockConversationStore.updateLastAssistantMessageIn).not.toHaveBeenCalled();
  });
});
