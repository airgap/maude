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
import { basename, resolve, dirname } from 'path';

// --- Shell Integration Script Paths ---

/** Resolve the path to a shell integration script by shell name */
function getShellIntegrationPath(shellName: string): string | null {
  // import.meta.dir = .../src/services/ in Bun
  // Shell integration scripts live at .../src/shell-integration/
  const srcDir = dirname(import.meta.dir); // .../src/
  const candidates = [
    resolve(srcDir, 'shell-integration'),  // .../src/shell-integration/
  ];

  const fileMap: Record<string, string> = {
    bash: 'bash-integration.sh',
    zsh: 'zsh-integration.sh',
    fish: 'fish-integration.fish',
  };

  const fileName = fileMap[shellName];
  if (!fileName) return null;

  for (const dir of candidates) {
    const script = resolve(dir, fileName);
    if (existsSync(script)) return script;
  }
  return null;
}

/** Determine the shell name (bash, zsh, fish) from a shell path */
function getShellName(shellPath: string): string {
  const base = basename(shellPath).toLowerCase();
  if (base.includes('bash')) return 'bash';
  if (base.includes('zsh')) return 'zsh';
  if (base.includes('fish')) return 'fish';
  return base;
}

// --- OSC Sequence Parsing ---

/**
 * Parse and strip OSC sequences from PTY output data.
 * Returns the cleaned data (for display) and any extracted events.
 *
 * Supported sequences:
 *   - OSC 7: \x1b]7;file://hostname/path\x07  (or ST = \x1b\\)
 *   - OSC 633;C: \x1b]633;C\x07              (command start)
 *   - OSC 633;D;exitCode: \x1b]633;D;N\x07   (command end)
 */
interface OscParseResult {
  /** PTY data with OSC sequences stripped out */
  cleanData: string;
  /** Extracted CWD from OSC 7, if any */
  cwd: string | null;
  /** Whether a command_start was detected */
  commandStart: boolean;
  /** Exit code from command_end, or null if no command_end detected */
  commandEndExitCode: number | null;
}

// Regex for OSC sequences terminated by BEL (\x07) or ST (\x1b\\)
// OSC 7:    \x1b]7;file://host/path(\x07|\x1b\\)
// OSC 633:  \x1b]633;...\x07|\x1b\\)
const OSC_RE = /\x1b\](?:7;([^\x07\x1b]*)|633;([^\x07\x1b]*))(?:\x07|\x1b\\)/g;

function parseOscSequences(data: string): OscParseResult {
  let cwd: string | null = null;
  let commandStart = false;
  let commandEndExitCode: number | null = null;

  // Extract info from OSC sequences
  let match: RegExpExecArray | null;
  OSC_RE.lastIndex = 0;
  while ((match = OSC_RE.exec(data)) !== null) {
    const osc7Payload = match[1];
    const osc633Payload = match[2];

    if (osc7Payload !== undefined) {
      // OSC 7: file://hostname/path
      try {
        const url = new URL(osc7Payload);
        cwd = decodeURIComponent(url.pathname);
      } catch {
        // Try simple path extraction: file://host/path
        const pathMatch = osc7Payload.match(/^file:\/\/[^/]*(\/.*)/);
        if (pathMatch) {
          cwd = decodeURIComponent(pathMatch[1]);
        }
      }
    }

    if (osc633Payload !== undefined) {
      if (osc633Payload === 'C') {
        commandStart = true;
      } else if (osc633Payload.startsWith('D;')) {
        const code = parseInt(osc633Payload.slice(2), 10);
        commandEndExitCode = isNaN(code) ? 0 : code;
      } else if (osc633Payload === 'D') {
        commandEndExitCode = 0;
      }
    }
  }

  // Strip all OSC sequences from the data before forwarding to clients
  const cleanData = data.replace(OSC_RE, '');

  return { cleanData, cwd, commandStart, commandEndExitCode };
}

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
  /** Whether shell integration OSC parsing is enabled */
  shellIntegration: boolean;
  /** Counter for generating unique command IDs */
  commandCounter: number;
  /** The current in-flight command ID (for pairing start/end) */
  currentCommandId: string | null;
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
    const enableIntegration = opts.enableShellIntegration !== false;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      TERM_PROGRAM: 'e-ide',
      TERM_PROGRAM_VERSION: '1.0.0',
    };

    // Inject shell integration script path via environment variable.
    // The shell sources this script on startup via PROMPT_COMMAND (bash),
    // precmd hook (zsh), or fish_prompt (fish).
    const shellName = getShellName(shell);
    const integrationScript = enableIntegration ? getShellIntegrationPath(shellName) : null;

    let spawnArgs = [...args];
    if (integrationScript) {
      // Set env var so the shell knows integration is available
      env.E_SHELL_INTEGRATION = integrationScript;

      // For bash/zsh: pass --rcfile or source the script
      // For fish: use --init-command
      if (shellName === 'bash') {
        // Use --rcfile to source our integration (it will also source user's bashrc)
        // We create a wrapper that sources the user's rc file then our integration
        env.E_SHELL_INTEGRATION_INJECT = '1';
        spawnArgs = ['--rcfile', integrationScript, ...args];
      } else if (shellName === 'zsh') {
        // For zsh, we inject via ZDOTDIR or ENV. Simplest approach: use -i flag
        // and set ENV to auto-source the integration script after user's zshrc.
        env.E_SHELL_INTEGRATION_INJECT = '1';
        // The cleanest approach: set an env var and have .zshrc source it.
        // For automatic injection without modifying user files, we pass it as a
        // command argument that zsh will execute on startup.
        spawnArgs = ['-i', ...args];
        // We'll source the integration at the end via precmd setup
        env.ZDOTDIR_ORIGINAL = env.ZDOTDIR || '';
      } else if (shellName === 'fish') {
        spawnArgs = ['--init-command', `source ${integrationScript}`, ...args];
      }
    }

    const term = pty.spawn(shell, spawnArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });

    // For zsh, we inject the integration script by writing a source command
    // immediately after the shell starts. This runs after .zshrc loads.
    if (integrationScript && shellName === 'zsh') {
      // Give zsh a moment to initialize, then source the integration script
      setTimeout(() => {
        try {
          term.write(`source "${integrationScript}"\n`);
        } catch {
          // PTY may already be closed
        }
      }, 100);
    }

    // For bash with --rcfile, we need to also source the user's bashrc.
    // We'll create a wrapper approach: the integration script itself is lightweight,
    // and the user's bashrc is sourced via PROMPT_COMMAND or a subshell init.
    // Actually, bash's --rcfile replaces .bashrc, so we inject sourcing of user's
    // bashrc by writing it to the terminal after startup.
    if (integrationScript && shellName === 'bash') {
      setTimeout(() => {
        try {
          const bashrc = `${env.HOME || '/root'}/.bashrc`;
          // Source user's bashrc if it exists, silently
          term.write(`[ -f "${bashrc}" ] && source "${bashrc}" 2>/dev/null\n`);
        } catch {
          // PTY may already be closed
        }
      }, 50);
    }

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
      shellIntegration: enableIntegration && integrationScript !== null,
      commandCounter: 0,
      currentCommandId: null,
    };

    // Forward PTY data to all attached WebSockets and buffer for replay.
    // When shell integration is active, parse OSC sequences from the output,
    // strip them from display data, and emit control messages.
    term.onData((data: string) => {
      session.lastActivity = Date.now();

      if (session.shellIntegration) {
        const result = parseOscSequences(data);

        // Emit control messages for detected events
        if (result.cwd) {
          session.cwd = result.cwd;
          this.sendControl(session, { type: 'cwd_changed', cwd: result.cwd });
        }

        if (result.commandStart) {
          session.commandCounter++;
          session.currentCommandId = `${session.id}_cmd_${session.commandCounter}`;
          this.sendControl(session, {
            type: 'command_start',
            id: session.currentCommandId,
          });
        }

        if (result.commandEndExitCode !== null) {
          const cmdId = session.currentCommandId || `${session.id}_cmd_${session.commandCounter}`;
          this.sendControl(session, {
            type: 'command_end',
            id: cmdId,
            exitCode: result.commandEndExitCode,
          });
          session.currentCommandId = null;
        }

        // Forward cleaned data (OSC sequences stripped) to clients
        const cleanData = result.cleanData;
        if (cleanData.length > 0) {
          this.appendScrollback(session, cleanData);
          for (const ws of session.attachedWs) {
            try {
              ws.send(cleanData);
            } catch {
              // WebSocket may be closed
            }
          }
        }
      } else {
        // No shell integration — forward raw data as-is
        this.appendScrollback(session, data);
        for (const ws of session.attachedWs) {
          try {
            ws.send(data);
          } catch {
            // WebSocket may be closed — will be cleaned up on next detach
          }
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

    // Send current CWD if shell integration has tracked it
    if (session.shellIntegration && session.cwd) {
      this.sendControlToWs(ws, { type: 'cwd_changed', cwd: session.cwd });
    }

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
