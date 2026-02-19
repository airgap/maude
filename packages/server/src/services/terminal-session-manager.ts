import { nanoid } from 'nanoid';
import type {
  TerminalSessionMeta,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalControlMessage,
  ShellInfo,
} from '@e/shared';
import { TERMINAL_PROTOCOL } from '@e/shared';
import { existsSync } from 'fs';
import { basename } from 'path';

// --- node-pty dynamic import ---

let pty: typeof import('node-pty') | null = null;
try {
  const modName = ['node', 'pty'].join('-');
  pty = require(modName);
} catch {
  console.warn('[terminal] node-pty not available — terminal feature disabled');
}

// --- Types ---

/** Minimal WebSocket-like interface for both standard WebSocket and Bun ServerWebSocket */
interface WsLike {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

interface TerminalSession {
  id: string;
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  pid: number;
  pty: import('node-pty').IPty;
  /** Ring buffer of recent output chunks for reconnect replay */
  scrollbackBuffer: string[];
  scrollbackBytes: number;
  createdAt: number;
  lastActivity: number;
  exitCode: number | null;
  exitSignal: number | null;
  /** All currently attached WebSocket clients */
  attachedWs: Set<WsLike>;
  /** Whether logging is enabled for this session */
  logging: boolean;
}

/** Maximum scrollback buffer size in bytes per session */
const MAX_SCROLLBACK_BYTES = 64 * 1024; // 64KB

/** GC interval: check for orphaned sessions every 5 minutes */
const GC_INTERVAL_MS = 5 * 60 * 1000;

/** Sessions that exited + no WS + idle > this are garbage collected */
const ORPHAN_TIMEOUT_MS = 30 * 60 * 1000;

// --- Shell Detection ---

const SHELL_CANDIDATES = [
  { path: '/bin/bash', name: 'Bash' },
  { path: '/usr/bin/bash', name: 'Bash' },
  { path: '/bin/zsh', name: 'Zsh' },
  { path: '/usr/bin/zsh', name: 'Zsh' },
  { path: '/usr/bin/fish', name: 'Fish' },
  { path: '/usr/bin/pwsh', name: 'PowerShell' },
  { path: '/usr/local/bin/pwsh', name: 'PowerShell' },
  { path: '/bin/sh', name: 'sh' },
];

let cachedShells: ShellInfo[] | null = null;

async function getShellVersion(shellPath: string): Promise<string> {
  try {
    const proc = Bun.spawn([shellPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    // Extract first line, trim
    const firstLine = text.split('\n')[0]?.trim() || '';
    // Try to extract version number (e.g. "5.2.15" from "GNU bash, version 5.2.15(1)-release")
    const vMatch = firstLine.match(/(\d+\.\d+[\w.-]*)/);
    return vMatch?.[1] || firstLine.slice(0, 50);
  } catch {
    return '';
  }
}

// --- Session Manager ---

class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
  }

  get available(): boolean {
    return pty !== null;
  }

  /** Create a new terminal session with its own PTY */
  create(opts: TerminalCreateRequest & { workspacePath?: string }): TerminalCreateResponse {
    if (!pty) {
      throw new Error('node-pty not available');
    }

    const id = `term_${nanoid(10)}`;
    const shell = opts.shell || process.env.SHELL || '/bin/bash';
    const args = opts.args || [];
    const cwd = opts.cwd || opts.workspacePath || process.env.HOME || '/';
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    const env = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      TERM_PROGRAM: 'e-ide',
      TERM_PROGRAM_VERSION: '1.0.0',
    };

    const term = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });

    const session: TerminalSession = {
      id,
      shell,
      args,
      cwd,
      env,
      cols,
      rows,
      pid: term.pid,
      pty: term,
      scrollbackBuffer: [],
      scrollbackBytes: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      exitCode: null,
      exitSignal: null,
      attachedWs: new Set(),
      logging: false,
    };

    // Forward PTY data to all attached WebSockets and buffer for replay
    term.onData((data: string) => {
      session.lastActivity = Date.now();
      this.appendScrollback(session, data);

      for (const ws of session.attachedWs) {
        try {
          ws.send(data);
        } catch {
          // WebSocket may be closed — will be cleaned up on next detach
        }
      }
    });

    // Track exit
    term.onExit(({ exitCode, signal }) => {
      session.exitCode = exitCode;
      session.exitSignal = signal ?? null;
      session.lastActivity = Date.now();

      // Notify attached clients
      const msg: TerminalControlMessage = {
        type: 'session_exit',
        exitCode,
        signal: signal || undefined,
      };
      this.sendControl(session, msg);
    });

    this.sessions.set(id, session);

    return {
      sessionId: id,
      shell,
      pid: term.pid,
      cwd,
    };
  }

  /** Get session by ID */
  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  /** List all sessions as client-facing metadata */
  list(): TerminalSessionMeta[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      shell: s.shell,
      pid: s.pid,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      exitCode: s.exitCode,
      attached: s.attachedWs.size > 0,
    }));
  }

  /** Kill a session and clean up */
  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Close all attached WebSockets
    for (const ws of session.attachedWs) {
      try {
        ws.close(1000, 'Session terminated');
      } catch {
        // Already closed
      }
    }
    session.attachedWs.clear();

    // Kill the PTY
    try {
      session.pty.kill();
    } catch {
      // Already dead
    }

    this.sessions.delete(id);
    return true;
  }

  /** Attach a WebSocket to a session — replays scrollback then streams live */
  attach(id: string, ws: WsLike): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.attachedWs.add(ws);

    // Send replay_start control message
    const replayBytes = session.scrollbackBytes;
    this.sendControlToWs(ws, { type: 'replay_start', bytes: replayBytes });

    // Replay scrollback buffer
    for (const chunk of session.scrollbackBuffer) {
      try {
        ws.send(chunk);
      } catch {
        break;
      }
    }

    // Send replay_end control message
    this.sendControlToWs(ws, { type: 'replay_end' });

    // If session already exited, notify immediately
    if (session.exitCode !== null) {
      this.sendControlToWs(ws, {
        type: 'session_exit',
        exitCode: session.exitCode,
        signal: session.exitSignal || undefined,
      });
    }

    return true;
  }

  /** Detach a WebSocket from a session (session stays alive) */
  detach(id: string, ws: WsLike): void {
    const session = this.sessions.get(id);
    if (session) {
      session.attachedWs.delete(ws);
    }
  }

  /** Write data to a session's PTY */
  write(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exitCode !== null) return false;
    session.pty.write(data);
    session.lastActivity = Date.now();
    return true;
  }

  /** Resize a session's PTY */
  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exitCode !== null) return false;
    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
    }
    return true;
  }

  /** Detect available shells on the system */
  async detectShells(): Promise<ShellInfo[]> {
    if (cachedShells) return cachedShells;

    const results: ShellInfo[] = [];
    const seen = new Set<string>();

    // Check user's default shell first
    const userShell = process.env.SHELL;
    if (userShell && existsSync(userShell) && !seen.has(userShell)) {
      seen.add(userShell);
      const version = await getShellVersion(userShell);
      results.push({ path: userShell, name: basename(userShell), version });
    }

    // Check known candidates
    for (const candidate of SHELL_CANDIDATES) {
      if (seen.has(candidate.path)) continue;
      if (existsSync(candidate.path)) {
        seen.add(candidate.path);
        const version = await getShellVersion(candidate.path);
        results.push({ path: candidate.path, name: candidate.name, version });
      }
    }

    cachedShells = results;
    return results;
  }

  /** Clear the shell cache (e.g., after a shell is installed) */
  clearShellCache(): void {
    cachedShells = null;
  }

  /** Garbage collect orphaned sessions */
  private gc(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      // Only GC sessions that have exited, have no attached clients, and are stale
      if (
        session.exitCode !== null &&
        session.attachedWs.size === 0 &&
        now - session.lastActivity > ORPHAN_TIMEOUT_MS
      ) {
        console.log(`[terminal] GC: removing orphaned session ${id} (exited ${session.exitCode})`);
        this.sessions.delete(id);
      }
    }
  }

  /** Append data to the scrollback ring buffer, evicting old data if over limit */
  private appendScrollback(session: TerminalSession, data: string): void {
    session.scrollbackBuffer.push(data);
    session.scrollbackBytes += data.length;

    // Evict oldest chunks if over limit
    while (session.scrollbackBytes > MAX_SCROLLBACK_BYTES && session.scrollbackBuffer.length > 1) {
      const evicted = session.scrollbackBuffer.shift()!;
      session.scrollbackBytes -= evicted.length;
    }
  }

  /** Send a JSON control message to all attached WebSockets */
  private sendControl(session: TerminalSession, msg: TerminalControlMessage): void {
    for (const ws of session.attachedWs) {
      this.sendControlToWs(ws, msg);
    }
  }

  /** Send a JSON control message to a specific WebSocket using 0x02 prefix */
  private sendControlToWs(ws: WsLike, msg: TerminalControlMessage): void {
    try {
      const json = JSON.stringify(msg);
      const payload = String.fromCharCode(TERMINAL_PROTOCOL.CONTROL) + json;
      ws.send(payload);
    } catch {
      // WebSocket may be closed
    }
  }

  /** Destroy the manager (for graceful shutdown) */
  destroy(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}

/** Singleton session manager instance */
export const sessionManager = new TerminalSessionManager();
