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
    snapshot: (path: string, conversationId?: string, reason?: string) =>
      request<{
        ok: boolean;
        data: { id: string; headSha: string; stashSha: string | null; hasChanges: boolean };
      }>('/git/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path, conversationId, reason }),
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
          createdAt: number;
        }>;
      }>(`/git/snapshots?path=${encodeURIComponent(path)}`),
    restoreSnapshot: (id: string) =>
      request<{ ok: boolean; data: { restored: boolean } }>(`/git/snapshot/${id}/restore`, {
        method: 'POST',
      }),
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
  },

  // --- Loops ---
  loops: {
    start: (body: { prdId: string; workspacePath: string; config: any }) =>
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
};
