import { type Subprocess } from 'bun';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import { getDb } from '../db/database';
import { generateMcpConfig } from './mcp-config';
import { buildCliCommand } from './cli-provider';
import type { CliProvider } from '@e/shared';
import {
  parseMcpToolName,
  isMcpToolDangerous,
  isMcpFileWriteTool,
  extractFilePath,
} from '@e/shared';
import type { PermissionMode } from '@e/shared';
import { getSandboxConfig } from '../middleware/sandbox';
import { verifyFile } from './code-verifier';
import { shouldRequireApproval, loadPermissionRules, loadTerminalCommandPolicy, extractToolInputForMatching } from './permission-rules';
import {
  getContextLimit,
  getAutoCompactThreshold,
  getRecommendedOptions,
  loadConversationHistory,
  summarizeWithLLM,
} from './chat-compaction';

// Check if `script` utility is available (util-linux) for PTY-wrapped spawning.
// This avoids native addon issues with node-pty in Bun.
import { execSync } from 'child_process';
let hasScript = false;
try {
  execSync('which script', { stdio: 'ignore' });
  hasScript = true;
} catch {
  console.warn('[claude] `script` not available — pipe mode may buffer stdout');
}

/** Map signal number to name for diagnostic messages */
function signalName(sig: number): string {
  const names: Record<number, string> = {
    1: 'SIGHUP',
    2: 'SIGINT',
    3: 'SIGQUIT',
    6: 'SIGABRT',
    9: 'SIGKILL',
    14: 'SIGALRM',
    15: 'SIGTERM',
  };
  return names[sig] || `SIG${sig}`;
}

/** Abstraction over Bun.spawn and node-pty so the streaming code works with either. */
interface CliProcess {
  readonly pid: number;
  /** ReadableStream of stdout data (for pipe mode) or combined pty output. */
  readonly stdout: ReadableStream<Uint8Array>;
  /** Separate stderr stream (pipe mode only; null in PTY mode where stderr is merged). */
  readonly stderr: ReadableStream<Uint8Array> | null;
  /** Write to the process's stdin / pty input. */
  write(data: string): void;
  /** Kill the process. */
  kill(signal?: string): void;
  /** Promise that resolves with the exit code when the process exits. */
  readonly exited: Promise<number>;
  /** The exit code if the process has already exited, or null. */
  readonly exitCode: number | null;
}

/** Shell-escape a string for use in single-quoted shell arguments. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Spawn the CLI wrapped in `script -qec` (allocates a real PTY via util-linux).
 * This forces the child process to see a TTY on stdout, preventing full-buffer mode
 * that causes the CLI to withhold output until its buffer fills or it exits.
 */
function spawnWithScript(
  binary: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): CliProcess {
  // Build shell-safe command string for `script -c`.
  // Disable PTY echo (stty -echo) so stdin writes aren't reflected in stdout.
  const escaped = [binary, ...args].map(shellEscape).join(' ');
  const command = `stty -echo 2>/dev/null; ${escaped}`;
  // -q: quiet (no "Script started/done" messages)
  // -e: return child's exit code (--return)
  // -c: command to run
  // /dev/null: typescript file (discard PTY recording)
  const proc = Bun.spawn(['script', '-qec', command, '/dev/null'], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...env, TERM: 'dumb' },
  });

  return {
    get pid() {
      return proc.pid;
    },
    get stdout() {
      return proc.stdout as ReadableStream<Uint8Array>;
    },
    get stderr() {
      return proc.stderr as ReadableStream<Uint8Array>;
    },
    write(data: string) {
      try {
        const stdin = proc.stdin as any;
        if (stdin?.write) {
          stdin.write(new TextEncoder().encode(data));
          stdin.flush?.();
        }
      } catch {
        /* stdin closed */
      }
    },
    kill(signal?: string) {
      try {
        if (signal === 'SIGINT') proc.kill(2);
        else if (signal === 'SIGTERM') proc.kill(15);
        else proc.kill();
      } catch {
        /* already dead */
      }
    },
    get exited() {
      return proc.exited;
    },
    get exitCode() {
      return proc.exitCode;
    },
  };
}

/** Spawn the CLI using Bun.spawn (pipe mode — used as fallback if node-pty is unavailable). */
function spawnWithPipe(
  binary: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): CliProcess {
  const proc = Bun.spawn([binary, ...args], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });

  return {
    get pid() {
      return proc.pid;
    },
    get stdout() {
      return proc.stdout as ReadableStream<Uint8Array>;
    },
    get stderr() {
      return proc.stderr as ReadableStream<Uint8Array>;
    },
    write(data: string) {
      try {
        // Bun's proc.stdin is a FileSink, not a WritableStream
        const stdin = proc.stdin as any;
        if (stdin?.write) {
          stdin.write(new TextEncoder().encode(data));
          stdin.flush?.();
        }
      } catch {
        /* stdin closed */
      }
    },
    kill(signal?: string) {
      try {
        if (signal === 'SIGINT') proc.kill(2);
        else if (signal === 'SIGTERM') proc.kill(15);
        else proc.kill();
      } catch {
        /* already dead */
      }
    },
    get exited() {
      return proc.exited;
    },
    get exitCode() {
      return proc.exitCode;
    },
  };
}

interface ClaudeSession {
  id: string;
  cliSessionId?: string;
  process?: Subprocess;
  cliProcess?: CliProcess;
  conversationId: string;
  workspacePath?: string;
  model?: string;
  systemPrompt?: string;
  effort?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  status: 'running' | 'idle' | 'terminated';
  emitter: EventEmitter;
  /** Buffer of all SSE events sent during this stream, for reconnection. */
  eventBuffer: string[];
  /** Whether the stream has finished (events fully read from CLI). */
  streamComplete: boolean;
  /** Nudges queued mid-stream to be prepended to the next message turn. */
  pendingNudges: string[];
}

/**
 * Translates Claude CLI stream-json events into Anthropic API-style SSE events.
 *
 * CLI format:
 *   {"type":"system","subtype":"init", ...}
 *   {"type":"assistant","message":{"content":[...],"model":"...", ...}, ...}
 *   {"type":"result","subtype":"success","usage":{...}, ...}
 *
 * API format we produce:
 *   {"type":"message_start","message":{"id":"...","role":"assistant","model":"..."}}
 *   {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
 *   {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 *   {"type":"content_block_stop","index":0}
 *   {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{...}}
 *   {"type":"message_stop"}
 */
export function translateCliEvent(event: any): string[] {
  const events: string[] = [];
  const parentId = event.parent_tool_use_id || null;

  switch (event.type) {
    case 'system':
      // Init event — nothing to emit yet, but we could use it for metadata
      break;

    case 'assistant': {
      const msg = event.message;
      if (!msg) break;

      // Emit message_start
      events.push(
        JSON.stringify({
          type: 'message_start',
          message: {
            id: msg.id || nanoid(),
            role: 'assistant',
            model: msg.model || 'unknown',
          },
          parent_tool_use_id: parentId,
        }),
      );

      // Emit content blocks in their original order
      const content = msg.content || [];
      for (let i = 0; i < content.length; i++) {
        const block = content[i];

        if (block.type === 'text') {
          events.push(
            JSON.stringify({
              type: 'content_block_start',
              index: i,
              content_block: { type: 'text', text: '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_delta',
              index: i,
              delta: { type: 'text_delta', text: block.text || '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_stop',
              index: i,
              parent_tool_use_id: parentId,
            }),
          );
        } else if (block.type === 'thinking') {
          events.push(
            JSON.stringify({
              type: 'content_block_start',
              index: i,
              content_block: { type: 'thinking', thinking: '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_delta',
              index: i,
              delta: { type: 'thinking_delta', thinking: block.thinking || '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_stop',
              index: i,
              parent_tool_use_id: parentId,
            }),
          );
        } else if (block.type === 'tool_use') {
          events.push(
            JSON.stringify({
              type: 'content_block_start',
              index: i,
              content_block: {
                type: 'tool_use',
                id: block.id || nanoid(),
                name: block.name || 'unknown',
              },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_delta',
              index: i,
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(block.input || {}),
              },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_stop',
              index: i,
              parent_tool_use_id: parentId,
            }),
          );
        }
      }
      break;
    }

    case 'result': {
      // Emit message_delta with usage info
      const usage = event.usage || {};
      events.push(
        JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: event.stop_reason || 'end_turn' },
          usage: {
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
            cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
            cache_read_input_tokens: usage.cache_read_input_tokens || 0,
          },
        }),
      );

      // Emit message_stop
      events.push(JSON.stringify({ type: 'message_stop' }));
      break;
    }

    default:
      // Unknown event type — skip
      break;
  }

  return events;
}

/**
 * Parse and store <artifact> XML blocks from assistant message text content.
 * Returns an array of SSE event strings for each extracted artifact so the
 * client can update the Artifacts panel in real time.
 *
 * Supported format:
 * <artifact type="plan|diff|screenshot|walkthrough" title="...">
 * ...content...
 * </artifact>
 */
function extractAndStoreArtifacts(
  conversationId: string,
  messageId: string,
  content: any[],
): string[] {
  const sseEvents: string[] = [];
  const db = getDb();

  const artifactRegex =
    /<artifact\s+type="([^"]+)"\s+title="([^"]+)">([\s\S]*?)<\/artifact>/gi;

  for (const block of content) {
    if (block.type !== 'text' || !block.text) continue;

    let match: RegExpExecArray | null;
    artifactRegex.lastIndex = 0;
    while ((match = artifactRegex.exec(block.text)) !== null) {
      const [, rawType, title, artifactContent] = match;
      const validTypes = ['plan', 'diff', 'screenshot', 'walkthrough'];
      const type = validTypes.includes(rawType) ? rawType : 'plan';

      try {
        const id = nanoid(12);
        const now = Date.now();
        db.query(
          `INSERT INTO artifacts (id, conversation_id, message_id, type, title, content, metadata, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '{}', 0, ?, ?)`,
        ).run(id, conversationId, messageId, type, title.trim(), artifactContent.trim(), now, now);

        const artifactEvent = JSON.stringify({
          type: 'artifact_created',
          artifact: {
            id,
            conversationId,
            messageId,
            type,
            title: title.trim(),
            content: artifactContent.trim(),
            metadata: {},
            pinned: false,
            createdAt: now,
            updatedAt: now,
          },
        });
        sseEvents.push(`data: ${artifactEvent}\n\n`);
        console.log(`[artifacts] Stored artifact "${title}" (${type}) from message ${messageId}`);
      } catch (err) {
        console.error('[artifacts] Failed to store artifact:', err);
      }
    }
  }

  return sseEvents;
}

class ClaudeProcessManager {
  private sessions = new Map<string, ClaudeSession>();
  /** Timers for auto-removing completed sessions after a grace period. */
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Schedule removal of a completed session after 60s — enough time for
   *  the client to reconnect after a page reload, but prevents stale sessions
   *  from accumulating indefinitely and loading old conversations on reload. */
  private scheduleCleanup(sessionId: string) {
    // Clear any existing timer for this session
    const existing = this.cleanupTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.sessions.delete(sessionId);
      this.cleanupTimers.delete(sessionId);
    }, 60_000);
    this.cleanupTimers.set(sessionId, timer);
  }

  async createSession(
    conversationId: string,
    opts: {
      model?: string;
      systemPrompt?: string;
      workspacePath?: string;
      effort?: string;
      maxBudgetUsd?: number;
      maxTurns?: number;
      allowedTools?: string[];
      disallowedTools?: string[];
      resumeSessionId?: string;
    } = {},
  ): Promise<string> {
    const sessionId = nanoid();

    const session: ClaudeSession = {
      id: sessionId,
      cliSessionId: opts.resumeSessionId,
      conversationId,
      workspacePath: opts.workspacePath,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      effort: opts.effort,
      maxBudgetUsd: opts.maxBudgetUsd,
      maxTurns: opts.maxTurns,
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
      status: 'idle',
      emitter: new EventEmitter(),
      eventBuffer: [],
      streamComplete: false,
      pendingNudges: [],
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  async sendMessage(sessionId: string, content: string): Promise<ReadableStream> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'terminated') throw new Error(`Session ${sessionId} is terminated`);

    session.status = 'running';

    // Prepend any queued nudges to this turn's content
    if (session.pendingNudges.length > 0) {
      const nudgeBlock = session.pendingNudges
        .map((n) => `[User nudge during previous response]: ${n}`)
        .join('\n');
      content = `${nudgeBlock}\n\n${content}`;
      session.pendingNudges = [];
    }

    // Resolve CLI provider from settings
    let provider: CliProvider = 'claude';
    try {
      const db = getDb();
      const row = db.query("SELECT value FROM settings WHERE key = 'cliProvider'").get() as any;
      if (row) provider = JSON.parse(row.value) as CliProvider;
    } catch {
      /* use default */
    }

    // Apply sandbox restrictions
    const sandbox = getSandboxConfig(session.workspacePath || null);
    let systemPrompt = session.systemPrompt;
    if (sandbox.enabled && sandbox.allowedPaths.length > 0) {
      const sandboxDirective = `\n\n## Sandbox Restrictions\nYou MUST only read/write files within these directories: ${sandbox.allowedPaths.join(', ')}. Do NOT access files outside these paths. Do NOT run destructive commands like: ${sandbox.blockedCommands.slice(0, 5).join(', ')}.`;
      systemPrompt = (systemPrompt || '') + sandboxDirective;
    }

    const mcpConfigPath = generateMcpConfig();
    const { binary, args } = buildCliCommand(provider, {
      content,
      resumeSessionId: session.cliSessionId,
      model: session.model,
      systemPrompt,
      effort: session.effort,
      maxBudgetUsd: session.maxBudgetUsd,
      maxTurns: session.maxTurns,
      allowedTools: session.allowedTools,
      disallowedTools: session.disallowedTools,
      mcpConfigPath: mcpConfigPath || undefined,
    });

    console.log(`[${provider}] Spawning: ${binary} ${args.join(' ').slice(0, 200)}...`);

    // Build a clean env: remove CLAUDECODE to avoid "nested session" detection,
    // strip FORCE_COLOR to get plain output, and enable unbuffered I/O for real-time
    // streaming of events from the Claude CLI.
    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      FORCE_COLOR: '0',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8:strict',
      CI: '1',
      NONINTERACTIVE: '1',
    };
    delete spawnEnv.CLAUDECODE;

    let cliProc: CliProcess;
    try {
      const cwd = session.workspacePath || process.cwd();
      if (hasScript) {
        cliProc = spawnWithScript(binary, args, cwd, spawnEnv);
        console.log(`[${provider}] Spawned PID ${cliProc.pid} (script/pty)`);
      } else {
        cliProc = spawnWithPipe(binary, args, cwd, spawnEnv);
        console.log(`[${provider}] Spawned PID ${cliProc.pid} (pipe)`);
      }
    } catch (spawnErr) {
      const msg = String(spawnErr);
      console.error(`[${provider}] Failed to spawn: ${msg}`);
      session.status = 'idle';
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          const errEvt = JSON.stringify({
            type: 'error',
            error: { type: 'spawn_error', message: `Failed to spawn ${binary}: ${msg}` },
          });
          controller.enqueue(encoder.encode(`data: ${errEvt}\n\n`));
          controller.close();
        },
      });
    }

    session.cliProcess = cliProc;

    return this.createSSEStream(session);
  }

  private createSSEStream(session: ClaudeSession): ReadableStream {
    const encoder = new TextEncoder();
    const proc = session.cliProcess!;
    let cancelled = false;

    // Reset event buffer for this stream
    session.eventBuffer = [];
    session.streamComplete = false;

    /** Enqueue an SSE event string to both the HTTP stream and the replay buffer. */
    const enqueueEvent = (controller: ReadableStreamDefaultController, sseData: string) => {
      // Always buffer, even if the client disconnected
      session.eventBuffer.push(sseData);
      try {
        controller.enqueue(encoder.encode(sseData));
      } catch {
        // Client disconnected — event is still in the buffer for reconnection
      }
    };

    // Accumulate stderr for error reporting.
    // In PTY mode, stderr is merged with stdout (no separate stream).
    const stderrChunks: string[] = [];
    let stderrStreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    if (proc.stderr) {
      const stderrDecoder = new TextDecoder();
      stderrStreamReader = proc.stderr.getReader();
      const readStderr = async () => {
        try {
          while (true) {
            const { done, value } = await stderrStreamReader!.read();
            if (done) break;
            const text = stderrDecoder.decode(value, { stream: true });
            stderrChunks.push(text);
            for (const line of text.split('\n')) {
              if (line.trim()) console.error(`[claude:${session.id}:stderr] ${line}`);
            }
          }
        } catch {
          /* process ended */
        }
      };
      readStderr();
    }

    // Hoist assistant content accumulator so the cancel handler can persist
    // any partial response that was already received before cancellation.
    let assistantContent: any[] | null = null;
    let assistantModel: string | null = null;

    const scheduleCleanup = () => this.scheduleCleanup(session.id);

    return new ReadableStream({
      start(controller) {
        // Ping to keep connection alive
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
          } catch {
            clearInterval(pingInterval);
          }
        }, 15000);

        // Timeout: if the CLI produces no content events within 120s, report an error.
        // This catches cases where the CLI hangs during API auth, MCP server startup, etc.
        // Hoisted here so both the cancel handler and the streaming loop can clear it.
        let receivedContentEvent = false;
        let contentTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          if (!receivedContentEvent && !cancelled) {
            console.error(
              `[claude:${session.id}] Content timeout — no content received within 120s`,
            );
            const errEvt = JSON.stringify({
              type: 'error',
              error: {
                type: 'timeout',
                message:
                  'No response received from CLI within 120 seconds. The model may be overloaded or the CLI may have failed to start.',
              },
            });
            enqueueEvent(controller, `data: ${errEvt}\n\n`);
            // Also send message_stop so client exits streaming state
            enqueueEvent(controller, `data: {"type":"message_stop"}\n\n`);
            session.streamComplete = true;
            scheduleCleanup();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
            session.status = 'idle';
            proc.kill('SIGTERM');
          }
        }, 120_000);
        const clearContentTimeout = () => {
          if (contentTimeoutId) {
            clearTimeout(contentTimeoutId);
            contentTimeoutId = null;
          }
        };

        session.emitter.once('cancel', () => {
          cancelled = true;
          clearContentTimeout();
          clearInterval(pingInterval);
          proc.kill('SIGINT');

          // Save any assistant content accumulated before cancellation
          if (assistantContent && assistantContent.length > 0) {
            try {
              const db = getDb();
              const msgId = nanoid();
              db.query(
                `INSERT INTO messages (id, conversation_id, role, content, model, timestamp)
                 VALUES (?, ?, 'assistant', ?, ?, ?)`,
              ).run(
                msgId,
                session.conversationId,
                JSON.stringify(assistantContent),
                assistantModel,
                Date.now(),
              );
              db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
                Date.now(),
                session.conversationId,
              );
              // Extract artifacts from partial content on cancel too
              extractAndStoreArtifacts(session.conversationId, msgId, assistantContent);
            } catch (dbErr) {
              console.error('[claude] Failed to save assistant message on cancel:', dbErr);
            }
          }

          enqueueEvent(controller, `data: {"type":"message_stop","reason":"cancelled"}\n\n`);
          session.streamComplete = true;
          scheduleCleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          session.status = 'idle';
        });

        // Run the streaming loop WITHOUT awaiting — this lets start() return
        // immediately so Bun begins delivering enqueued data to the HTTP
        // response in real-time instead of buffering until the CLI exits.
        (async () => {
          try {
            const decoder = new TextDecoder();
            let buffer = '';
            let sentStop = false;
            let sentMessageStart = false;
            let receivedAnyEvent = false;

            // Read stdout (or combined pty output) using explicit reader.
            // Race each read against process exit to avoid blocking forever.
            console.log(`[claude:${session.id}] Starting to read from CLI output`);
            const stdoutReader = proc.stdout.getReader();

            // Sentinel that resolves when the process exits.
            let processExitCode: number | undefined;
            const exitSentinel = proc.exited.then(async (code) => {
              processExitCode = code;
              console.log(`[claude:${session.id}] CLI process exited with code ${code}`);
              await new Promise((r) => setTimeout(r, 1000));
              return { done: true as const, value: undefined as Uint8Array | undefined };
            });

            while (true) {
              const result = await Promise.race([stdoutReader.read(), exitSentinel]);
              if (result.done || cancelled) {
                // If the process exited and the reader is stalled, cancel it to clean up
                if (processExitCode !== undefined) {
                  try {
                    stdoutReader.cancel();
                  } catch {
                    /* ignore */
                  }
                }
                break;
              }
              const value = result.value;
              if (!value) continue;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (let line of lines) {
                // Strip \r from PTY/script output (\r\n line endings)
                line = line.replace(/\r/g, '');
                if (!line.trim()) continue;
                let cliEvent: any;
                try {
                  cliEvent = JSON.parse(line);
                } catch {
                  // Non-JSON line from CLI — log it so it's visible for debugging
                  console.warn(`[claude:${session.id}] Non-JSON stdout: ${line.slice(0, 200)}`);
                  continue;
                }

                try {
                  // Log event receipt for debugging streaming delays
                  if (cliEvent.type !== 'system') {
                    console.log(`[claude:${session.id}] Received ${cliEvent.type} event`);
                  }

                  // Capture CLI session ID for future resume and persist to DB
                  if (cliEvent.type === 'system' && cliEvent.session_id) {
                    session.cliSessionId = cliEvent.session_id;
                    try {
                      const db = getDb();
                      db.query('UPDATE conversations SET cli_session_id = ? WHERE id = ?').run(
                        cliEvent.session_id,
                        session.conversationId,
                      );
                    } catch (e) {
                      console.error('[claude] Failed to persist session ID:', e);
                    }

                    // Send message_start immediately so UI shows streaming indicator
                    // This ensures users see feedback even if response generation is slow
                    if (!sentMessageStart) {
                      sentMessageStart = true;
                      const messageStartEvent = JSON.stringify({
                        type: 'message_start',
                        message: {
                          id: nanoid(),
                          role: 'assistant',
                          model: session.model || 'unknown',
                        },
                      });
                      console.log('[stream] Enqueuing message_start event');
                      enqueueEvent(controller, `data: ${messageStartEvent}\n\n`);
                    }
                  }

                  // Track whether we've received actual content (not just system init)
                  if (cliEvent.type === 'assistant' || cliEvent.type === 'result') {
                    receivedContentEvent = true;
                    clearContentTimeout();
                  }

                  // Accumulate all assistant content blocks across multi-turn tool execution
                  if (cliEvent.type === 'assistant' && cliEvent.message?.content) {
                    if (!assistantContent) assistantContent = [];
                    assistantContent.push(...cliEvent.message.content);
                    assistantModel = cliEvent.message.model || session.model || null;

                    // Track file-writing tool calls for verification + approval
                    const fileWriteTools = [
                      'write_file',
                      'edit_file',
                      'create_file',
                      'str_replace_editor',
                      'Write',
                      'Edit',
                    ];
                    // Check permission mode and per-tool rules for approval
                    let permMode: PermissionMode = 'safe';
                    try {
                      const pDb = getDb();
                      const pRow = pDb
                        .query("SELECT value FROM settings WHERE key = 'permissionMode'")
                        .get() as any;
                      if (pRow) permMode = JSON.parse(pRow.value) as PermissionMode;
                    } catch {
                      /* default to safe */
                    }

                    // Load per-tool permission rules and terminal policy
                    const permRules = loadPermissionRules(session.conversationId, session.workspacePath);
                    const termPolicy = loadTerminalCommandPolicy();

                    for (const block of cliEvent.message.content) {
                      // Skip non-tool blocks (e.g. text blocks don't have .name)
                      if (block.type !== 'tool_use') continue;

                      // Evaluate per-tool permission rules
                      const ruleDecision = shouldRequireApproval(
                        block.name,
                        (block.input || {}) as Record<string, unknown>,
                        permRules,
                        permMode,
                        termPolicy,
                      );
                      if (ruleDecision === 'ask') {
                        const parsed = parseMcpToolName(block.name);
                        const filePath = extractFilePath(block.input || {});
                        const effectiveName = parsed.renderAs || parsed.toolName;
                        const desc =
                          effectiveName === 'Bash' ||
                          block.name === 'bash' ||
                          block.name === 'execute_command'
                            ? `Run: ${String(block.input?.command || '').slice(0, 100)}`
                            : filePath
                              ? `Write to ${filePath}`
                              : `Execute ${parsed.displayName}`;
                        const approvalEvent = JSON.stringify({
                          type: 'tool_approval_request',
                          toolCallId: block.id || nanoid(),
                          toolName: block.name,
                          input: block.input || {},
                          description: desc,
                        });
                        enqueueEvent(controller, `data: ${approvalEvent}\n\n`);
                      }

                      // Emit user_question_request for AskUserQuestion tool
                      if (block.name === 'AskUserQuestion') {
                        const questionEvent = JSON.stringify({
                          type: 'user_question_request',
                          toolCallId: block.id || nanoid(),
                          questions: block.input?.questions || [],
                        });
                        enqueueEvent(controller, `data: ${questionEvent}\n\n`);
                      }

                      // Trigger file verification for file-writing tools (both built-in and MCP)
                      const isFileWrite =
                        fileWriteTools.includes(block.name) || isMcpFileWriteTool(block.name);
                      if (isFileWrite) {
                        const filePath = extractFilePath(block.input || {});
                        if (filePath && typeof filePath === 'string') {
                          // Run async verification after a short delay to let the file be written
                          setTimeout(async () => {
                            try {
                              const result = await verifyFile(
                                filePath,
                                session.workspacePath || process.cwd(),
                              );
                              const verifyEvent = JSON.stringify({
                                type: 'verification_result',
                                filePath: result.filePath,
                                passed: result.passed,
                                issues: result.issues,
                                tool: result.tool,
                                duration: result.duration,
                              });
                              enqueueEvent(controller, `data: ${verifyEvent}\n\n`);
                            } catch {
                              /* verification failed silently */
                            }
                          }, 500);
                        }
                      }
                    }
                  }

                  // Emit tool_result events for user-type events (tool results from CLI)
                  if (cliEvent.type === 'user' && cliEvent.message?.content) {
                    for (const block of cliEvent.message.content) {
                      if (block.type === 'tool_result') {
                        // Look up tool name + filePath from accumulated assistant content
                        let toolName: string | undefined;
                        let filePath: string | undefined;
                        if (assistantContent) {
                          const toolBlock = assistantContent.find(
                            (b: any) => b.type === 'tool_use' && b.id === block.tool_use_id,
                          );
                          if (toolBlock) {
                            toolName = toolBlock.name;
                            filePath = extractFilePath(toolBlock.input || {}) || undefined;
                          }
                        }
                        const resultEvent = JSON.stringify({
                          type: 'tool_result',
                          toolCallId: block.tool_use_id || '',
                          toolName,
                          filePath,
                          result:
                            typeof block.content === 'string'
                              ? block.content
                              : JSON.stringify(block.content),
                          isError: Boolean(block.is_error),
                        });
                        enqueueEvent(controller, `data: ${resultEvent}\n\n`);
                      }
                    }
                  }

                  receivedAnyEvent = true;

                  // Translate CLI events to API-style events and send to client.
                  // Wrap in try/catch so a client disconnect doesn't abort the
                  // loop — we still need to accumulate assistantContent for DB save.
                  const apiEvents = translateCliEvent(cliEvent);
                  for (const evt of apiEvents) {
                    console.log('[stream] Enqueuing event:', evt.slice(0, 100));
                    enqueueEvent(controller, `data: ${evt}\n\n`);
                  }

                  // Persist token usage on result + check context pressure for autocompaction
                  if (cliEvent.type === 'result') {
                    sentStop = true;
                    const usage = cliEvent.usage;
                    if (usage) {
                      try {
                        const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
                        const db = getDb();
                        db.query(
                          'UPDATE conversations SET total_tokens = total_tokens + ? WHERE id = ?',
                        ).run(totalTokens, session.conversationId);
                      } catch (e) {
                        console.error('[claude] Failed to persist token usage:', e);
                      }

                      // Check context pressure — warn at 85%, autocompact at the Claude Code threshold
                      try {
                        const inputTokens = usage.input_tokens || 0;
                        const model = session.model || 'default';
                        const contextLimit = getContextLimit(model);
                        const autoCompactThreshold = getAutoCompactThreshold(model);
                        // 85% of context window as the warning threshold
                        const warningThreshold = Math.floor(contextLimit * 0.85);

                        if (inputTokens >= warningThreshold) {
                          // Read autoCompaction setting
                          let autoCompactionEnabled = true;
                          try {
                            const db = getDb();
                            const row = db
                              .query("SELECT value FROM settings WHERE key = 'autoCompaction'")
                              .get() as any;
                            if (row) autoCompactionEnabled = JSON.parse(row.value);
                          } catch {
                            /* use default */
                          }

                          const shouldAutoCompact =
                            inputTokens >= autoCompactThreshold && autoCompactionEnabled;

                          if (shouldAutoCompact) {
                            console.log(
                              `[claude:${session.id}] Context at ${inputTokens}/${contextLimit} tokens (threshold ${autoCompactThreshold}) — applying autocompaction`,
                            );

                            // Run LLM compaction async so we can still emit the boundary event
                            // We do it in a fire-and-forget to avoid blocking the result event.
                            // The compaction must complete before the next user turn, which is fine
                            // since the user has to type and send a new message.
                            (async () => {
                              try {
                                const db = getDb();
                                const opts = getRecommendedOptions(model);

                                // Load the full raw message history from DB
                                const rawRows = db
                                  .query(
                                    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
                                  )
                                  .all(session.conversationId) as any[];
                                const allMessages = rawRows.map((r: any) => {
                                  let parsed: any[];
                                  try { parsed = JSON.parse(r.content); } catch { parsed = []; }
                                  // Normalize nudge blocks so they don't confuse downstream APIs
                                  const content = Array.isArray(parsed)
                                    ? parsed.map((block: any) =>
                                        block.type === 'nudge'
                                          ? { type: 'text', text: `[User nudge]: ${block.text}` }
                                          : block,
                                      )
                                    : parsed;
                                  return { role: r.role, content };
                                });

                                if (allMessages.length === 0) return;

                                // Determine split point: which messages to drop vs keep
                                // using the same smart strategy but without creating a summary
                                const history = loadConversationHistory(session.conversationId, {
                                  ...opts,
                                  createSummary: false,
                                });

                                if (!history.compacted) {
                                  console.log(`[claude:${session.id}] Compaction not needed after re-check`);
                                  return;
                                }

                                // compactedCount is the number of messages kept.
                                // Everything before that split is dropped.
                                const splitIdx = allMessages.length - history.compactedCount;
                                const finalDropped = allMessages.slice(0, splitIdx);
                                const keptMessages = allMessages.slice(splitIdx);

                                // Generate LLM summary (falls back to rule-based on failure)
                                const { summaryText, summaryMessage, usedLLM } = await summarizeWithLLM(
                                  finalDropped,
                                  keptMessages,
                                  model,
                                );

                                // Build final compacted message array: [summary, ...kept]
                                const compactedMessages = [summaryMessage, ...keptMessages];

                                // Write compacted history back to DB
                                db.query('DELETE FROM messages WHERE conversation_id = ?').run(
                                  session.conversationId,
                                );
                                let ts = Date.now();
                                for (const msg of compactedMessages) {
                                  db.query(
                                    `INSERT INTO messages (id, conversation_id, role, content, timestamp)
                                     VALUES (?, ?, ?, ?, ?)`,
                                  ).run(
                                    nanoid(),
                                    session.conversationId,
                                    msg.role,
                                    JSON.stringify(msg.content),
                                    ts++,
                                  );
                                }

                                // Clear CLI session ID and store the summary text so the next
                                // turn can inject it into the fresh CLI session's first prompt.
                                session.cliSessionId = undefined;
                                db.query(
                                  'UPDATE conversations SET cli_session_id = NULL, compact_summary = ? WHERE id = ?',
                                ).run(summaryText, session.conversationId);

                                console.log(
                                  `[claude:${session.id}] Autocompaction complete: ${history.originalCount} → ${compactedMessages.length} messages (LLM=${usedLLM})`,
                                );
                              } catch (compactErr) {
                                console.error('[claude] Autocompaction failed:', compactErr);
                              }
                            })();
                          }

                          // Emit context_warning for the warning banner
                          const usagePct = contextLimit > 0
                            ? Math.round((inputTokens / contextLimit) * 1000) / 10
                            : 0;
                          const contextWarningEvent = JSON.stringify({
                            type: 'context_warning',
                            inputTokens,
                            contextLimit,
                            usagePercent: usagePct,
                            autocompacted: shouldAutoCompact,
                          });
                          enqueueEvent(controller, `data: ${contextWarningEvent}\n\n`);

                          // Also emit compact_boundary if compacting (matches Claude Code's SSE protocol)
                          if (shouldAutoCompact) {
                            const compactBoundaryEvent = JSON.stringify({
                              type: 'compact_boundary',
                              trigger: 'auto',
                              pre_tokens: inputTokens,
                              context_limit: contextLimit,
                            });
                            enqueueEvent(controller, `data: ${compactBoundaryEvent}\n\n`);
                          }
                        }
                      } catch (pressureErr) {
                        console.error('[claude] Context pressure check failed:', pressureErr);
                      }
                    }
                  }
                } catch (eventErr) {
                  console.error(`[claude:${session.id}] Error processing event:`, eventErr);
                }
              }
            }

            clearContentTimeout();
            clearInterval(pingInterval);

            // Check exit code and report errors if no content events received.
            // We check receivedContentEvent (not receivedAnyEvent) because the
            // CLI may send a 'system' init event and then hang — in that case
            // the client already shows the streaming indicator but never gets content.
            if (!cancelled && !receivedContentEvent) {
              // Wait for process to fully exit and stderr to finish flushing
              // BEFORE cancelling the stderr reader — otherwise we lose the error output.
              await proc.exited.catch(() => {});
              await new Promise((r) => setTimeout(r, 500));
              const exitCode = processExitCode ?? proc.exitCode;
              const stderr = stderrChunks.join('').trim();

              // Decode exit code for clarity
              let exitDetail = `code ${exitCode}`;
              if (exitCode !== null && exitCode !== undefined) {
                if (exitCode > 128)
                  exitDetail += ` (signal ${exitCode - 128}: ${signalName(exitCode - 128)})`;
                else if (exitCode === 127) exitDetail += ' (command not found)';
                else if (exitCode === 126) exitDetail += ' (permission denied)';
              }

              const errMsg = stderr
                ? `CLI exited (${exitDetail}) with: ${stderr.slice(0, 500)}`
                : `CLI exited with ${exitDetail} and produced no output`;
              console.error(`[claude:${session.id}] ${errMsg}`);
              const errEvt = JSON.stringify({
                type: 'error',
                error: { type: 'cli_error', message: errMsg },
              });
              enqueueEvent(controller, `data: ${errEvt}\n\n`);
            }

            // Cancel the stderr reader after error reporting is done
            if (stderrStreamReader) {
              try {
                stderrStreamReader.cancel();
              } catch {
                /* ignore */
              }
            }

            // Save assistant message to DB (skip if cancel handler already saved it)
            if (!cancelled && assistantContent && assistantContent.length > 0) {
              try {
                const db = getDb();
                const msgId = nanoid();
                db.query(
                  `
                INSERT INTO messages (id, conversation_id, role, content, model, timestamp)
                VALUES (?, ?, 'assistant', ?, ?, ?)
              `,
                ).run(
                  msgId,
                  session.conversationId,
                  JSON.stringify(assistantContent),
                  assistantModel,
                  Date.now(),
                );

                db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
                  Date.now(),
                  session.conversationId,
                );

                // Extract <artifact> blocks from text content and store them
                const artifactEvents = extractAndStoreArtifacts(
                  session.conversationId,
                  msgId,
                  assistantContent,
                );
                for (const evt of artifactEvents) {
                  enqueueEvent(controller, evt);
                }
              } catch (dbErr) {
                console.error('[claude] Failed to save assistant message:', dbErr);
              }
            }

            if (!cancelled && !sentStop) {
              enqueueEvent(controller, `data: {"type":"message_stop"}\n\n`);
            }
            session.streamComplete = true;
            scheduleCleanup();
            if (!cancelled) {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
            session.status = 'idle';
          } catch (err) {
            clearContentTimeout();
            clearInterval(pingInterval);

            // Save any accumulated assistant content even on error/disconnect.
            // This is critical for page reloads — the client drops the connection
            // causing controller.enqueue to throw, but we still want to persist
            // whatever content was already received from the CLI.
            if (!cancelled && assistantContent && assistantContent.length > 0) {
              try {
                const db = getDb();
                const msgId = nanoid();
                db.query(
                  `INSERT INTO messages (id, conversation_id, role, content, model, timestamp)
                 VALUES (?, ?, 'assistant', ?, ?, ?)`,
                ).run(
                  msgId,
                  session.conversationId,
                  JSON.stringify(assistantContent),
                  assistantModel,
                  Date.now(),
                );
                db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
                  Date.now(),
                  session.conversationId,
                );
              } catch (dbErr) {
                console.error('[claude] Failed to save assistant message on error:', dbErr);
              }
            }

            if (!cancelled) {
              const msg = String(err).replace(/"/g, '\\"');
              enqueueEvent(
                controller,
                `data: {"type":"error","error":{"type":"stream_error","message":"${msg}"}}\n\n`,
              );
              session.streamComplete = true;
              scheduleCleanup();
              try {
                controller.close();
              } catch {
                /* controller already closed */
              }
            }
            session.status = 'idle';
          }
        })(); // end async IIFE — not awaited so start() returns immediately
      },
    });
  }

  /** Write data to the CLI process's stdin / pty input (for answering AskUserQuestion) */
  writeStdin(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.cliProcess) return false;
    try {
      session.cliProcess.write(data);
      return true;
    } catch (err) {
      console.error(`[claude:${sessionId}] Failed to write to stdin:`, err);
      return false;
    }
  }

  /**
   * Queue a nudge to be injected into the agent context on its next turn.
   * Nudges are non-blocking — they don't interrupt the current stream.
   */
  queueNudge(sessionId: string, nudge: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pendingNudges.push(nudge);
    console.log(`[claude:${sessionId}] Nudge queued: ${nudge.slice(0, 80)}`);
    return true;
  }

  cancelGeneration(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.emitter.emit('cancel');
    }
  }

  terminateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'terminated';
      session.cliProcess?.kill();
      this.sessions.delete(sessionId);
      const timer = this.cleanupTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.cleanupTimers.delete(sessionId);
      }
    }
  }

  getSession(sessionId: string): ClaudeSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Array<{
    id: string;
    conversationId: string;
    status: string;
    streamComplete: boolean;
    bufferedEvents: number;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      conversationId: s.conversationId,
      status: s.status,
      streamComplete: s.streamComplete,
      bufferedEvents: s.eventBuffer.length,
    }));
  }

  /**
   * Create a reconnection stream that replays all buffered SSE events
   * from an in-flight (or just-completed) session. If the stream is
   * still running, the returned stream stays open and receives new
   * events via the session's emitter until completion.
   */
  reconnectStream(sessionId: string): ReadableStream | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.eventBuffer.length === 0) return null;

    const encoder = new TextEncoder();
    const buffer = session.eventBuffer;
    const isComplete = session.streamComplete;

    return new ReadableStream({
      start(controller) {
        // 1. Replay all buffered events immediately
        for (const sseData of buffer) {
          try {
            controller.enqueue(encoder.encode(sseData));
          } catch {
            return; // client gone
          }
        }

        // 2. If stream already finished, close immediately
        if (isComplete) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }

        // 3. Stream is still running — listen for new events
        //    We record the current buffer length so we only forward
        //    events that arrive AFTER the replay.
        let cursor = buffer.length;

        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
          } catch {
            clearInterval(pingInterval);
          }
        }, 15000);

        const pollInterval = setInterval(() => {
          // Forward any new events that were buffered since our last check
          while (cursor < session.eventBuffer.length) {
            try {
              controller.enqueue(encoder.encode(session.eventBuffer[cursor]));
            } catch {
              clearInterval(pollInterval);
              clearInterval(pingInterval);
              return;
            }
            cursor++;
          }

          // If stream is done, close
          if (session.streamComplete) {
            clearInterval(pollInterval);
            clearInterval(pingInterval);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        }, 100); // Poll every 100ms for new events

        // Clean up if client disconnects
        session.emitter.once('reconnect_close', () => {
          clearInterval(pollInterval);
          clearInterval(pingInterval);
        });
      },
      cancel() {
        session.emitter.emit('reconnect_close');
      },
    });
  }
}

// Persist across Bun --hot reloads: store the singleton on globalThis so
// a module re-evaluation doesn't orphan running CLI processes.
const GLOBAL_KEY = '__e_claudeManager';
export const claudeManager: ClaudeProcessManager =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new ClaudeProcessManager());
