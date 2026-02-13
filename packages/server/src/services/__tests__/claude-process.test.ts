import { describe, test, expect } from 'bun:test';
import { translateCliEvent, claudeManager } from '../claude-process';

describe('translateCliEvent', () => {
  test('returns empty array for system event', () => {
    const events = translateCliEvent({ type: 'system', subtype: 'init', session_id: 'abc' });
    expect(events).toEqual([]);
  });

  test('returns empty array for unknown event type', () => {
    const events = translateCliEvent({ type: 'unknown_type' });
    expect(events).toEqual([]);
  });

  test('translates assistant text message', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        id: 'msg-1',
        model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));

    // message_start
    expect(parsed[0].type).toBe('message_start');
    expect(parsed[0].message.role).toBe('assistant');
    expect(parsed[0].message.model).toBe('claude-sonnet-4-5-20250929');

    // content_block_start
    expect(parsed[1].type).toBe('content_block_start');
    expect(parsed[1].index).toBe(0);
    expect(parsed[1].content_block.type).toBe('text');

    // content_block_delta
    expect(parsed[2].type).toBe('content_block_delta');
    expect(parsed[2].delta.type).toBe('text_delta');
    expect(parsed[2].delta.text).toBe('Hello world');

    // content_block_stop
    expect(parsed[3].type).toBe('content_block_stop');
    expect(parsed[3].index).toBe(0);
  });

  test('translates assistant thinking block', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', thinking: 'Let me think...' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // Skip message_start (index 0)
    expect(parsed[1].content_block.type).toBe('thinking');
    expect(parsed[2].delta.type).toBe('thinking_delta');
    expect(parsed[2].delta.thinking).toBe('Let me think...');
  });

  test('translates assistant tool_use block', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[1].content_block.type).toBe('tool_use');
    expect(parsed[1].content_block.name).toBe('Bash');
    expect(parsed[1].content_block.id).toBe('tool-1');
    expect(parsed[2].delta.type).toBe('input_json_delta');
    expect(JSON.parse(parsed[2].delta.partial_json)).toEqual({ command: 'ls' });
  });

  test('translates multiple content blocks', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Here is the answer' },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // message_start + (start,delta,stop) * 2 = 7 events
    expect(parsed).toHaveLength(7);
    expect(parsed[1].index).toBe(0);
    expect(parsed[4].index).toBe(1);
  });

  test('translates result event with usage', () => {
    const events = translateCliEvent({
      type: 'result',
      subtype: 'success',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('message_delta');
    expect(parsed[0].delta.stop_reason).toBe('end_turn');
    expect(parsed[0].usage.input_tokens).toBe(100);
    expect(parsed[0].usage.output_tokens).toBe(50);
    expect(parsed[0].usage.cache_creation_input_tokens).toBe(10);
    expect(parsed[0].usage.cache_read_input_tokens).toBe(5);
    expect(parsed[1].type).toBe('message_stop');
  });

  test('handles result with defaults', () => {
    const events = translateCliEvent({ type: 'result' });
    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0].delta.stop_reason).toBe('end_turn');
    expect(parsed[0].usage.input_tokens).toBe(0);
    expect(parsed[0].usage.output_tokens).toBe(0);
  });

  test('handles assistant event with no message', () => {
    const events = translateCliEvent({ type: 'assistant' });
    expect(events).toEqual([]);
  });

  test('preserves parent_tool_use_id', () => {
    const events = translateCliEvent({
      type: 'assistant',
      parent_tool_use_id: 'parent-1',
      message: {
        content: [{ type: 'text', text: 'nested' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    for (const evt of parsed) {
      expect(evt.parent_tool_use_id).toBe('parent-1');
    }
  });

  test('handles empty content array', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: { content: [] },
    });
    const parsed = events.map((e) => JSON.parse(e));
    // Only message_start
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('message_start');
  });

  test('assigns id when message has none', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    const parsed = JSON.parse(events[0]);
    expect(parsed.message.id).toBeTruthy();
    expect(parsed.message.model).toBe('unknown');
  });
});

describe('ClaudeProcessManager', () => {
  test('createSession returns a session id', async () => {
    const sessionId = await claudeManager.createSession('conv-test-1');
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe('string');
  });

  test('createSession stores session with correct defaults', async () => {
    const sessionId = await claudeManager.createSession('conv-test-2');
    const session = claudeManager.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session!.conversationId).toBe('conv-test-2');
    expect(session!.status).toBe('idle');
  });

  test('createSession stores options', async () => {
    const sessionId = await claudeManager.createSession('conv-test-3', {
      model: 'claude-opus-4-6',
      systemPrompt: 'Be helpful',
      projectPath: '/tmp',
      effort: 'high',
      maxBudgetUsd: 5.0,
      maxTurns: 10,
      allowedTools: ['Read'],
      disallowedTools: ['Bash'],
      resumeSessionId: 'cli-sess-1',
    });
    const session = claudeManager.getSession(sessionId);
    expect(session!.model).toBe('claude-opus-4-6');
    expect(session!.systemPrompt).toBe('Be helpful');
    expect(session!.projectPath).toBe('/tmp');
    expect(session!.effort).toBe('high');
    expect(session!.maxBudgetUsd).toBe(5.0);
    expect(session!.maxTurns).toBe(10);
    expect(session!.allowedTools).toEqual(['Read']);
    expect(session!.disallowedTools).toEqual(['Bash']);
    expect(session!.cliSessionId).toBe('cli-sess-1');
  });

  test('getSession returns undefined for unknown id', () => {
    expect(claudeManager.getSession('nonexistent')).toBeUndefined();
  });

  test('listSessions returns all sessions', async () => {
    const id1 = await claudeManager.createSession('conv-list-1');
    const id2 = await claudeManager.createSession('conv-list-2');
    const sessions = claudeManager.listSessions();
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  test('terminateSession removes session', async () => {
    const sessionId = await claudeManager.createSession('conv-term-1');
    expect(claudeManager.getSession(sessionId)).toBeDefined();
    claudeManager.terminateSession(sessionId);
    expect(claudeManager.getSession(sessionId)).toBeUndefined();
  });

  test('terminateSession does nothing for unknown id', () => {
    // Should not throw
    claudeManager.terminateSession('nonexistent');
  });

  test('cancelGeneration does nothing for unknown id', () => {
    // Should not throw
    claudeManager.cancelGeneration('nonexistent');
  });

  test('sendMessage throws for unknown session', async () => {
    try {
      await claudeManager.sendMessage('nonexistent', 'hello');
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toContain('not found');
    }
  });

  test('sendMessage throws for terminated session', async () => {
    const sessionId = await claudeManager.createSession('conv-term-2');
    claudeManager.terminateSession(sessionId);

    // Re-create to test terminated state manually
    const sessionId2 = await claudeManager.createSession('conv-term-3');
    const session = claudeManager.getSession(sessionId2);
    session!.status = 'terminated';

    try {
      await claudeManager.sendMessage(sessionId2, 'hello');
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('terminated');
    }
  });
});
