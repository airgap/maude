import { describe, test, expect, vi, beforeEach } from 'vitest';

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
  },
}));

import { sendAndStream, cancelStream } from '../sse';

beforeEach(() => {
  vi.clearAllMocks();
  mockStreamStore.contentBlocks = [];
  mockStreamStore.sessionId = 'session-1';
  mockStreamStore.conversationId = null;
  mockStreamStore.isStreaming = false;
  mockStreamStore.status = 'idle';
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

    // The stream ends with isStreaming=true, so the code should
    // check and emit message_stop. However, the mock values are checked
    // AFTER the stream reading loop. We need to simulate the state at that point.
    // The mock isStreaming is set before the call - it's a property, not
    // dynamic. The function checks streamStore.isStreaming after the while loop.
    // Since we set it to true before calling, it'll be true after the empty stream.
    await sendAndStream('conv-1', 'Hello');

    // Should have called handleEvent with message_stop at least once
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

  test('reloads conversation after stream completes', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-1');
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

    // The first arg to mockSend is convId, second is content, third is sessionId, fourth is signal, fifth is attachments
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

    // The second call to addMessageTo is the assistant message
    const assistantCall = mockConversationStore.addMessageTo.mock.calls[1];
    expect(assistantCall[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        model: 'claude-opus-4-6',
      }),
    );
  });

  test('handles multiple SSE events with buffering across chunks', async () => {
    // Simulate a stream that delivers data in two chunks, with a partial event at the boundary
    const encoder = new TextEncoder();
    const chunk1 = encoder.encode(
      'data: {"type":"message_start","message":{"id":"m1"}}\n\ndata: {"typ',
    );
    const chunk2 = encoder.encode(
      'e":"content_block_delta","delta":{"text":"hi"}}\n\ndata: {"type":"message_stop"}\n\n',
    );

    let chunkIndex = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex === 0) {
          controller.enqueue(chunk1);
          chunkIndex++;
        } else if (chunkIndex === 1) {
          controller.enqueue(chunk2);
          chunkIndex++;
        } else {
          controller.close();
        }
      },
    });

    mockSend.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      headers: new Headers(),
    });

    await sendAndStream('conv-1', 'Hello');

    // All three events should have been parsed
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('message_stop');
  });
});

describe('reconnectActiveStream', () => {
  // Import the function under test
  let reconnectActiveStream: typeof import('../sse').reconnectActiveStream;

  // Additional mocks needed for reconnect
  const { mockSessions, mockReconnect, mockConversationsGet } = vi.hoisted(() => ({
    mockSessions: vi.fn(),
    mockReconnect: vi.fn(),
    mockConversationsGet: vi.fn(),
  }));

  beforeEach(async () => {
    // We need to re-import to pick up fresh mocks
    // But since vi.mock is hoisted, we just need to set up the mocks
    // The api mock in the mock factory only has stream.send and stream.cancel
    // We need to extend it for reconnect tests
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = mockSessions;
    apiMock.stream.reconnect = mockReconnect;
    apiMock.conversations = { get: mockConversationsGet };

    mockSessions.mockReset();
    mockReconnect.mockReset();
    mockConversationsGet.mockReset();

    // Re-import the function
    const sseModule = await import('../sse');
    reconnectActiveStream = sseModule.reconnectActiveStream;
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

  test('adds assistant message placeholder during reconnection', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
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
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'claude-opus-4-6', messages: [] },
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

  test('reloads conversation from DB after reconnection completes', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
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
});
