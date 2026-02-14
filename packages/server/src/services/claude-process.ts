import { type Subprocess } from 'bun';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import { getDb } from '../db/database';
import { generateMcpConfig } from './mcp-config';
import { buildCliCommand } from './cli-provider';
import type { CliProvider } from '@maude/shared';
import { getSandboxConfig } from '../middleware/sandbox';
import { verifyFile } from './code-verifier';

interface ClaudeSession {
  id: string;
  cliSessionId?: string;
  process?: Subprocess;
  conversationId: string;
  projectPath?: string;
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

class ClaudeProcessManager {
  private sessions = new Map<string, ClaudeSession>();

  async createSession(
    conversationId: string,
    opts: {
      model?: string;
      systemPrompt?: string;
      projectPath?: string;
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
      projectPath: opts.projectPath,
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
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  async sendMessage(sessionId: string, content: string): Promise<ReadableStream> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'terminated') throw new Error(`Session ${sessionId} is terminated`);

    session.status = 'running';

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
    const sandbox = getSandboxConfig(session.projectPath || null);
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

    console.log(`[${provider}] Spawning: ${binary} ${args.join(' ').slice(0, 120)}...`);

    let proc: Subprocess;
    try {
      // Build a clean env: remove CLAUDECODE to avoid "nested session" detection,
      // strip FORCE_COLOR to get plain output, and enable unbuffered I/O for real-time
      // streaming of events from the Claude CLI.
      const spawnEnv = {
        ...process.env,
        FORCE_COLOR: '0',
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8:strict',
      };
      delete (spawnEnv as any).CLAUDECODE;

      proc = Bun.spawn([binary, ...args], {
        cwd: session.projectPath || process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
        env: spawnEnv,
      });
    } catch (spawnErr) {
      const msg = String(spawnErr);
      console.error(`[${provider}] Failed to spawn: ${msg}`);
      session.status = 'idle';
      // Return a stream containing just the error event
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

    session.process = proc;

    return this.createSSEStream(session);
  }

  private createSSEStream(session: ClaudeSession): ReadableStream {
    const encoder = new TextEncoder();
    const proc = session.process!;
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

    // Accumulate stderr for error reporting
    const stderrChunks: string[] = [];
    const stderrDecoder = new TextDecoder();
    const stderrReader = async () => {
      try {
        for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
          const text = stderrDecoder.decode(chunk, { stream: true });
          stderrChunks.push(text);
          console.error(`[claude:${session.id}]`, text);
        }
      } catch {
        /* process ended */
      }
    };
    stderrReader();

    // Hoist assistant content accumulator so the cancel handler can persist
    // any partial response that was already received before cancellation.
    let assistantContent: any[] | null = null;
    let assistantModel: string | null = null;

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

        session.emitter.once('cancel', () => {
          cancelled = true;
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
            } catch (dbErr) {
              console.error('[claude] Failed to save assistant message on cancel:', dbErr);
            }
          }

          enqueueEvent(controller, `data: {"type":"message_stop","reason":"cancelled"}\n\n`);
          session.streamComplete = true;
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

            // Read stdout using async iteration (stdout is always a ReadableStream when spawned with 'pipe')
            for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
              console.log('[stream] Starting to read from CLI stdout');
              if (cancelled) break;
              buffer += decoder.decode(chunk, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const cliEvent = JSON.parse(line);

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
                    // Check permission mode for tool approval
                    let permMode = 'safe';
                    try {
                      const pDb = getDb();
                      const pRow = pDb
                        .query("SELECT value FROM settings WHERE key = 'permissionMode'")
                        .get() as any;
                      if (pRow) permMode = JSON.parse(pRow.value);
                    } catch {
                      /* default to safe */
                    }

                    const approvalTools = [
                      ...fileWriteTools,
                      'Bash',
                      'bash',
                      'execute_command',
                      'NotebookEdit',
                    ];
                    for (const block of cliEvent.message.content) {
                      // Emit tool_approval_request for dangerous tools in safe mode
                      if (
                        block.type === 'tool_use' &&
                        approvalTools.includes(block.name) &&
                        (permMode === 'safe' || permMode === 'plan')
                      ) {
                        const filePath =
                          block.input?.file_path || block.input?.path || block.input?.filePath;
                        const desc =
                          block.name === 'Bash' ||
                          block.name === 'bash' ||
                          block.name === 'execute_command'
                            ? `Run: ${String(block.input?.command || '').slice(0, 100)}`
                            : filePath
                              ? `Write to ${filePath}`
                              : `Execute ${block.name}`;
                        const approvalEvent = JSON.stringify({
                          type: 'tool_approval_request',
                          toolCallId: block.id || nanoid(),
                          toolName: block.name,
                          input: block.input || {},
                          description: desc,
                        });
                        enqueueEvent(controller, `data: ${approvalEvent}\n\n`);
                      }

                      if (block.type === 'tool_use' && fileWriteTools.includes(block.name)) {
                        const filePath =
                          block.input?.file_path || block.input?.path || block.input?.filePath;
                        if (filePath && typeof filePath === 'string') {
                          // Run async verification after a short delay to let the file be written
                          setTimeout(async () => {
                            try {
                              const result = await verifyFile(
                                filePath,
                                session.projectPath || process.cwd(),
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
                        // Look up tool name from accumulated assistant content
                        let toolName: string | undefined;
                        if (assistantContent) {
                          const toolBlock = assistantContent.find(
                            (b: any) => b.type === 'tool_use' && b.id === block.tool_use_id,
                          );
                          if (toolBlock) toolName = toolBlock.name;
                        }
                        const resultEvent = JSON.stringify({
                          type: 'tool_result',
                          toolCallId: block.tool_use_id || '',
                          toolName,
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

                  // Persist token usage on result
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
                    }
                  }
                } catch {
                  // Non-JSON line, skip
                }
              }
            }

            clearInterval(pingInterval);

            // Check exit code and report errors if no events received
            if (!cancelled && !receivedAnyEvent) {
              // Wait briefly for stderr to finish
              await new Promise((r) => setTimeout(r, 100));
              const exitCode = proc.exitCode;
              const stderr = stderrChunks.join('').trim();
              const errMsg = stderr
                ? `CLI exited (code ${exitCode}) with: ${stderr.slice(0, 500)}`
                : `CLI exited with code ${exitCode} and produced no output`;
              console.error(`[claude:${session.id}] ${errMsg}`);
              const errEvt = JSON.stringify({
                type: 'error',
                error: { type: 'cli_error', message: errMsg },
              });
              enqueueEvent(controller, `data: ${errEvt}\n\n`);
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
              } catch (dbErr) {
                console.error('[claude] Failed to save assistant message:', dbErr);
              }
            }

            if (!cancelled && !sentStop) {
              enqueueEvent(controller, `data: {"type":"message_stop"}\n\n`);
            }
            session.streamComplete = true;
            if (!cancelled) {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
            session.status = 'idle';
          } catch (err) {
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
      session.process?.kill();
      this.sessions.delete(sessionId);
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
          } catch { /* already closed */ }
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
            } catch { /* already closed */ }
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

export const claudeManager = new ClaudeProcessManager();
