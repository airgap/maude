import { describe, test, expect, vi, beforeEach } from 'vitest';
import { api } from '../client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('api.conversations', () => {
  test('list calls GET /api/conversations', async () => {
    const responseData = { ok: true, data: [{ id: 'conv-1' }] };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.list();
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations', expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }));
  });

  test('get calls GET /api/conversations/:id', async () => {
    const responseData = { ok: true, data: { id: 'conv-1', title: 'Test' } };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.get('conv-1');
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations/conv-1', expect.any(Object));
  });

  test('create calls POST /api/conversations with body', async () => {
    const responseData = { ok: true, data: { id: 'new-conv' } };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.create({ title: 'New Chat', model: 'claude-opus-4-6' });
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'New Chat', model: 'claude-opus-4-6' }),
      }),
    );
  });

  test('update calls PATCH /api/conversations/:id', async () => {
    const responseData = { ok: true };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    await api.conversations.update('conv-1', { title: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/conversations/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api.conversations.delete('conv-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('cost calls GET /api/conversations/:id/cost', async () => {
    const responseData = {
      ok: true,
      data: { model: 'sonnet', totalTokens: 100, inputTokens: 30, outputTokens: 70, estimatedCostUsd: 0.01 },
    };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.cost('conv-1');
    expect(result.data.totalTokens).toBe(100);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations/conv-1/cost', expect.any(Object));
  });
});

describe('api.tasks', () => {
  test('list calls GET /api/tasks', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.tasks.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks', expect.any(Object));
  });

  test('list with conversationId includes query param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.tasks.list('conv-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks?conversationId=conv-1', expect.any(Object));
  });

  test('get calls GET /api/tasks/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'task-1' } }));
    await api.tasks.get('task-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/task-1', expect.any(Object));
  });

  test('create calls POST /api/tasks', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'task-1' } }));
    await api.tasks.create({ subject: 'Test', description: 'Desc' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('update calls PATCH /api/tasks/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.tasks.update('task-1', { status: 'completed' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/tasks/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.tasks.delete('task-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('api.settings', () => {
  test('get calls GET /api/settings', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { theme: 'dark' } }));
    const result = await api.settings.get();
    expect(result.data.theme).toBe('dark');
  });

  test('update calls PATCH /api/settings', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.settings.update({ theme: 'light' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ settings: { theme: 'light' } }),
      }),
    );
  });
});

describe('api.mcp', () => {
  test('listServers calls GET /api/mcp/servers', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.mcp.listServers();
    expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers', expect.any(Object));
  });

  test('addServer calls POST /api/mcp/servers', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.mcp.addServer({ name: 'test', transport: 'stdio', command: 'node' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/mcp/servers',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('removeServer calls DELETE /api/mcp/servers/:name', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.mcp.removeServer('test');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/mcp/servers/test',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('getServer calls GET /api/mcp/servers/:name', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { name: 'test' } }));
    await api.mcp.getServer('test');
    expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers/test', expect.any(Object));
  });
});

describe('api.memory', () => {
  test('list calls GET /api/memory', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.memory.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/memory', expect.any(Object));
  });

  test('list with projectPath includes encoded query param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.memory.list('/my/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/memory?projectPath=%2Fmy%2Fproject',
      expect.any(Object),
    );
  });

  test('update calls PUT /api/memory', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.memory.update('/path/to/file', 'content');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/memory',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ path: '/path/to/file', content: 'content' }),
      }),
    );
  });
});

describe('api.files', () => {
  test('read calls GET /api/files/read with encoded path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { path: '/a/b', content: 'hi' } }));
    await api.files.read('/a/b');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/read?path=%2Fa%2Fb',
      expect.any(Object),
    );
  });

  test('tree calls GET /api/files/tree with params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.files.tree('/root', 3);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('path=%2Froot');
    expect(url).toContain('depth=3');
  });

  test('directories calls GET /api/files/directories', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { parent: '/', directories: [] } }),
    );
    await api.files.directories('/root');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('path=%2Froot');
  });
});

describe('api.agents', () => {
  test('list calls GET /api/agents', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.agents.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/agents', expect.any(Object));
  });

  test('list with parentSessionId includes query param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.agents.list('session-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/agents?parentSessionId=session-1', expect.any(Object));
  });

  test('spawn calls POST /api/agents', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { agentId: 'a1', sessionId: 's1' } }));
    await api.agents.spawn({ type: 'explore', prompt: 'test' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agents',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('get calls GET /api/agents/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.agents.get('agent-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent-1', expect.any(Object));
  });

  test('cancel calls POST /api/agents/:id/cancel', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.agents.cancel('agent-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agents/agent-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('api.tools', () => {
  test('list calls GET /api/tools', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.tools.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/tools', expect.any(Object));
  });
});

describe('api.stream', () => {
  test('send calls POST /api/stream/:conversationId', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await api.stream.send('conv-1', 'Hello');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/conv-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Hello' }),
      }),
    );
  });

  test('send includes session ID header when provided', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await api.stream.send('conv-1', 'Hello', 'session-123');
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers['X-Session-Id']).toBe('session-123');
  });

  test('send does not include session ID header when null', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await api.stream.send('conv-1', 'Hello', null);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers['X-Session-Id']).toBeUndefined();
  });

  test('cancel calls POST /api/stream/:id/cancel with session header', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.stream.cancel('conv-1', 'session-123');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/conv-1/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Session-Id': 'session-123' }),
      }),
    );
  });
});

describe('error handling', () => {
  test('throws on non-ok response with error from body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'Conversation not found' }),
    });

    await expect(api.conversations.get('nonexistent')).rejects.toThrow('Conversation not found');
  });

  test('falls back to status text when no error in body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    });

    await expect(api.conversations.list()).rejects.toThrow('HTTP 500');
  });

  test('handles JSON parse failure in error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('invalid json')),
    });

    await expect(api.conversations.list()).rejects.toThrow('Internal Server Error');
  });
});
