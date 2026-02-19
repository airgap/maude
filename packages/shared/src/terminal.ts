// --- Terminal Types ---

/** Available shell profile for terminal sessions */
export interface ShellProfile {
  id: string;
  name: string;
  shellPath: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  icon?: string;
  /** Whether this profile was auto-detected from system shells (read-only) */
  isAutoDetected?: boolean;
}

/** Detected shell on the system */
export interface ShellInfo {
  path: string;
  name: string;
  version: string;
}

/** Metadata for a terminal session (client-facing) */
export interface TerminalSessionMeta {
  id: string;
  shell: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivity: number;
  exitCode: number | null;
  attached: boolean;
  /** Whether session logging is currently active */
  logging: boolean;
  /** Path to the log file (if logging is or was active) */
  logFilePath: string | null;
}

/** Request to create a new terminal session */
export interface TerminalCreateRequest {
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Whether to enable shell integration (CWD tracking, command boundaries). Default: true */
  enableShellIntegration?: boolean;
}

/** Response from creating a terminal session */
export interface TerminalCreateResponse {
  sessionId: string;
  shell: string;
  pid: number;
  cwd: string;
}

// --- WebSocket Control Messages (0x02 prefix) ---

export type TerminalControlMessage =
  | TerminalReplayStart
  | TerminalReplayEnd
  | TerminalSessionExit
  | TerminalCwdChanged
  | TerminalCommandStart
  | TerminalCommandEnd
  | TerminalLoggingStarted
  | TerminalLoggingStopped;

export interface TerminalReplayStart {
  type: 'replay_start';
  bytes: number;
}

export interface TerminalReplayEnd {
  type: 'replay_end';
}

export interface TerminalSessionExit {
  type: 'session_exit';
  exitCode: number;
  signal?: number;
}

export interface TerminalCwdChanged {
  type: 'cwd_changed';
  cwd: string;
}

export interface TerminalCommandStart {
  type: 'command_start';
  id: string;
}

export interface TerminalCommandEnd {
  type: 'command_end';
  id: string;
  exitCode: number;
}

export interface TerminalLoggingStarted {
  type: 'logging_started';
  logFilePath: string;
}

export interface TerminalLoggingStopped {
  type: 'logging_stopped';
}

// --- Protocol Constants ---

/** Binary prefix bytes for the terminal WebSocket protocol */
export const TERMINAL_PROTOCOL = {
  /** Raw PTY data (default / no prefix) */
  DATA: 0x00,
  /** Resize command: payload is "cols,rows" in ASCII */
  RESIZE: 0x01,
  /** JSON control message */
  CONTROL: 0x02,
} as const;

// --- Split Layout Types ---

export type SplitDirection = 'horizontal' | 'vertical';

export interface TerminalLeaf {
  type: 'leaf';
  sessionId: string;
}

export interface TerminalBranch {
  type: 'split';
  direction: SplitDirection;
  ratio: number;
  first: TerminalLayout;
  second: TerminalLayout;
}

export type TerminalLayout = TerminalLeaf | TerminalBranch;

// --- Tab Types ---

export interface TerminalTab {
  id: string;
  label: string;
  layout: TerminalLayout;
  focusedSessionId: string;
  /** Profile ID used to create this tab (for session reconnection) */
  profileId?: string;
}

// --- Preferences ---

export type CursorStyle = 'block' | 'underline' | 'bar';
export type BellStyle = 'none' | 'visual' | 'audio' | 'both';

export interface TerminalPreferences {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  bellStyle: BellStyle;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  defaultShell: string;
  enableShellIntegration: boolean;
  /** Enable inline image rendering (iTerm2 + Sixel protocols) */
  enableImages: boolean;
  /** Maximum image width in pixels (default 1000) */
  imageMaxWidth: number;
  /** Maximum image height in pixels (default 1000) */
  imageMaxHeight: number;
  /** Image storage cache limit in MB (default 64) */
  imageStorageLimit: number;
}

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  fontFamily: 'var(--font-family-mono, monospace)',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  bellStyle: 'visual',
  copyOnSelect: false,
  rightClickPaste: false,
  defaultShell: '',
  enableShellIntegration: true,
  enableImages: false,
  imageMaxWidth: 1000,
  imageMaxHeight: 1000,
  imageStorageLimit: 64,
};
