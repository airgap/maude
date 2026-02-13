/**
 * LSP client store — manages WebSocket connections to language servers,
 * JSON-RPC transport, and document synchronization.
 */

import { api } from '$lib/api/client';

interface LspServerInfo {
  language: string;
  command: string;
  args: string[];
  available: boolean;
  installable: boolean;
  npmPackage?: string;
  systemInstallHint?: string;
}

const WS_BASE =
  typeof window !== 'undefined' && (window as any).__TAURI__
    ? 'ws://localhost:3002/api/lsp'
    : `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost:3002'}/api/lsp`;

interface LspConnection {
  ws: WebSocket;
  capabilities: Record<string, any>;
  status: 'connecting' | 'ready' | 'error';
  triggerCharacters: string[];
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  method: string;
}

function createLspStore() {
  let connections = $state<Map<string, LspConnection>>(new Map());
  let pendingRequests = new Map<number, PendingRequest>();
  let notificationHandlers = new Map<string, Array<(params: any) => void>>();
  let nextId = 1;
  // Track opened document versions per URI
  let docVersions = new Map<string, number>();

  // Server info cache
  let serverInfo = $state<LspServerInfo[]>([]);
  let installing = $state<Set<string>>(new Set());
  let dismissed = $state<Set<string>>(new Set());

  function getConnection(language: string): LspConnection | undefined {
    return connections.get(language);
  }

  function setConnection(language: string, conn: LspConnection) {
    const next = new Map(connections);
    next.set(language, conn);
    connections = next;
  }

  function removeConnection(language: string) {
    const next = new Map(connections);
    next.delete(language);
    connections = next;
  }

  function sendRpc(ws: WebSocket, msg: Record<string, any>) {
    ws.send(JSON.stringify(msg));
  }

  function handleMessage(language: string, data: any) {
    // Response to a request
    if ('id' in data && data.id !== null) {
      const pending = pendingRequests.get(data.id);
      if (pending) {
        pendingRequests.delete(data.id);
        if (data.error) {
          pending.reject(new Error(data.error.message || JSON.stringify(data.error)));
        } else {
          pending.resolve(data.result);
        }
      }
      return;
    }

    // Notification from server
    if ('method' in data) {
      const handlers = notificationHandlers.get(data.method);
      if (handlers) {
        for (const h of handlers) {
          try {
            h(data.params);
          } catch {}
        }
      }
    }
  }

  function fileUri(path: string): string {
    // Ensure it's a proper file:// URI
    if (path.startsWith('file://')) return path;
    return `file://${path.startsWith('/') ? '' : '/'}${path}`;
  }

  return {
    get connections() {
      return connections;
    },

    /**
     * Connect to a language server for the given language.
     */
    async connect(language: string, rootPath: string): Promise<void> {
      if (connections.has(language)) return;

      return new Promise<void>((resolve, reject) => {
        const url = `${WS_BASE}/ws?language=${encodeURIComponent(language)}&rootPath=${encodeURIComponent(rootPath)}`;
        const ws = new WebSocket(url);

        const conn: LspConnection = {
          ws,
          capabilities: {},
          status: 'connecting',
          triggerCharacters: [],
        };
        setConnection(language, conn);

        ws.onopen = () => {
          // Send initialize request
          const id = nextId++;
          const initParams = {
            processId: null,
            rootUri: fileUri(rootPath),
            capabilities: {
              textDocument: {
                completion: {
                  completionItem: {
                    snippetSupport: true,
                    labelDetailsSupport: true,
                  },
                },
                hover: { contentFormat: ['markdown', 'plaintext'] },
                publishDiagnostics: { relatedInformation: true },
                definition: {},
                synchronization: {
                  didSave: true,
                  willSave: false,
                  willSaveWaitUntil: false,
                  dynamicRegistration: false,
                },
              },
              workspace: {
                workspaceFolders: true,
              },
            },
            workspaceFolders: [
              { uri: fileUri(rootPath), name: rootPath.split('/').pop() || 'workspace' },
            ],
          };

          sendRpc(ws, { jsonrpc: '2.0', id, method: 'initialize', params: initParams });

          pendingRequests.set(id, {
            method: 'initialize',
            resolve: (result: any) => {
              conn.capabilities = result.capabilities || {};
              conn.triggerCharacters = result.capabilities?.completionProvider
                ?.triggerCharacters || ['.', '('];
              conn.status = 'ready';
              setConnection(language, { ...conn });

              // Send initialized notification
              sendRpc(ws, { jsonrpc: '2.0', method: 'initialized', params: {} });
              resolve();
            },
            reject: (err: any) => {
              conn.status = 'error';
              setConnection(language, { ...conn });
              reject(err);
            },
          });
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(typeof event.data === 'string' ? event.data : '');
            handleMessage(language, data);
          } catch {}
        };

        ws.onerror = () => {
          conn.status = 'error';
          setConnection(language, { ...conn });
          reject(new Error(`LSP WebSocket error for ${language}`));
        };

        ws.onclose = () => {
          removeConnection(language);
        };
      });
    },

    /**
     * Connect if not already connected.
     */
    async ensureConnection(language: string, rootPath: string): Promise<void> {
      const conn = getConnection(language);
      if (conn && conn.status !== 'error') return;
      try {
        await this.connect(language, rootPath);
      } catch {
        // Connection failed — non-fatal
      }
    },

    /**
     * Send a JSON-RPC request and return the result.
     */
    request(language: string, method: string, params: any): Promise<any> {
      const conn = getConnection(language);
      if (!conn || conn.status !== 'ready') {
        return Promise.reject(new Error(`LSP not connected for ${language}`));
      }

      return new Promise((resolve, reject) => {
        const id = nextId++;
        sendRpc(conn.ws, { jsonrpc: '2.0', id, method, params });
        pendingRequests.set(id, { resolve, reject, method });

        // Timeout after 10s
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(`LSP request timed out: ${method}`));
          }
        }, 10_000);
      });
    },

    /**
     * Send a JSON-RPC notification (no response expected).
     */
    notify(language: string, method: string, params: any) {
      const conn = getConnection(language);
      if (!conn || conn.status !== 'ready') return;
      sendRpc(conn.ws, { jsonrpc: '2.0', method, params });
    },

    /**
     * Register a handler for server notifications.
     */
    onNotification(method: string, handler: (params: any) => void): () => void {
      const handlers = notificationHandlers.get(method) || [];
      handlers.push(handler);
      notificationHandlers.set(method, handlers);

      // Return unsubscribe function
      return () => {
        const arr = notificationHandlers.get(method);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    },

    // --- Document sync helpers ---

    sendDidOpen(language: string, uri: string, content: string, languageId: string) {
      const fUri = fileUri(uri);
      docVersions.set(fUri, 1);
      this.notify(language, 'textDocument/didOpen', {
        textDocument: { uri: fUri, languageId, version: 1, text: content },
      });
    },

    sendDidChange(language: string, uri: string, content: string) {
      const fUri = fileUri(uri);
      const version = (docVersions.get(fUri) || 0) + 1;
      docVersions.set(fUri, version);
      this.notify(language, 'textDocument/didChange', {
        textDocument: { uri: fUri, version },
        contentChanges: [{ text: content }],
      });
    },

    sendDidClose(language: string, uri: string) {
      const fUri = fileUri(uri);
      docVersions.delete(fUri);
      this.notify(language, 'textDocument/didClose', {
        textDocument: { uri: fUri },
      });
    },

    /**
     * Gracefully disconnect a language server.
     */
    disconnect(language: string) {
      const conn = getConnection(language);
      if (!conn) return;
      try {
        sendRpc(conn.ws, { jsonrpc: '2.0', id: nextId++, method: 'shutdown', params: null });
        setTimeout(() => {
          try {
            sendRpc(conn.ws, { jsonrpc: '2.0', method: 'exit' });
          } catch {}
          setTimeout(() => conn.ws.close(), 200);
        }, 300);
      } catch {
        conn.ws.close();
      }
      removeConnection(language);
    },

    /**
     * Get the current connection status for a language.
     */
    getStatus(language: string): 'connecting' | 'ready' | 'error' | 'disconnected' {
      const conn = getConnection(language);
      return conn?.status ?? 'disconnected';
    },

    /**
     * Whether a language server is connected and ready.
     */
    isConnected(language: string): boolean {
      return getConnection(language)?.status === 'ready';
    },

    /**
     * Get trigger characters for completions from server capabilities.
     */
    getTriggerCharacters(language: string): string[] {
      return getConnection(language)?.triggerCharacters ?? ['.'];
    },

    // --- Server info & install flow ---

    get serverInfo() {
      return serverInfo;
    },

    /**
     * Fetch and cache server availability info from the backend.
     */
    async loadServerInfo(): Promise<void> {
      try {
        const res = await api.lsp.servers();
        serverInfo = res.data;
      } catch {
        // Non-fatal
      }
    },

    /**
     * Get cached server info for a specific language.
     */
    getServerInfo(language: string): LspServerInfo | undefined {
      return serverInfo.find((s) => s.language === language);
    },

    /**
     * Whether a language server is currently being installed.
     */
    isInstalling(language: string): boolean {
      return installing.has(language);
    },

    /**
     * Whether the user dismissed the install prompt for a language.
     */
    isDismissed(language: string): boolean {
      return dismissed.has(language);
    },

    /**
     * Dismiss the install prompt for a language (session-only).
     */
    dismissInstall(language: string) {
      dismissed = new Set([...dismissed, language]);
    },

    /**
     * Install an npm-based language server, then auto-connect on success.
     */
    async installServer(language: string, rootPath: string): Promise<void> {
      if (installing.has(language)) return;
      installing = new Set([...installing, language]);

      try {
        const res = await api.lsp.install(language);
        if (res.ok) {
          // Refresh server info to pick up the new install
          await this.loadServerInfo();
          // Auto-connect after successful install
          await this.ensureConnection(language, rootPath);
        }
      } catch {
        // Install failed — non-fatal
      } finally {
        const next = new Set(installing);
        next.delete(language);
        installing = next;
      }
    },
  };
}

export const lspStore = createLspStore();
