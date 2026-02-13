import { describe, test, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mocks that can be referenced in vi.mock factories
const { mockStreamStore, mockConversationStore, mockSend, mockCancel } = vi.hoisted(() => ({
  mockStreamStore: {
    setAbortController: vi.fn(),
    startStream: vi.fn(),
    handleEvent: vi.fn(),
    setSessionId: vi.fn(),
    sessionId: 'session-1' as string | null,
    contentBlocks: [] as any[],
    cancel: vi.fn(),
  },
  mockConversationStore: {
    addMessage: vi.fn(),
    updateLastAssistantMessage: vi.fn(),
    active: { model: 'claude-sonnet-4-5-20250929' },
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

vi.mock('../client', () => ({
  api: {
    stream: {
      send: mockSend,
      cancel: mockCancel,
    },
  },
}));

import { sendAndStream, cancelStream } from '../sse';

beforeEach(() => {
  vi.clearAllMocks();
  mockStreamStore.contentBlocks = [];
  mockStreamStore.sessionId = 'session-1';
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
    expect(mockStreamStore.startStream).toHaveBeenCalled();
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith(
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

    expect(mockConversationStore.addMessage).toHaveBeenCalledTimes(2);
    expect(mockConversationStore.addMessage).toHaveBeenCalledWith(
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

    expect(mockConversationStore.updateLastAssistantMessage).toHaveBeenCalled();
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
