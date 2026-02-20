import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { StreamEvent, StreamCommentary } from '@e/shared';
import {
  CommentatorService,
  summariseBatch,
  PERSONALITY_PROMPTS,
  MIN_BATCH_MS,
  MAX_BATCH_MS,
  type CommentaryPersonality,
  type LlmCaller,
} from '../commentator';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeTextDelta(text: string): StreamEvent {
  return {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  };
}

function makeToolResult(toolName: string, isError = false): StreamEvent {
  return {
    type: 'tool_result',
    toolCallId: 'tc_1',
    toolName,
    result: 'ok',
    isError,
  };
}

function makeMessageStart(model = 'claude-haiku'): StreamEvent {
  return {
    type: 'message_start',
    message: { id: 'msg_1', role: 'assistant', model },
  };
}

function makeToolUseStart(toolName: string): StreamEvent {
  return {
    type: 'tool_use_start',
    toolCallId: 'tc_1',
    toolName,
    input: {},
  };
}

function makePing(): StreamEvent {
  return { type: 'ping' };
}

function makeMessageStop(): StreamEvent {
  return { type: 'message_stop' };
}

// ---------------------------------------------------------------------------
// summariseBatch
// ---------------------------------------------------------------------------

describe('summariseBatch', () => {
  test('returns empty string for empty batch', () => {
    expect(summariseBatch([])).toBe('');
  });

  test('summarises message_start events', () => {
    const result = summariseBatch([makeMessageStart('claude-haiku-4-5')], 'high');
    expect(result).toContain('Agent started a new response');
    expect(result).toContain('claude-haiku-4-5');
  });

  test('summarises text deltas with preview', () => {
    const result = summariseBatch([makeTextDelta('Hello world')], 'high');
    expect(result).toContain('Agent wrote: "Hello world"');
  });

  test('truncates long text deltas', () => {
    const longText = 'x'.repeat(200);
    const result = summariseBatch([makeTextDelta(longText)], 'high');
    expect(result).toContain('…');
    // Preview should be at most 120 chars of the text
    expect(result.length).toBeLessThan(250);
  });

  test('summarises tool results', () => {
    const result = summariseBatch([makeToolResult('Read', false)], 'high');
    expect(result).toContain('"Read"');
    expect(result).toContain('succeeded');
  });

  test('summarises failed tool results', () => {
    const result = summariseBatch([makeToolResult('Write', true)], 'high');
    expect(result).toContain('"Write"');
    expect(result).toContain('failed');
  });

  test('summarises tool_use_start', () => {
    const result = summariseBatch([makeToolUseStart('Bash')], 'high');
    expect(result).toContain('Agent invoking tool "Bash"');
  });

  test('skips ping events', () => {
    const result = summariseBatch([makePing()]);
    // Ping is handled by an empty case — the catch-all won't fire
    expect(result).toBe('');
  });

  test('deduplicates consecutive identical summaries', () => {
    const events = [makeTextDelta('hello'), makeTextDelta('hello'), makeTextDelta('hello')];
    const result = summariseBatch(events);
    const lines = result.split('\n');
    expect(lines.length).toBe(1);
  });

  test('summarises mixed event batches', () => {
    const events: StreamEvent[] = [
      makeMessageStart(),
      makeToolUseStart('Read'),
      makeToolResult('Read'),
      makeTextDelta('Implementation done'),
      makeMessageStop(),
    ];
    const result = summariseBatch(events);
    expect(result).toContain('Agent started');
    expect(result).toContain('Agent invoking tool "Read"');
    expect(result).toContain('"Read" succeeded');
    expect(result).toContain('Agent wrote');
    expect(result).toContain('Agent message complete');
  });

  test('summarises error events', () => {
    const events: StreamEvent[] = [
      { type: 'error', error: { type: 'cli_error', message: 'Something broke' } },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('Error: Something broke');
  });

  test('summarises verification results', () => {
    const events: StreamEvent[] = [
      {
        type: 'verification_result',
        filePath: '/src/main.ts',
        passed: true,
        issues: [],
        tool: 'tsc',
        duration: 500,
      },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('/src/main.ts');
    expect(result).toContain('passed');
  });

  test('summarises content_block_start for thinking', () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('Agent is thinking');
  });

  test('summarises content_block_start for tool_use', () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' },
      },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('tool: Read');
  });
});

// ---------------------------------------------------------------------------
// Personality prompts
// ---------------------------------------------------------------------------

describe('PERSONALITY_PROMPTS', () => {
  const personalities: CommentaryPersonality[] = [
    'sports_announcer',
    'documentary_narrator',
    'technical_analyst',
    'comedic_observer',
    'project_lead',
  ];

  test('all five personalities have prompts', () => {
    for (const p of personalities) {
      expect(PERSONALITY_PROMPTS[p]).toBeDefined();
      expect(PERSONALITY_PROMPTS[p].length).toBeGreaterThan(50);
    }
  });

  test('project_lead uses first person', () => {
    expect(PERSONALITY_PROMPTS.project_lead).toContain('first person');
  });

  test('sports_announcer is energetic', () => {
    expect(PERSONALITY_PROMPTS.sports_announcer).toContain('energetic');
  });
});

// ---------------------------------------------------------------------------
// CommentatorService — lifecycle
// ---------------------------------------------------------------------------

describe('CommentatorService — lifecycle', () => {
  let service: CommentatorService;
  const mockLlm: LlmCaller = async () => 'mock response';

  beforeEach(() => {
    service = new CommentatorService(mockLlm);
  });

  afterEach(() => {
    service.stopCommentary('ws-1');
    service.stopCommentary('ws-2');
  });

  test('startCommentary makes the workspace active', () => {
    expect(service.isActive('ws-1')).toBe(false);
    service.startCommentary('ws-1', 'sports_announcer');
    expect(service.isActive('ws-1')).toBe(true);
    expect(service.getPersonality('ws-1')).toBe('sports_announcer');
  });

  test('stopCommentary deactivates the workspace', () => {
    service.startCommentary('ws-1', 'technical_analyst');
    expect(service.isActive('ws-1')).toBe(true);
    service.stopCommentary('ws-1');
    expect(service.isActive('ws-1')).toBe(false);
    expect(service.getPersonality('ws-1')).toBeUndefined();
  });

  test('startCommentary replaces existing commentator', () => {
    service.startCommentary('ws-1', 'sports_announcer');
    service.startCommentary('ws-1', 'comedic_observer');
    expect(service.getPersonality('ws-1')).toBe('comedic_observer');
  });

  test('stopCommentary is safe for non-existent workspace', () => {
    expect(() => service.stopCommentary('nonexistent')).not.toThrow();
  });

  test('pushEvent ignores events for inactive workspaces', () => {
    expect(() => service.pushEvent('ws-inactive', makeTextDelta('hello'))).not.toThrow();
  });

  test('pushEvent ignores ping events', () => {
    service.startCommentary('ws-1', 'sports_announcer');
    service.pushEvent('ws-1', makePing());
    // No errors, ping is silently dropped
  });
});

// ---------------------------------------------------------------------------
// CommentatorService — event batching
// ---------------------------------------------------------------------------

describe('CommentatorService — event batching', () => {
  let service: CommentatorService;
  let mockCallLlm: ReturnType<typeof mock>;

  beforeEach(() => {
    mockCallLlm = mock(() => Promise.resolve('Generated commentary'));
    service = new CommentatorService(mockCallLlm as LlmCaller);
  });

  afterEach(() => {
    service.stopCommentary('ws-1');
  });

  test('batches events and calls LLM after MIN_BATCH_MS', async () => {
    service.startCommentary('ws-1', 'sports_announcer');

    // Push events
    service.pushEvent('ws-1', makeMessageStart());
    service.pushEvent('ws-1', makeToolUseStart('Read'));
    service.pushEvent('ws-1', makeToolResult('Read'));

    // LLM should not be called immediately
    expect(mockCallLlm).not.toHaveBeenCalled();

    // Wait for the batch timer to fire (MIN_BATCH_MS = 3s + buffer)
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));

    // Now the LLM should have been called
    expect(mockCallLlm).toHaveBeenCalledTimes(1);

    // Verify the call was made with correct shape
    const callArgs = mockCallLlm.mock.calls[0][0] as any;
    expect(callArgs.system).toContain('sports announcer');
    expect(callArgs.user).toContain('Agent started');
    expect(callArgs.user).toContain('Agent invoking tool "Read"');
    expect(callArgs.model).toContain('haiku');
  }, 10_000);

  test('emits StreamCommentary event after LLM call', async () => {
    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'documentary_narrator');
    service.pushEvent('ws-1', makeMessageStart());

    // Wait for batch + LLM
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(received.length).toBe(1);
    expect(received[0].type).toBe('commentary');
    expect(received[0].text).toBe('Generated commentary');
    expect(received[0].personality).toBe('documentary_narrator');
    expect(received[0].workspaceId).toBe('ws-1');
    expect(received[0].timestamp).toBeGreaterThan(0);
  }, 10_000);

  test('flushes batch at MAX_BATCH_MS even with continuous events', async () => {
    service.startCommentary('ws-1', 'technical_analyst');

    // Push events spread over time (simulating continuous activity)
    const pushInterval = setInterval(() => {
      service.pushEvent('ws-1', makeTextDelta('ongoing work'));
    }, 500);

    // Wait beyond MAX_BATCH_MS + buffer for LLM call to complete
    await new Promise((resolve) => setTimeout(resolve, MAX_BATCH_MS + 1_500));
    clearInterval(pushInterval);

    // Should have been called at least once (batch flushed at 5s max)
    expect(mockCallLlm.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 15_000);

  test('does not overlap LLM calls — drops batch if generating', async () => {
    // Make callLlm slow
    const slowMock = mock(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('Slow commentary'), 5_000)),
    );
    service = new CommentatorService(slowMock as LlmCaller);

    service.startCommentary('ws-1', 'comedic_observer');

    // Trigger first batch
    service.pushEvent('ws-1', makeMessageStart());
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));

    // First call should be in-flight
    expect(slowMock).toHaveBeenCalledTimes(1);

    // Push more events while first call is in-flight
    service.pushEvent('ws-1', makeToolUseStart('Edit'));
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));

    // The second batch should have been dropped (generating flag is true)
    expect(slowMock).toHaveBeenCalledTimes(1);

    // Wait for the first call to complete
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }, 20_000);

  test('handles LLM errors gracefully without stopping commentary', async () => {
    const failThenSucceed = mock()
      .mockImplementationOnce(() => Promise.reject(new Error('LLM unavailable')))
      .mockImplementationOnce(() => Promise.resolve('Recovered'));

    service = new CommentatorService(failThenSucceed as unknown as LlmCaller);

    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'project_lead');
    service.pushEvent('ws-1', makeMessageStart());

    // Wait for batch + failed LLM
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    // No commentary should be emitted on error
    expect(received.length).toBe(0);

    // But commentator should still be active
    expect(service.isActive('ws-1')).toBe(true);

    // And should accept new events — this time mock succeeds
    service.pushEvent('ws-1', makeToolUseStart('Read'));
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(received.length).toBe(1);
    expect(received[0].text).toBe('Recovered');
  }, 15_000);

  test('does not emit commentary if stopped during LLM call', async () => {
    let resolveLlm!: (v: string) => void;
    const pendingMock = mock(
      () =>
        new Promise<string>((resolve) => {
          resolveLlm = resolve;
        }),
    );
    service = new CommentatorService(pendingMock as LlmCaller);

    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'sports_announcer');
    service.pushEvent('ws-1', makeMessageStart());

    // Wait for batch to trigger
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));
    expect(pendingMock).toHaveBeenCalledTimes(1);

    // Stop commentary while LLM is in-flight
    service.stopCommentary('ws-1');

    // Resolve LLM call
    resolveLlm('Should not be emitted');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // No commentary should be emitted because we stopped
    expect(received.length).toBe(0);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// CommentatorService — multiple workspaces
// ---------------------------------------------------------------------------

describe('CommentatorService — multiple workspaces', () => {
  let service: CommentatorService;
  let mockCallLlm: ReturnType<typeof mock>;

  beforeEach(() => {
    mockCallLlm = mock(() => Promise.resolve('Multi-workspace commentary'));
    service = new CommentatorService(mockCallLlm as LlmCaller);
  });

  afterEach(() => {
    service.stopCommentary('ws-1');
    service.stopCommentary('ws-2');
  });

  test('independent commentators for different workspaces', async () => {
    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'sports_announcer');
    service.startCommentary('ws-2', 'documentary_narrator');

    service.pushEvent('ws-1', makeMessageStart());
    service.pushEvent('ws-2', makeToolUseStart('Edit'));

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    // Both workspaces should generate commentary
    expect(mockCallLlm.mock.calls.length).toBe(2);
    expect(received.length).toBe(2);

    const ws1Commentary = received.find((c) => c.workspaceId === 'ws-1');
    const ws2Commentary = received.find((c) => c.workspaceId === 'ws-2');
    expect(ws1Commentary?.personality).toBe('sports_announcer');
    expect(ws2Commentary?.personality).toBe('documentary_narrator');
  }, 10_000);
});
