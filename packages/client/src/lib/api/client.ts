const BASE_URL =
  typeof window !== 'undefined' && (window as any).__TAURI__ ? 'http://localhost:3002/api' : '/api';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string>) },
      ...opts,
    });
  } catch (err) {
    throw new Error('Cannot connect to server. Is the backend running?');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      res.ok
        ? 'Server returned non-JSON response. Is the backend running?'
        : `HTTP ${res.status}: ${res.statusText}`,
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Conversations ---
export const api = {
  conversations: {
    list: () => request<{ ok: boolean; data: any[] }>('/conversations'),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/conversations/${id}`),
    create: (body: {
      title?: string;
      model?: string;
      systemPrompt?: string;
      projectPath?: string;
      permissionMode?: string;
      effort?: string;
      maxBudgetUsd?: number;
      maxTurns?: number;
      allowedTools?: string[];
      disallowedTools?: string[];
      planMode?: boolean;
    }) =>
      request<{ ok: boolean; data: { id: string } }>('/conversations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),
    cost: (id: string) =>
      request<{
        ok: boolean;
        data: {
          model: string;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
        };
      }>(`/conversations/${id}/cost`),
  },

  // --- Streaming ---
  stream: {
    send: (conversationId: string, content: string, sessionId?: string | null) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionId) headers['X-Session-Id'] = sessionId;
      return fetch(`${BASE_URL}/stream/${conversationId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      });
    },
    cancel: (conversationId: string, sessionId: string) =>
      request(`/stream/${conversationId}/cancel`, {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId },
      }),
  },

  // --- Tasks ---
  tasks: {
    list: (conversationId?: string) => {
      const q = conversationId ? `?conversationId=${conversationId}` : '';
      return request<{ ok: boolean; data: any[] }>(`/tasks${q}`);
    },
    get: (id: string) => request<{ ok: boolean; data: any }>(`/tasks/${id}`),
    create: (body: {
      subject: string;
      description: string;
      activeForm?: string;
      conversationId?: string;
    }) =>
      request<{ ok: boolean; data: { id: string } }>('/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
  },

  // --- Settings ---
  settings: {
    get: () => request<{ ok: boolean; data: Record<string, any> }>('/settings'),
    update: (settings: Record<string, any>) =>
      request<{ ok: boolean }>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings }),
      }),
  },

  // --- MCP ---
  mcp: {
    listServers: () => request<{ ok: boolean; data: any[] }>('/mcp/servers'),
    addServer: (body: any) =>
      request<{ ok: boolean }>('/mcp/servers', { method: 'POST', body: JSON.stringify(body) }),
    removeServer: (name: string) =>
      request<{ ok: boolean }>(`/mcp/servers/${name}`, { method: 'DELETE' }),
    getServer: (name: string) => request<{ ok: boolean; data: any }>(`/mcp/servers/${name}`),
  },

  // --- Memory ---
  memory: {
    list: (projectPath?: string) => {
      const q = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/memory${q}`);
    },
    update: (path: string, content: string) =>
      request<{ ok: boolean }>('/memory', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
  },

  // --- Files ---
  files: {
    read: (path: string) =>
      request<{ ok: boolean; data: { path: string; content: string } }>(
        `/files/read?path=${encodeURIComponent(path)}`,
      ),
    write: (path: string, content: string) =>
      request<{ ok: boolean }>('/files/write', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
    create: (path: string, content = '') =>
      request<{ ok: boolean }>('/files/create', {
        method: 'POST',
        body: JSON.stringify({ path, content }),
      }),
    delete: (path: string) =>
      request<{ ok: boolean }>(`/files/delete?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      }),
    rename: (oldPath: string, newPath: string) =>
      request<{ ok: boolean }>('/files/rename', {
        method: 'POST',
        body: JSON.stringify({ oldPath, newPath }),
      }),
    tree: (path?: string, depth?: number) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      if (depth) params.set('depth', String(depth));
      return request<{ ok: boolean; data: any[] }>(`/files/tree?${params}`);
    },
    editorConfig: (path: string) =>
      request<{ ok: boolean; data: import('@maude/shared').EditorConfigProps }>(
        `/files/editorconfig?path=${encodeURIComponent(path)}`,
      ),
    directories: (path?: string) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      return request<{
        ok: boolean;
        data: { parent: string; directories: { name: string; path: string }[] };
      }>(`/files/directories?${params}`);
    },
  },

  // --- Projects ---
  projects: {
    list: () => request<{ ok: boolean; data: any[] }>('/projects'),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/projects/${id}`),
    create: (body: { name: string; path: string; settings?: any }) =>
      request<{ ok: boolean; data: { id: string } }>('/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
    open: (id: string) => request<{ ok: boolean }>(`/projects/${id}/open`, { method: 'POST' }),
  },

  // --- Agents ---
  agents: {
    list: (parentSessionId?: string) => {
      const q = parentSessionId ? `?parentSessionId=${parentSessionId}` : '';
      return request<{ ok: boolean; data: any[] }>(`/agents${q}`);
    },
    spawn: (body: any) =>
      request<{ ok: boolean; data: { agentId: string; sessionId: string } }>('/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/agents/${id}`),
    cancel: (id: string) => request<{ ok: boolean }>(`/agents/${id}/cancel`, { method: 'POST' }),
  },

  // --- Tools ---
  tools: {
    list: () => request<{ ok: boolean; data: any[] }>('/tools'),
  },

  // --- Search ---
  search: {
    query: (q: string, path: string, regex = false, limit = 500) => {
      const params = new URLSearchParams({ q, path, regex: String(regex), limit: String(limit) });
      return request<{
        ok: boolean;
        data: {
          results: Array<{
            file: string;
            relativePath: string;
            line: number;
            column: number;
            content: string;
            matchStart: number;
            matchEnd: number;
          }>;
          totalMatches: number;
          fileCount: number;
          truncated: boolean;
        };
      }>(`/search?${params}`);
    },
  },

  // --- LSP ---
  lsp: {
    servers: () =>
      request<{
        ok: boolean;
        data: Array<{
          language: string;
          command: string;
          args: string[];
          available: boolean;
          installable: boolean;
          npmPackage?: string;
          systemInstallHint?: string;
        }>;
      }>('/lsp/servers'),
    install: (language: string) =>
      request<{ ok: boolean; error?: string }>('/lsp/install', {
        method: 'POST',
        body: JSON.stringify({ language }),
      }),
  },

  // --- Git ---
  git: {
    status: (path: string) =>
      request<{
        ok: boolean;
        data: {
          isRepo: boolean;
          files: Array<{ path: string; status: string; staged: boolean }>;
        };
      }>(`/git/status?path=${encodeURIComponent(path)}`),
    branch: (path: string) =>
      request<{ ok: boolean; data: { branch: string } }>(
        `/git/branch?path=${encodeURIComponent(path)}`,
      ),
  },
};
