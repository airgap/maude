// API base URL. In all modes (browser dev, Tauri desktop), the page is served
// from the same origin as the API, so we use relative paths.
export function getBaseUrl(): string {
  return '/api';
}

export function getWsBase(): string {
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3002';
  const wsProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${wsProtocol}://${host}/api`;
}

export function setServerPort(_port: number) {
  // No-op — kept for backwards compatibility
}

export function waitForServer(): Promise<void> {
  return Promise.resolve();
}

// Auth token storage
let _authToken: string | null = null;
export function setAuthToken(token: string | null) {
  _authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem('e-auth-token', token);
    else localStorage.removeItem('e-auth-token');
  }
}
export function getAuthToken(): string | null {
  if (_authToken) return _authToken;
  if (typeof localStorage !== 'undefined') {
    _authToken = localStorage.getItem('e-auth-token');
  }
  return _authToken;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, { ...opts, headers });
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
      workspacePath?: string;
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
    deleteMessage: (conversationId: string, messageId: string, deletePair = false) =>
      request<{ ok: boolean }>(
        `/conversations/${conversationId}/messages/${messageId}?deletePair=${deletePair}`,
        { method: 'DELETE' },
      ),
    editMessage: (conversationId: string, messageId: string) =>
      request<{ ok: boolean }>(`/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PUT',
      }),
    fork: (conversationId: string, messageId: string) =>
      request<{ ok: boolean; data: { id: string } }>(`/conversations/${conversationId}/fork`, {
        method: 'POST',
        body: JSON.stringify({ messageId }),
      }),
    /** Get stored compact summary for a conversation (null if not yet generated). */
    summary: (id: string) =>
      request<{ ok: boolean; data: { id: string; title: string; summary: string | null } }>(
        `/conversations/${id}/summary`,
      ),
    /** Generate and store a compact summary for a conversation (idempotent). */
    summarize: (id: string) =>
      request<{ ok: boolean; data: { summary: string | null; cached: boolean } }>(
        `/conversations/${id}/summarize`,
        { method: 'POST' },
      ),
  },

  // --- Streaming ---
  stream: {
    send: (
      conversationId: string,
      content: string,
      sessionId?: string | null,
      signal?: AbortSignal,
    ) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (sessionId) headers['X-Session-Id'] = sessionId;
      return fetch(`${getBaseUrl()}/stream/${conversationId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
        signal,
      });
    },
    cancel: (conversationId: string, sessionId: string) =>
      request(`/stream/${conversationId}/cancel`, {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId },
      }),
    sessions: () =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          conversationId: string;
          status: string;
          streamComplete: boolean;
          bufferedEvents: number;
        }>;
      }>('/stream/sessions'),
    reconnect: (sessionId: string, signal?: AbortSignal) => {
      const headers: Record<string, string> = {};
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return fetch(`${getBaseUrl()}/stream/reconnect/${sessionId}`, { headers, signal });
    },
    answerQuestion: (
      conversationId: string,
      sessionId: string,
      toolCallId: string,
      answers: Record<string, string>,
    ) =>
      request(`/stream/${conversationId}/answer`, {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId },
        body: JSON.stringify({ toolCallId, answers }),
      }),
    nudge: (conversationId: string, sessionId: string, content: string) =>
      request<{ ok: boolean; queued: boolean; messageId: string }>(
        `/stream/${conversationId}/nudge`,
        {
          method: 'POST',
          headers: { 'X-Session-Id': sessionId },
          body: JSON.stringify({ content }),
        },
      ),
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
    ollamaStatus: () =>
      request<{ ok: boolean; data: { available: boolean } }>('/settings/ollama/status'),
    ollamaModels: () =>
      request<{
        ok: boolean;
        data: Array<{ name: string; size: number; modified_at: string }>;
      }>('/settings/ollama/models'),
    openaiModels: () =>
      request<{ ok: boolean; data: Array<{ id: string; name: string }> }>(
        '/settings/openai/models',
      ),
    geminiModels: () =>
      request<{ ok: boolean; data: Array<{ id: string; name: string }> }>(
        '/settings/gemini/models',
      ),
    setApiKey: (provider: string, apiKey: string) =>
      request<{ ok: boolean }>('/settings/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider, apiKey }),
      }),
    apiKeysStatus: () =>
      request<{ ok: boolean; data: Record<string, boolean> }>('/settings/api-keys/status'),
    getBudget: () =>
      request<{ ok: boolean; data: { budgetUsd: number | null } }>('/settings/budget'),
    setBudget: (budgetUsd: number | null) =>
      request<{ ok: boolean }>('/settings/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd }),
      }),
    // Permission rules
    getPermissionRules: (opts?: {
      scope?: string;
      workspacePath?: string;
      conversationId?: string;
    }) => {
      const params = new URLSearchParams();
      if (opts?.scope) params.set('scope', opts.scope);
      if (opts?.workspacePath) params.set('workspacePath', opts.workspacePath);
      if (opts?.conversationId) params.set('conversationId', opts.conversationId);
      const q = params.toString();
      return request<{
        ok: boolean;
        data: Array<import('@e/shared').PermissionRule>;
      }>(`/settings/permission-rules${q ? '?' + q : ''}`);
    },
    createPermissionRule: (body: {
      type: 'allow' | 'deny' | 'ask';
      tool: string;
      pattern?: string;
      scope: 'session' | 'project' | 'global';
      workspacePath?: string;
      conversationId?: string;
    }) =>
      request<{ ok: boolean; data: import('@e/shared').PermissionRule }>(
        '/settings/permission-rules',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    updatePermissionRule: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: import('@e/shared').PermissionRule }>(
        `/settings/permission-rules/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      ),
    deletePermissionRule: (id: string) =>
      request<{ ok: boolean }>(`/settings/permission-rules/${id}`, { method: 'DELETE' }),
    getPermissionPresets: () =>
      request<{
        ok: boolean;
        data: Array<import('@e/shared').PermissionRulePreset>;
      }>('/settings/permission-rules/presets'),
    applyPermissionPreset: (body: {
      presetId: string;
      scope: 'session' | 'project' | 'global';
      workspacePath?: string;
      conversationId?: string;
    }) =>
      request<{
        ok: boolean;
        data: Array<import('@e/shared').PermissionRule>;
      }>('/settings/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify(body),
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
    discover: () =>
      request<{
        ok: boolean;
        data: Array<{
          source: string;
          configPath: string;
          servers: Array<{
            name: string;
            command?: string;
            args?: string[];
            url?: string;
            env?: Record<string, string>;
            transport: string;
          }>;
        }>;
      }>('/mcp/discover'),
    importServers: (servers: any[]) =>
      request<{ ok: boolean; data: { imported: number } }>('/mcp/import', {
        method: 'POST',
        body: JSON.stringify({ servers }),
      }),
  },

  // --- Memory ---
  memory: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/memory${q}`);
    },
    update: (path: string, content: string) =>
      request<{ ok: boolean }>('/memory', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
  },

  // --- Skills Registry (agentskills.io) ---
  skillsRegistry: {
    browse: () =>
      request<{
        ok: boolean;
        data: Array<{
          name: string;
          description: string;
          compatibility?: string;
          license?: string;
          metadata?: Record<string, string>;
        }>;
      }>('/skills-registry/browse'),
    getSkill: (name: string) =>
      request<{
        ok: boolean;
        data: {
          name: string;
          description: string;
          content: string;
          compatibility?: string;
          license?: string;
        };
      }>(`/skills-registry/skill/${encodeURIComponent(name)}`),
    install: (skillName: string, workspacePath?: string) =>
      request<{ ok: boolean; data: { path: string } }>('/skills-registry/install', {
        method: 'POST',
        body: JSON.stringify({ skillName, workspacePath }),
      }),
    installed: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: string[] }>(`/skills-registry/installed${q}`);
    },
  },

  // --- Rules ---
  rules: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{
        ok: boolean;
        data: Array<{
          path: string;
          name: string;
          content: string;
          type: string;
          mode: string;
          lastModified: number;
        }>;
      }>(`/rules${q}`);
    },
    create: (workspacePath: string, name: string, content?: string) =>
      request<{ ok: boolean; data: { path: string; name: string } }>('/rules', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, name, content }),
      }),
    updateContent: (path: string, content: string) =>
      request<{ ok: boolean }>('/rules/content', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
    setMode: (workspacePath: string, filePath: string, mode: string) =>
      request<{ ok: boolean }>('/rules/mode', {
        method: 'PATCH',
        body: JSON.stringify({ workspacePath, filePath, mode }),
      }),
    getActive: (workspacePath: string) => {
      const q = `?workspacePath=${encodeURIComponent(workspacePath)}`;
      return request<{ ok: boolean; data: { context: string; count: number } }>(
        `/rules/active${q}`,
      );
    },
    getByName: (name: string, workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{
        ok: boolean;
        data: { path: string; name: string; content: string };
      }>(`/rules/by-name/${encodeURIComponent(name)}${q}`);
    },
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
      request<{ ok: boolean; data: import('@e/shared').EditorConfigProps }>(
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
    verify: (path: string, workspacePath?: string) =>
      request<{
        ok: boolean;
        data: {
          filePath: string;
          passed: boolean;
          issues: Array<{ severity: string; line?: number; message: string; rule?: string }>;
          tool: string;
          duration: number;
        };
      }>('/files/verify', {
        method: 'POST',
        body: JSON.stringify({ path, workspacePath }),
      }),
  },

  // --- Workspaces ---
  workspaces: {
    list: () => request<{ ok: boolean; data: any[] }>('/workspaces'),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/workspaces/${id}`),
    create: (body: { name: string; path: string; settings?: any }) =>
      request<{ ok: boolean; data: { id: string } }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/workspaces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/workspaces/${id}`, { method: 'DELETE' }),
    open: (id: string) => request<{ ok: boolean }>(`/workspaces/${id}/open`, { method: 'POST' }),
    getSandbox: (path: string) =>
      request<{
        ok: boolean;
        data: { enabled: boolean; allowedPaths: string[]; blockedCommands: string[] };
      }>(`/workspaces/sandbox/config?path=${encodeURIComponent(path)}`),
    updateSandbox: (body: {
      workspacePath: string;
      enabled?: boolean;
      allowedPaths?: string[];
      blockedCommands?: string[];
    }) =>
      request<{ ok: boolean }>('/workspaces/sandbox/config', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
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
          binaryDownload?: Record<string, string>;
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
    snapshot: (path: string, conversationId?: string, reason?: string, messageId?: string) =>
      request<{
        ok: boolean;
        data: { id: string; headSha: string; stashSha: string | null; hasChanges: boolean };
      }>('/git/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path, conversationId, reason, messageId }),
      }),
    snapshots: (path: string) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          workspacePath: string;
          conversationId: string | null;
          headSha: string;
          stashSha: string | null;
          reason: string;
          hasChanges: boolean;
          messageId: string | null;
          createdAt: number;
        }>;
      }>(`/git/snapshots?path=${encodeURIComponent(path)}`),
    snapshotByMessage: (messageId: string) =>
      request<{
        ok: boolean;
        data: {
          id: string;
          workspacePath: string;
          conversationId: string | null;
          headSha: string;
          stashSha: string | null;
          reason: string;
          hasChanges: boolean;
          messageId: string | null;
          createdAt: number;
        };
      }>(`/git/snapshot/by-message/${messageId}`),
    restoreSnapshot: (id: string) =>
      request<{ ok: boolean; data: { restored: boolean } }>(`/git/snapshot/${id}/restore`, {
        method: 'POST',
      }),
    diff: (path: string, file: string, staged: boolean) =>
      request<{ ok: boolean; data: { diff: string } }>(
        `/git/diff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}&staged=${staged}`,
      ),
  },

  // --- Workspace Memory ---
  workspaceMemory: {
    list: (workspacePath: string, category?: string) => {
      const params = new URLSearchParams({ workspacePath });
      if (category) params.set('category', category);
      return request<{ ok: boolean; data: any[] }>(`/workspace-memory?${params}`);
    },
    get: (id: string) => request<{ ok: boolean; data: any }>(`/workspace-memory/${id}`),
    create: (body: {
      workspacePath: string;
      category?: string;
      key: string;
      content: string;
      source?: string;
      confidence?: number;
    }) =>
      request<{ ok: boolean; data: { id: string } }>('/workspace-memory', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/workspace-memory/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/workspace-memory/${id}`, { method: 'DELETE' }),
    search: (workspacePath: string, q: string) => {
      const params = new URLSearchParams({ workspacePath, q });
      return request<{ ok: boolean; data: any[] }>(`/workspace-memory/search/query?${params}`);
    },
    extract: (workspacePath: string, messages: Array<{ role: string; content: string }>) =>
      request<{ ok: boolean; data: { extracted: number; created: number } }>(
        '/workspace-memory/extract',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath, messages }),
        },
      ),
    context: (workspacePath: string) => {
      const params = new URLSearchParams({ workspacePath });
      return request<{ ok: boolean; data: { context: string; count: number } }>(
        `/workspace-memory/context?${params}`,
      );
    },
  },

  // --- PRDs ---
  prds: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/prds${q}`);
    },
    get: (id: string) => request<{ ok: boolean; data: any }>(`/prds/${id}`),
    create: (body: any) =>
      request<{ ok: boolean; data: { id: string; storyIds: string[] } }>('/prds', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/prds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/prds/${id}`, { method: 'DELETE' }),
    addStory: (prdId: string, body: any) =>
      request<{ ok: boolean; data: { id: string } }>(`/prds/${prdId}/stories`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateStory: (prdId: string, storyId: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/prds/${prdId}/stories/${storyId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteStory: (prdId: string, storyId: string) =>
      request<{ ok: boolean }>(`/prds/${prdId}/stories/${storyId}`, { method: 'DELETE' }),
    import: (workspacePath: string, prdJson: any) =>
      request<{ ok: boolean; data: { id: string; storyIds: string[]; imported: number } }>(
        '/prds/import',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath, prdJson }),
        },
      ),
    export: (id: string) => request<{ ok: boolean; data: any }>(`/prds/${id}/export`),
    plan: (
      prdId: string,
      body: { mode: string; editMode: string; userPrompt?: string; model?: string },
    ) =>
      request<{
        ok: boolean;
        data: { conversationId: string; prdId: string; mode: string; editMode: string };
      }>(`/prds/${prdId}/plan`, { method: 'POST', body: JSON.stringify(body) }),
    generate: (prdId: string, body: { description: string; context?: string; count?: number }) =>
      request<{
        ok: boolean;
        data: {
          stories: Array<{
            title: string;
            description: string;
            acceptanceCriteria: string[];
            priority: 'critical' | 'high' | 'medium' | 'low';
          }>;
          prdId: string;
        };
      }>(`/prds/${prdId}/generate`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    acceptGenerated: (
      prdId: string,
      stories: Array<{
        title: string;
        description: string;
        acceptanceCriteria: string[];
        priority: 'critical' | 'high' | 'medium' | 'low';
      }>,
    ) =>
      request<{ ok: boolean; data: { storyIds: string[]; accepted: number } }>(
        `/prds/${prdId}/generate/accept`,
        { method: 'POST', body: JSON.stringify({ stories }) },
      ),
    refineStory: (
      prdId: string,
      storyId: string,
      answers?: Array<{ questionId: string; answer: string }>,
    ) =>
      request<{
        ok: boolean;
        data: {
          storyId: string;
          questions: Array<{
            id: string;
            question: string;
            context: string;
            suggestedAnswers?: string[];
          }>;
          qualityScore: number;
          qualityExplanation: string;
          meetsThreshold: boolean;
          updatedStory?: {
            title: string;
            description: string;
            acceptanceCriteria: string[];
            priority: 'critical' | 'high' | 'medium' | 'low';
          };
          improvements?: string[];
        };
      }>(`/prds/${prdId}/stories/${storyId}/refine`, {
        method: 'POST',
        body: JSON.stringify({ storyId, answers }),
      }),
    // --- Dependencies ---
    getDependencyGraph: (prdId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`),
    addDependency: (prdId: string, fromStoryId: string, toStoryId: string, reason?: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`, {
        method: 'POST',
        body: JSON.stringify({ fromStoryId, toStoryId, reason }),
      }),
    removeDependency: (prdId: string, fromStoryId: string, toStoryId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`, {
        method: 'DELETE',
        body: JSON.stringify({ fromStoryId, toStoryId }),
      }),
    editDependency: (prdId: string, fromStoryId: string, toStoryId: string, reason: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`, {
        method: 'PATCH',
        body: JSON.stringify({ fromStoryId, toStoryId, reason }),
      }),
    analyzeDependencies: (prdId: string, replaceAutoDetected?: boolean) =>
      request<{
        ok: boolean;
        data: import('@e/shared').AnalyzeDependenciesResponse;
      }>(`/prds/${prdId}/dependencies/analyze`, {
        method: 'POST',
        body: JSON.stringify({ replaceAutoDetected }),
      }),
    validateSprint: (prdId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').SprintValidation;
      }>(`/prds/${prdId}/dependencies/validate`),
    // --- Acceptance Criteria Validation ---
    validateCriteria: (
      prdId: string,
      storyId: string,
      criteria: string[],
      storyTitle?: string,
      storyDescription?: string,
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').ValidateACResponse;
      }>(`/prds/${prdId}/stories/${storyId}/validate-criteria`, {
        method: 'POST',
        body: JSON.stringify({ storyId, criteria, storyTitle, storyDescription }),
      }),
    // --- Story Estimation ---
    estimateStory: (prdId: string, storyId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').EstimateStoryResponse;
      }>(`/prds/${prdId}/stories/${storyId}/estimate`, {
        method: 'POST',
        body: JSON.stringify({ storyId }),
      }),
    saveManualEstimate: (
      prdId: string,
      storyId: string,
      body: { size: string; storyPoints: number; reasoning?: string },
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').EstimateStoryResponse;
      }>(`/prds/${prdId}/stories/${storyId}/estimate`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    estimatePrd: (prdId: string, reEstimate?: boolean) =>
      request<{
        ok: boolean;
        data: import('@e/shared').EstimatePrdResponse;
      }>(`/prds/${prdId}/estimate`, {
        method: 'POST',
        body: JSON.stringify({ reEstimate }),
      }),
    // --- PRD Completeness Analysis ---
    analyzeCompleteness: (prdId: string, sections?: string[]) =>
      request<{
        ok: boolean;
        data: import('@e/shared').AnalyzePrdCompletenessResponse;
      }>(`/prds/${prdId}/completeness`, {
        method: 'POST',
        body: JSON.stringify({ sections }),
      }),
    // --- Sprint Plan Recommendations ---
    generateSprintPlan: (prdId: string, capacity: number, capacityMode?: 'points' | 'count') =>
      request<{
        ok: boolean;
        data: import('@e/shared').SprintPlanResponse;
      }>(`/prds/${prdId}/sprint-plan`, {
        method: 'POST',
        body: JSON.stringify({ capacity, capacityMode }),
      }),
    saveAdjustedSprintPlan: (prdId: string, plan: import('@e/shared').SprintPlanResponse) =>
      request<{
        ok: boolean;
        data: import('@e/shared').SprintPlanResponse;
      }>(`/prds/${prdId}/sprint-plan`, {
        method: 'PUT',
        body: JSON.stringify(plan),
      }),
    // --- Story Templates ---
    listTemplates: (category?: string) => {
      const q = category ? `?category=${encodeURIComponent(category)}` : '';
      return request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate[];
      }>(`/prds/templates${q}`);
    },
    getTemplate: (templateId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate;
      }>(`/prds/templates/${templateId}`),
    createTemplate: (body: import('@e/shared').CreateTemplateRequest) =>
      request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate;
      }>('/prds/templates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateTemplate: (
      templateId: string,
      body: Partial<import('@e/shared').CreateTemplateRequest>,
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate;
      }>(`/prds/templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteTemplate: (templateId: string) =>
      request<{ ok: boolean }>(`/prds/templates/${templateId}`, { method: 'DELETE' }),
    createStoryFromTemplate: (
      prdId: string,
      templateId: string,
      variables?: Record<string, string>,
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').CreateStoryFromTemplateResponse;
      }>(`/prds/${prdId}/stories/from-template`, {
        method: 'POST',
        body: JSON.stringify({ templateId, variables }),
      }),
    // --- Priority Recommendations ---
    recommendPriority: (prdId: string, storyId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').PriorityRecommendationResponse;
      }>(`/prds/${prdId}/stories/${storyId}/priority`, {
        method: 'POST',
        body: JSON.stringify({ storyId }),
      }),
    acceptPriority: (prdId: string, storyId: string, priority: string, accept: boolean) =>
      request<{ ok: boolean }>(`/prds/${prdId}/stories/${storyId}/priority`, {
        method: 'PUT',
        body: JSON.stringify({ priority, accept }),
      }),
    recommendAllPriorities: (prdId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').PriorityRecommendationBulkResponse;
      }>(`/prds/${prdId}/priorities`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),

    // --- Standalone Story Routes (prd_id = NULL) ---
    listStandaloneStories: (workspacePath: string) => {
      const q = `?workspacePath=${encodeURIComponent(workspacePath)}`;
      return request<{ ok: boolean; data: any[] }>(`/prds/stories${q}`);
    },
    listAllStories: (workspacePath: string) => {
      const q = `?workspacePath=${encodeURIComponent(workspacePath)}`;
      return request<{ ok: boolean; data: { standalone: any[]; byPrd: any[] } }>(
        `/prds/stories/all${q}`,
      );
    },
    createStandaloneStory: (body: {
      workspacePath: string;
      title: string;
      description?: string;
      acceptanceCriteria?: string[];
      priority?: string;
    }) =>
      request<{ ok: boolean; data: any }>('/prds/stories', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateStandaloneStory: (storyId: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/prds/stories/${storyId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteStandaloneStory: (storyId: string) =>
      request<{ ok: boolean }>(`/prds/stories/${storyId}`, { method: 'DELETE' }),
    estimateStandaloneStory: (storyId: string) =>
      request<{ ok: boolean; data: any }>(`/prds/stories/${storyId}/estimate`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    saveStandaloneEstimate: (
      storyId: string,
      body: { size: string; storyPoints: number; reasoning?: string },
    ) =>
      request<{ ok: boolean; data: any }>(`/prds/stories/${storyId}/estimate`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },

  // --- Loops ---
  loops: {
    start: (body: { prdId: string | null; workspacePath: string; config: any }) =>
      request<{ ok: boolean; data: { loopId: string } }>('/loops/start', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    pause: (id: string) => request<{ ok: boolean }>(`/loops/${id}/pause`, { method: 'POST' }),
    resume: (id: string) => request<{ ok: boolean }>(`/loops/${id}/resume`, { method: 'POST' }),
    cancel: (id: string) => request<{ ok: boolean }>(`/loops/${id}/cancel`, { method: 'POST' }),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/loops/${id}`),
    list: (status?: string) => {
      const q = status ? `?status=${status}` : '';
      return request<{ ok: boolean; data: any[] }>(`/loops${q}`);
    },
    log: (id: string) => request<{ ok: boolean; data: any[] }>(`/loops/${id}/log`),
  },

  // --- External Providers (Jira, Linear, Asana) ---
  external: {
    saveConfig: (config: {
      provider: string;
      apiKey: string;
      email?: string;
      baseUrl?: string;
      teamId?: string;
      workspaceGid?: string;
    }) =>
      request<{ ok: boolean }>('/external/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
    getConfigStatus: (provider: string) =>
      request<{
        ok: boolean;
        data: {
          configured: boolean;
          provider: string;
          baseUrl?: string;
          email?: string;
          teamId?: string;
          workspaceGid?: string;
        };
      }>(`/external/config/${provider}`),
    testConnection: (provider: string) =>
      request<{ ok: boolean; data: { connected: boolean; error?: string } }>(
        `/external/test/${provider}`,
        { method: 'POST' },
      ),
    listProjects: (provider: string) =>
      request<{ ok: boolean; data: any[] }>(`/external/projects/${provider}`),
    listIssues: (provider: string, projectKey: string, status?: string) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const q = params.toString();
      return request<{ ok: boolean; data: any[] }>(
        `/external/issues/${provider}/${encodeURIComponent(projectKey)}${q ? '?' + q : ''}`,
      );
    },
    importIssues: (body: {
      provider: string;
      projectKey: string;
      workspacePath: string;
      issueIds?: string[];
      prdId?: string;
    }) =>
      request<{
        ok: boolean;
        data: { imported: number; skipped: number; storyIds: string[]; errors: string[] };
      }>('/external/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    refreshStory: (storyId: string) =>
      request<{ ok: boolean; data: any }>(`/external/refresh/${storyId}`, { method: 'POST' }),
    refreshAll: (workspacePath: string) =>
      request<{ ok: boolean; data: { refreshed: number; total: number; errors: string[] } }>(
        '/external/refresh-all',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath }),
        },
      ),
    pushStatus: (body: {
      storyId: string;
      status: 'completed' | 'failed';
      commitSha?: string;
      prUrl?: string;
      comment?: string;
    }) =>
      request<{ ok: boolean }>('/external/push-status', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  // --- Auth ---
  auth: {
    status: () => request<{ ok: boolean; data: { enabled: boolean } }>('/auth/status'),
    register: (username: string, password: string, displayName?: string) =>
      request<{
        ok: boolean;
        data: { id: string; username: string; token: string; isAdmin: boolean };
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName }),
      }),
    login: (username: string, password: string) =>
      request<{
        ok: boolean;
        data: {
          id: string;
          username: string;
          displayName: string;
          isAdmin: boolean;
          token: string;
        };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    me: () =>
      request<{
        ok: boolean;
        data: { id: string; username: string; isAdmin: boolean };
      }>('/auth/me'),
    users: () => request<{ ok: boolean; data: any[] }>('/auth/users'),
  },
  // --- TODO Scanner ---
  scan: {
    scanTodos: (
      workspacePath: string,
      opts?: { extensions?: string[]; maxResults?: number; prdId?: string },
    ) =>
      request<{
        ok: boolean;
        data: {
          todos: Array<{
            id: string;
            file: string;
            relativePath: string;
            line: number;
            type: string;
            text: string;
            context: string[];
            suggestedTitle: string;
            suggestedDescription: string;
            priority: string;
          }>;
          total: number;
        };
      }>('/scan/todos', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, ...opts }),
      }),
    importTodos: (body: {
      workspacePath: string;
      todos: Array<{
        file: string;
        line: number;
        type: string;
        text: string;
        suggestedTitle: string;
        suggestedDescription: string;
        priority: string;
      }>;
      prdId?: string;
    }) =>
      request<{ ok: boolean; data: { created: number; storyIds: string[] } }>(
        '/scan/todos/import',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    todoCount: (workspacePath: string) =>
      request<{ ok: boolean; data: { count: number; byType: Record<string, number> } }>(
        `/scan/todos/count?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
  },

  // --- Ambient Background Agent ---
  ambient: {
    startWatching: (workspacePath: string) =>
      request<{ ok: boolean }>('/ambient/watch', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    stopWatching: (workspacePath: string) =>
      request<{ ok: boolean }>(
        `/ambient/watch?workspacePath=${encodeURIComponent(workspacePath)}`,
        {
          method: 'DELETE',
        },
      ),
    getNotifications: (workspacePath: string) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          workspacePath: string;
          type: string;
          severity: string;
          title: string;
          message: string;
          file?: string;
          line?: number;
          suggestion?: string;
          createdAt: number;
          dismissed: boolean;
        }>;
      }>(`/ambient/notifications?workspacePath=${encodeURIComponent(workspacePath)}`),
    dismissNotification: (id: string) =>
      request<{ ok: boolean }>(`/ambient/notifications/${id}`, { method: 'DELETE' }),
    clearNotifications: (workspacePath: string) =>
      request<{ ok: boolean }>(
        `/ambient/notifications?workspacePath=${encodeURIComponent(workspacePath)}`,
        { method: 'DELETE' },
      ),
    status: (workspacePath: string) =>
      request<{ ok: boolean; data: { watching: boolean; notificationCount: number } }>(
        `/ambient/status?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
  },

  // --- Cost Dashboard ---
  costs: {
    summary: (opts?: { workspacePath?: string; since?: number; until?: number }) => {
      const params = new URLSearchParams();
      if (opts?.workspacePath) params.set('workspacePath', opts.workspacePath);
      if (opts?.since) params.set('since', String(opts.since));
      if (opts?.until) params.set('until', String(opts.until));
      const q = params.toString();
      return request<{
        ok: boolean;
        data: {
          totalCostUsd: number;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          conversationCount: number;
          byModel: Array<{ model: string; costUsd: number; tokens: number; conversations: number }>;
          byDay: Array<{ date: string; costUsd: number; tokens: number }>;
          topConversations: Array<{
            id: string;
            title: string;
            costUsd: number;
            tokens: number;
            model: string;
            updatedAt: number;
          }>;
        };
      }>(`/costs/summary${q ? '?' + q : ''}`);
    },
  },

  // --- Diff Parser ---
  diff: {
    parse: (input: string, workspacePath?: string) =>
      request<{ ok: boolean; data: any }>('/diff/parse', {
        method: 'POST',
        body: JSON.stringify({ input, workspacePath }),
      }),
  },

  // --- Session Replay ---
  replay: {
    getTimeline: (conversationId: string) =>
      request<{ ok: boolean; data: any }>(`/replay/${conversationId}`),
    getChanges: (conversationId: string) =>
      request<{ ok: boolean; data: any }>(`/replay/${conversationId}/changes`),
  },

  // --- Custom Tools ---
  customTools: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/custom-tools${q}`);
    },
    create: (body: {
      name: string;
      description: string;
      inputSchema: any;
      handlerType: string;
      handlerCommand: string;
      workspacePath?: string;
    }) =>
      request<{ ok: boolean; data: any }>('/custom-tools', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/custom-tools/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/custom-tools/${id}`, { method: 'DELETE' }),
    test: (id: string, input: Record<string, any>) =>
      request<{ ok: boolean; data: { output: string; exitCode: number; duration: number } }>(
        `/custom-tools/${id}/test`,
        { method: 'POST', body: JSON.stringify({ input }) },
      ),
  },

  // --- Live Pair Mode ---
  pair: {
    createRoom: (body: { conversationId: string; hostName: string }) =>
      request<{ ok: boolean; data: { roomId: string; shareUrl: string } }>('/pair/rooms', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getRoom: (roomId: string) => request<{ ok: boolean; data: any }>(`/pair/rooms/${roomId}`),
    joinRoom: (roomId: string, observerName: string) =>
      request<{ ok: boolean }>(`/pair/rooms/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({ observerName }),
      }),
    broadcast: (roomId: string, event: string, data: any) =>
      request<{ ok: boolean }>(`/pair/rooms/${roomId}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({ event, data }),
      }),
    closeRoom: (roomId: string) =>
      request<{ ok: boolean }>(`/pair/rooms/${roomId}`, { method: 'DELETE' }),
  },

  // --- Multi-Workspace Initiatives ---
  initiatives: {
    list: () => request<{ ok: boolean; data: any[] }>('/initiatives'),
    create: (body: {
      name: string;
      description?: string;
      workspacePaths?: string[];
      prdIds?: string[];
      color?: string;
    }) =>
      request<{ ok: boolean; data: any }>('/initiatives', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/initiatives/${id}`),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/initiatives/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/initiatives/${id}`, { method: 'DELETE' }),
    addWorkspace: (id: string, workspacePath: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    removeWorkspace: (id: string, workspacePath: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/workspaces`, {
        method: 'DELETE',
        body: JSON.stringify({ workspacePath }),
      }),
    addPrd: (id: string, prdId: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/prds`, {
        method: 'POST',
        body: JSON.stringify({ prdId }),
      }),
    removePrd: (id: string, prdId: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/prds`, {
        method: 'DELETE',
        body: JSON.stringify({ prdId }),
      }),
    getProgress: (id: string) => request<{ ok: boolean; data: any }>(`/initiatives/${id}/progress`),
  },

  // --- Agent Profiles ---
  profiles: {
    list: () => request<{ ok: boolean; data: import('@e/shared').AgentProfile[] }>('/profiles'),
    get: (id: string) =>
      request<{ ok: boolean; data: import('@e/shared').AgentProfile }>(`/profiles/${id}`),
    create: (body: import('@e/shared').AgentProfileCreateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentProfile }>('/profiles', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: import('@e/shared').AgentProfileUpdateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentProfile }>(`/profiles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/profiles/${id}`, { method: 'DELETE' }),
  },

  // --- Daily Digest ---
  digest: {
    today: (workspacePath?: string, date?: string) => {
      const params = new URLSearchParams();
      if (workspacePath) params.set('workspacePath', workspacePath);
      if (date) params.set('date', date);
      return request<{ ok: boolean; data: any }>(`/digest/today?${params}`);
    },
    week: (workspacePath?: string) => {
      const params = new URLSearchParams();
      if (workspacePath) params.set('workspacePath', workspacePath);
      return request<{ ok: boolean; data: any[] }>(`/digest/week?${params}`);
    },
  },

  // --- Manager View ---
  manager: {
    overview: () =>
      request<{
        ok: boolean;
        data: {
          workspaces: Array<{
            id: string;
            name: string;
            path: string;
            agentStatus: 'idle' | 'running' | 'waiting';
            activeLoops: any[];
            activeSessions: any[];
            pendingApprovals: any[];
            lastOpened: number;
          }>;
          pendingApprovals: Array<{
            sessionId: string;
            conversationId: string;
            conversationTitle: string;
            workspacePath: string | null;
            toolCallId: string;
            toolName: string;
            description: string;
          }>;
          inProgressStories: Array<{
            id: string;
            title: string;
            status: string;
            workspace_path: string;
            updated_at: number;
            prd_id: string | null;
            conversation_id: string | null;
            prd_name: string | null;
          }>;
          completedStories: Array<{
            id: string;
            title: string;
            status: string;
            workspace_path: string;
            updated_at: number;
            prd_id: string | null;
            prd_name: string | null;
          }>;
          summary: {
            totalWorkspaces: number;
            totalPendingApprovals: number;
            totalRunningAgents: number;
            totalActiveLoops: number;
            totalCompletedToday: number;
          };
        };
      }>('/manager/overview'),
  },

  // --- Artifacts ---
  artifacts: {
    list: (conversationId: string) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact[] }>(
        `/artifacts?conversationId=${encodeURIComponent(conversationId)}`,
      ),
    get: (id: string) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>(`/artifacts/${id}`),
    create: (body: import('@e/shared').ArtifactCreateInput) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>('/artifacts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: import('@e/shared').ArtifactUpdateInput) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>(`/artifacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/artifacts/${id}`, { method: 'DELETE' }),
    pin: (id: string, pinned: boolean) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>(`/artifacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned }),
      }),
  },

  // --- Agent Notes ---
  agentNotes: {
    list: (workspacePath: string, opts?: { status?: string; category?: string }) => {
      const params = new URLSearchParams({ workspacePath });
      if (opts?.status) params.set('status', opts.status);
      if (opts?.category) params.set('category', opts.category);
      return request<{ ok: boolean; data: import('@e/shared').AgentNote[] }>(
        `/agent-notes?${params}`,
      );
    },
    get: (id: string) =>
      request<{ ok: boolean; data: import('@e/shared').AgentNote }>(`/agent-notes/${id}`),
    create: (body: import('@e/shared').AgentNoteCreateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentNote }>('/agent-notes', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: import('@e/shared').AgentNoteUpdateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentNote }>(`/agent-notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/agent-notes/${id}`, { method: 'DELETE' }),
    markRead: (workspacePath: string) =>
      request<{ ok: boolean; data: { updated: number } }>('/agent-notes/mark-read', {
        method: 'PATCH',
        body: JSON.stringify({ workspacePath }),
      }),
    unreadCount: (workspacePath: string) =>
      request<{ ok: boolean; data: { count: number } }>(
        `/agent-notes/unread-count?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
  },
};
