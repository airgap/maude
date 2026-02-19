/**
 * TerminalConnectionManager — imperative service (not a store) that owns all
 * WebSocket connections and xterm.js Terminal instances.
 *
 * Terminal instances persist in memory across tab switches via
 * detachFromContainer / attachToContainer (moves the DOM node without
 * recreating the Terminal).
 *
 * Addons loaded per terminal:
 *   - @xterm/addon-search   (full-text search)
 *   - @xterm/addon-web-links (clickable URLs)
 *   - @xterm/addon-unicode11 (emoji & wide chars)
 *   - @xterm/addon-clipboard (OSC 52 clipboard)
 *   - @xterm/addon-webgl    (WebGL renderer, canvas fallback)
 *   - @xterm/addon-fit      (auto-fit to container)
 *
 * Binary-prefix protocol:
 *   0x00 — raw PTY data (default)
 *   0x01 — resize (ASCII "cols,rows")
 *   0x02 — JSON control message → parsed and emitted as typed events
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { getBaseUrl, getWsBase, getAuthToken } from '$lib/api/client';
import type {
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalControlMessage,
  TerminalSessionMeta,
  ShellProfile,
  TerminalPreferences,
} from '@e/shared';
import { TERMINAL_PROTOCOL, DEFAULT_TERMINAL_PREFERENCES } from '@e/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Search options forwarded to the SearchAddon (re-exported for convenience) */
export type TerminalSearchOptions = ISearchOptions;

/** Possible event types emitted when a 0x02 control message arrives. */
export type TerminalControlEventType = TerminalControlMessage['type'];

/** A typed listener for control messages */
export type TerminalControlListener = (msg: TerminalControlMessage) => void;

/** Internal bookkeeping for a single terminal connection */
interface TerminalConnection {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  ws: WebSocket | null;
  /** The DOM element the terminal is currently mounted to, or null if detached */
  container: HTMLElement | null;
  /** ResizeObserver for auto-fit when the container resizes */
  resizeObserver: ResizeObserver | null;
  /** Buffer messages received before terminal is ready */
  messageBuffer: string[];
  /** Whether the terminal has rendered its first frame */
  ready: boolean;
  readyTimeout: ReturnType<typeof setTimeout> | null;
  /** Per-session control message listeners */
  controlListeners: Set<TerminalControlListener>;
  /** WebGL addon instance, if loaded */
  webglAddon: unknown | null;
  /** Whether WebSocket has successfully connected at least once */
  hasConnected: boolean;
}

/** Fallback theme colours (used when CSS custom properties aren't available) */
const FALLBACK_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#00b4ff',
  selectionBackground: 'rgba(0, 180, 255, 0.3)',
  black: '#0d1117',
  red: '#ff3344',
  green: '#00ff88',
  yellow: '#ffaa00',
  blue: '#00b4ff',
  magenta: '#f778ba',
  cyan: '#56d4dd',
  white: '#c9d1d9',
  brightBlack: '#6e7681',
  brightRed: '#ff6b7a',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#76e3ea',
  brightWhite: '#f0f6fc',
};

/**
 * Derive terminal theme from CSS custom properties.
 * Falls back to FALLBACK_THEME values when properties are not set.
 */
export function getThemeFromCSS(): typeof FALLBACK_THEME {
  if (typeof document === 'undefined') return { ...FALLBACK_THEME };

  const style = getComputedStyle(document.documentElement);
  const get = (prop: string, fallback: string): string => {
    const val = style.getPropertyValue(prop).trim();
    return val || fallback;
  };

  return {
    background: get('--bg-primary', FALLBACK_THEME.background),
    foreground: get('--text-primary', FALLBACK_THEME.foreground),
    cursor: get('--accent-primary', FALLBACK_THEME.cursor),
    selectionBackground: get('--bg-selection', FALLBACK_THEME.selectionBackground),
    black: get('--bg-primary', FALLBACK_THEME.black),
    red: get('--accent-error', FALLBACK_THEME.red),
    green: get('--accent-secondary', FALLBACK_THEME.green),
    yellow: get('--accent-warning', FALLBACK_THEME.yellow),
    blue: get('--accent-primary', FALLBACK_THEME.blue),
    magenta: get('--text-link', FALLBACK_THEME.magenta),
    cyan: get('--accent-info', FALLBACK_THEME.cyan),
    white: get('--text-primary', FALLBACK_THEME.white),
    brightBlack: get('--text-tertiary', FALLBACK_THEME.brightBlack),
    brightRed: FALLBACK_THEME.brightRed,
    brightGreen: FALLBACK_THEME.brightGreen,
    brightYellow: FALLBACK_THEME.brightYellow,
    brightBlue: FALLBACK_THEME.brightBlue,
    brightMagenta: FALLBACK_THEME.brightMagenta,
    brightCyan: FALLBACK_THEME.brightCyan,
    brightWhite: FALLBACK_THEME.brightWhite,
  };
}

// ---------------------------------------------------------------------------
// REST helpers (thin wrappers around fetch)
// ---------------------------------------------------------------------------

async function apiRequest<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${getBaseUrl()}${path}`, { ...opts, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// TerminalConnectionManager
// ---------------------------------------------------------------------------

export class TerminalConnectionManager {
  /** All active connections keyed by sessionId */
  private connections = new Map<string, TerminalConnection>();

  /** Global listeners for control messages from any session */
  private globalControlListeners = new Set<
    (sessionId: string, msg: TerminalControlMessage) => void
  >();

  /** User preferences (can be updated at runtime) */
  private prefs: TerminalPreferences = { ...DEFAULT_TERMINAL_PREFERENCES };

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create a new terminal session via REST, then open a WebSocket and create
   * the Terminal instance.  Returns the sessionId.
   */
  async createSession(
    profile?: Partial<ShellProfile & { cwd?: string; cols?: number; rows?: number }>,
  ): Promise<string> {
    // 1. Call REST to create session on the server
    const body: TerminalCreateRequest = {
      shell: profile?.shellPath,
      args: profile?.args,
      cwd: profile?.cwd,
      env: profile?.env,
      cols: profile?.cols ?? 80,
      rows: profile?.rows ?? 24,
    };

    const { data } = await apiRequest<{ ok: boolean; data: TerminalCreateResponse }>(
      '/terminal/sessions',
      { method: 'POST', body: JSON.stringify(body) },
    );

    const sessionId = data.sessionId;

    // 2. Create Terminal instance
    const terminal = this.createTerminalInstance();

    // 3. Create addons
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicode11Addon = new Unicode11Addon();
    const clipboardAddon = new ClipboardAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(clipboardAddon);

    // Activate unicode11 version
    terminal.unicode.activeVersion = '11';

    // 4. Build connection record
    const conn: TerminalConnection = {
      sessionId,
      terminal,
      fitAddon,
      searchAddon,
      ws: null,
      container: null,
      resizeObserver: null,
      messageBuffer: [],
      ready: false,
      readyTimeout: null,
      controlListeners: new Set(),
      webglAddon: null,
      hasConnected: false,
    };

    this.connections.set(sessionId, conn);

    // 5. Open WebSocket
    this.openWebSocket(conn);

    // 6. Wire terminal input → WebSocket
    terminal.onData((input) => {
      if (conn.ws?.readyState === WebSocket.OPEN) {
        conn.ws.send(input);
      }
    });

    terminal.onResize(({ cols, rows }) => {
      if (conn.ws?.readyState === WebSocket.OPEN) {
        conn.ws.send(`${String.fromCharCode(TERMINAL_PROTOCOL.RESIZE)}${cols},${rows}`);
      }
    });

    return sessionId;
  }

  /**
   * Mount the terminal into a DOM element.
   *
   * If the terminal was previously attached elsewhere it is moved, not
   * recreated.  If already attached to the same element this is a no-op.
   */
  attachToContainer(sessionId: string, el: HTMLElement): void {
    const conn = this.connections.get(sessionId);
    if (!conn) throw new Error(`No connection for session ${sessionId}`);

    // Already attached to this element — nothing to do
    if (conn.container === el) {
      conn.fitAddon.fit();
      return;
    }

    // Detach from previous container if any
    if (conn.container) {
      this.detachFromContainerInternal(conn);
    }

    conn.container = el;

    // xterm.js open() can only be called once, but we can move the DOM node.
    // If the terminal element already has a parent (was previously opened),
    // we simply reparent it.
    const xtermEl = (conn.terminal as any)._core?._renderService?._renderer?.dimensions
      ? conn.terminal.element
      : null;

    if (xtermEl?.parentElement) {
      // Terminal was previously opened — move the existing DOM subtree
      el.appendChild(xtermEl);
    } else {
      // First time opening — let xterm create its DOM
      conn.terminal.open(el);

      // Try loading WebGL addon (with canvas fallback)
      this.loadWebGLAddon(conn);
    }

    // Fit and observe size changes
    requestAnimationFrame(() => {
      conn.fitAddon.fit();
    });

    conn.resizeObserver = new ResizeObserver(() => {
      conn.fitAddon.fit();
    });
    conn.resizeObserver.observe(el);

    // Mark ready and flush buffer
    if (!conn.ready) {
      if (conn.readyTimeout) clearTimeout(conn.readyTimeout);
      conn.readyTimeout = setTimeout(() => {
        conn.ready = true;
        if (conn.messageBuffer.length > 0) {
          for (const msg of conn.messageBuffer) {
            conn.terminal.write(msg);
          }
          conn.messageBuffer.length = 0;
        }
      }, 100);
    }
  }

  /**
   * Unmount the terminal from its current DOM element, keeping the Terminal
   * instance alive in memory for later reattachment.
   */
  detachFromContainer(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    this.detachFromContainerInternal(conn);
  }

  /**
   * Destroy a session — closes the WebSocket, disposes the Terminal, and
   * removes all bookkeeping.
   */
  destroySession(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;

    // Clean up DOM
    this.detachFromContainerInternal(conn);

    // Clean up ready timeout
    if (conn.readyTimeout) clearTimeout(conn.readyTimeout);

    // Close WebSocket
    if (conn.ws) {
      conn.ws.onclose = null;
      conn.ws.onerror = null;
      conn.ws.onmessage = null;
      conn.ws.onopen = null;
      conn.ws.close();
      conn.ws = null;
    }

    // Dispose Terminal (and all addons)
    conn.terminal.dispose();

    // Clear listeners
    conn.controlListeners.clear();

    this.connections.delete(sessionId);
  }

  /**
   * Destroy all sessions and clean up.
   */
  destroyAll(): void {
    for (const sessionId of Array.from(this.connections.keys())) {
      this.destroySession(sessionId);
    }
  }

  // -----------------------------------------------------------------------
  // Session queries
  // -----------------------------------------------------------------------

  /** Returns all tracked session IDs */
  get sessionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /** Returns the number of active connections */
  get size(): number {
    return this.connections.size;
  }

  /** Check whether a session exists */
  has(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /** Get the Terminal instance for a session (useful for theming, etc.) */
  getTerminal(sessionId: string): Terminal | undefined {
    return this.connections.get(sessionId)?.terminal;
  }

  /** Fetch session list from server */
  async listRemoteSessions(): Promise<TerminalSessionMeta[]> {
    const { data } = await apiRequest<{ ok: boolean; data: TerminalSessionMeta[] }>(
      '/terminal/sessions',
    );
    return data;
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  /**
   * Search for text in a terminal's scrollback.
   * Returns `true` if a match was found.
   */
  search(sessionId: string, query: string, opts?: TerminalSearchOptions): boolean {
    const conn = this.connections.get(sessionId);
    if (!conn) return false;
    return conn.searchAddon.findNext(query, opts);
  }

  /** Find the previous match */
  searchPrevious(sessionId: string, query: string, opts?: TerminalSearchOptions): boolean {
    const conn = this.connections.get(sessionId);
    if (!conn) return false;
    return conn.searchAddon.findPrevious(query, opts);
  }

  /** Clear search decorations */
  clearSearch(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.searchAddon.clearDecorations();
  }

  // -----------------------------------------------------------------------
  // Control message events
  // -----------------------------------------------------------------------

  /**
   * Register a listener for control messages on a specific session.
   * Returns an unsubscribe function.
   */
  onControlMessage(sessionId: string, listener: TerminalControlListener): () => void {
    const conn = this.connections.get(sessionId);
    if (!conn) return () => {};
    conn.controlListeners.add(listener);
    return () => conn.controlListeners.delete(listener);
  }

  /**
   * Register a listener for control messages from *any* session.
   * Returns an unsubscribe function.
   */
  onAnyControlMessage(
    listener: (sessionId: string, msg: TerminalControlMessage) => void,
  ): () => void {
    this.globalControlListeners.add(listener);
    return () => this.globalControlListeners.delete(listener);
  }

  // -----------------------------------------------------------------------
  // Preferences
  // -----------------------------------------------------------------------

  /** Update terminal preferences (font, cursor, etc.) for all terminals */
  updatePreferences(prefs: Partial<TerminalPreferences>): void {
    Object.assign(this.prefs, prefs);
    for (const conn of this.connections.values()) {
      this.applyPreferences(conn);
    }
  }

  // -----------------------------------------------------------------------
  // Manual input / resize
  // -----------------------------------------------------------------------

  /** Write raw data to a session's WebSocket (e.g. paste) */
  write(sessionId: string, data: string): void {
    const conn = this.connections.get(sessionId);
    if (conn?.ws?.readyState === WebSocket.OPEN) {
      conn.ws.send(data);
    }
  }

  /** Manually trigger a fit (e.g. after programmatic layout change) */
  fit(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (conn?.container) {
      conn.fitAddon.fit();
    }
  }

  /** Focus the terminal */
  focus(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    conn?.terminal.focus();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Create a Terminal instance with the current preferences and CSS-derived theme */
  private createTerminalInstance(): Terminal {
    return new Terminal({
      cursorBlink: this.prefs.cursorBlink,
      cursorStyle: this.prefs.cursorStyle,
      fontSize: this.prefs.fontSize,
      fontFamily: this.prefs.fontFamily,
      fontWeight: this.prefs.fontWeight as any,
      lineHeight: this.prefs.lineHeight,
      scrollback: this.prefs.scrollback,
      allowProposedApi: true,
      theme: getThemeFromCSS(),
    });
  }

  /** Re-derive theme from CSS custom properties and apply to all terminals */
  reapplyTheme(): void {
    const theme = getThemeFromCSS();
    for (const conn of this.connections.values()) {
      conn.terminal.options.theme = theme;
    }
  }

  /** Apply current preferences to an existing terminal */
  private applyPreferences(conn: TerminalConnection): void {
    const t = conn.terminal;
    t.options.cursorBlink = this.prefs.cursorBlink;
    t.options.cursorStyle = this.prefs.cursorStyle;
    t.options.fontSize = this.prefs.fontSize;
    t.options.fontFamily = this.prefs.fontFamily;
    t.options.fontWeight = this.prefs.fontWeight as any;
    t.options.lineHeight = this.prefs.lineHeight;
    t.options.scrollback = this.prefs.scrollback;
  }

  /** Try to load the WebGL addon; fall back to canvas renderer on failure */
  private async loadWebGLAddon(conn: TerminalConnection): Promise<void> {
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      const addon = new WebglAddon();
      conn.terminal.loadAddon(addon);
      conn.webglAddon = addon;
    } catch {
      // WebGL not supported — canvas renderer is the built-in default
    }
  }

  /** Open a WebSocket for a connection */
  private openWebSocket(conn: TerminalConnection): void {
    const wsUrl = `${getWsBase()}/terminal/ws?sessionId=${encodeURIComponent(conn.sessionId)}`;
    const ws = new WebSocket(wsUrl);

    conn.ws = ws;

    ws.onopen = () => {
      conn.hasConnected = true;
      // Send initial size if terminal is already opened
      if (conn.container) {
        conn.fitAddon.fit();
        const { cols, rows } = conn.terminal;
        ws.send(`${String.fromCharCode(TERMINAL_PROTOCOL.RESIZE)}${cols},${rows}`);
      }
    };

    ws.onmessage = (evt) => {
      const raw: string = typeof evt.data === 'string' ? evt.data : '';

      // --- Binary-prefix protocol: 0x02 = control message ---
      if (raw.length > 0 && raw.charCodeAt(0) === TERMINAL_PROTOCOL.CONTROL) {
        const json = raw.slice(1);
        try {
          const msg = JSON.parse(json) as TerminalControlMessage;
          this.emitControlMessage(conn, msg);
        } catch {
          // Malformed control message — ignore
        }
        return;
      }

      // --- Normal PTY data ---
      if (conn.ready) {
        conn.terminal.write(raw);
      } else {
        conn.messageBuffer.push(raw);
      }
    };

    ws.onclose = () => {
      // Do not auto-destroy — the Terminal stays in memory for reattach
    };

    ws.onerror = () => {
      // Error will also trigger onclose
    };
  }

  /** Emit a control message to per-session and global listeners */
  private emitControlMessage(conn: TerminalConnection, msg: TerminalControlMessage): void {
    for (const listener of conn.controlListeners) {
      try {
        listener(msg);
      } catch {
        // Listener threw — swallow to avoid breaking the loop
      }
    }
    for (const listener of this.globalControlListeners) {
      try {
        listener(conn.sessionId, msg);
      } catch {
        // Swallow
      }
    }
  }

  /** Internal helper to detach a terminal from its container */
  private detachFromContainerInternal(conn: TerminalConnection): void {
    if (conn.resizeObserver) {
      conn.resizeObserver.disconnect();
      conn.resizeObserver = null;
    }

    // Move the xterm DOM element out of the container but keep it alive.
    // We reparent it to an off-screen holder so it isn't garbage-collected.
    const xtermEl = conn.terminal.element;
    if (xtermEl?.parentElement) {
      xtermEl.parentElement.removeChild(xtermEl);
    }

    conn.container = null;
  }
}

/**
 * Singleton instance.
 *
 * Import this from components / stores that need terminal connections:
 *
 *   import { terminalConnectionManager } from '$lib/services/terminal-connection';
 */
export const terminalConnectionManager = new TerminalConnectionManager();
