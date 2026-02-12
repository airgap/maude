import { type Subprocess } from 'bun';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import { getDb } from '../db/database';
import { generateMcpConfig } from './mcp-config';

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
function translateCliEvent(event: any): string[] {
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
      events.push(JSON.stringify({
        type: 'message_start',
        message: {
          id: msg.id || nanoid(),
          role: 'assistant',
          model: msg.model || 'unknown',
        },
        parent_tool_use_id: parentId,
      }));

      // Emit content blocks
      const content = msg.content || [];
      for (let i = 0; i < content.length; i++) {
        const block = content[i];

        if (block.type === 'text') {
          events.push(JSON.stringify({
            type: 'content_block_start',
            index: i,
            content_block: { type: 'text', text: '' },
            parent_tool_use_id: parentId,
          }));
          events.push(JSON.stringify({
            type: 'content_block_delta',
            index: i,
            delta: { type: 'text_delta', text: block.text || '' },
            parent_tool_use_id: parentId,
          }));
          events.push(JSON.stringify({
            type: 'content_block_stop',
            index: i,
            parent_tool_use_id: parentId,
          }));
        } else if (block.type === 'thinking') {
          events.push(JSON.stringify({
            type: 'content_block_start',
            index: i,
            content_block: { type: 'thinking', thinking: '' },
            parent_tool_use_id: parentId,
          }));
          events.push(JSON.stringify({
            type: 'content_block_delta',
            index: i,
            delta: { type: 'thinking_delta', thinking: block.thinking || '' },
            parent_tool_use_id: parentId,
          }));
          events.push(JSON.stringify({
            type: 'content_block_stop',
            index: i,
            parent_tool_use_id: parentId,
          }));
        } else if (block.type === 'tool_use') {
          events.push(JSON.stringify({
            type: 'content_block_start',
            index: i,
            content_block: {
              type: 'tool_use',
              id: block.id || nanoid(),
              name: block.name || 'unknown',
            },
            parent_tool_use_id: parentId,
          }));
          events.push(JSON.stringify({
            type: 'content_block_delta',
            index: i,
            delta: {
              type: 'input_json_delta',
              partial_json: JSON.stringify(block.input || {}),
            },
            parent_tool_use_id: parentId,
          }));
          events.push(JSON.stringify({
            type: 'content_block_stop',
            index: i,
            parent_tool_use_id: parentId,
          }));
        }
      }
      break;
    }

    case 'result': {
      // Emit message_delta with usage info
      const usage = event.usage || {};
      events.push(JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: event.stop_reason || 'end_turn' },
        usage: {
          input_tokens: usage.input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        },
      }));

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

  async createSession(conversationId: string, opts: {
    model?: string;
    systemPrompt?: string;
    projectPath?: string;
    effort?: string;
    maxBudgetUsd?: number;
    maxTurns?: number;
    allowedTools?: string[];
    disallowedTools?: string[];
    resumeSessionId?: string;
  } = {}): Promise<string> {
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
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  async sendMessage(sessionId: string, content: string): Promise<ReadableStream> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'terminated') throw new Error(`Session ${sessionId} is terminated`);

    session.status = 'running';

    // Spawn CLI in print mode
    const args = [
      'claude',
      '--output-format', 'stream-json',
      '--verbose',
      '-p', content,
    ];

    if (session.cliSessionId) {
      args.push('-r', session.cliSessionId);
    }
    if (session.model) {
      args.push('--model', session.model);
    }
    if (session.systemPrompt) {
      args.push('--system-prompt', session.systemPrompt);
    }

    // Always skip CLI permissions — we implement our own approval layer
    args.push('--dangerously-skip-permissions');

    if (session.effort) {
      args.push('--effort', session.effort);
    }
    if (session.maxBudgetUsd !== undefined && session.maxBudgetUsd !== null) {
      args.push('--max-budget-usd', String(session.maxBudgetUsd));
    }
    if (session.maxTurns !== undefined && session.maxTurns !== null) {
      args.push('--max-turns', String(session.maxTurns));
    }
    if (session.allowedTools?.length) {
      for (const tool of session.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }
    if (session.disallowedTools?.length) {
      for (const tool of session.disallowedTools) {
        args.push('--disallowedTools', tool);
      }
    }

    // MCP config
    const mcpConfigPath = generateMcpConfig();
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
    }

    console.log(`[claude] Spawning: ${args.join(' ').slice(0, 120)}...`);

    const proc = Bun.spawn(args, {
      cwd: session.projectPath || process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    session.process = proc;
    this.pipeStderr(session);

    return this.createSSEStream(session);
  }

  private createSSEStream(session: ClaudeSession): ReadableStream {
    const encoder = new TextEncoder();
    const proc = session.process!;
    let cancelled = false;

    return new ReadableStream({
      async start(controller) {
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
          try {
            controller.enqueue(encoder.encode(`data: {"type":"message_stop","reason":"cancelled"}\n\n`));
            controller.close();
          } catch { /* already closed */ }
          session.status = 'idle';
        });

        try {
          const decoder = new TextDecoder();
          let buffer = '';
          let sentStop = false;
          let assistantContent: any[] | null = null;
          let assistantModel: string | null = null;

          // Read stdout using async iteration
          for await (const chunk of proc.stdout) {
            if (cancelled) break;
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const cliEvent = JSON.parse(line);

                // Capture CLI session ID for future resume and persist to DB
                if (cliEvent.type === 'system' && cliEvent.session_id) {
                  session.cliSessionId = cliEvent.session_id;
                  try {
                    const db = getDb();
                    db.query('UPDATE conversations SET cli_session_id = ? WHERE id = ?')
                      .run(cliEvent.session_id, session.conversationId);
                  } catch (e) {
                    console.error('[claude] Failed to persist session ID:', e);
                  }
                }

                // Accumulate all assistant content blocks across multi-turn tool execution
                if (cliEvent.type === 'assistant' && cliEvent.message?.content) {
                  if (!assistantContent) assistantContent = [];
                  assistantContent.push(...cliEvent.message.content);
                  assistantModel = cliEvent.message.model || session.model || null;
                }

                // Emit tool_result events for user-type events (tool results from CLI)
                if (cliEvent.type === 'user' && cliEvent.message?.content) {
                  for (const block of cliEvent.message.content) {
                    if (block.type === 'tool_result') {
                      const resultEvent = JSON.stringify({
                        type: 'tool_result',
                        toolCallId: block.tool_use_id || '',
                        result: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                        isError: Boolean(block.is_error),
                      });
                      controller.enqueue(encoder.encode(`data: ${resultEvent}\n\n`));
                    }
                  }
                }

                // Translate CLI events to API-style events
                const apiEvents = translateCliEvent(cliEvent);
                for (const evt of apiEvents) {
                  controller.enqueue(encoder.encode(`data: ${evt}\n\n`));
                }

                // Persist token usage on result
                if (cliEvent.type === 'result') {
                  sentStop = true;
                  const usage = cliEvent.usage;
                  if (usage) {
                    try {
                      const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
                      const db = getDb();
                      db.query('UPDATE conversations SET total_tokens = total_tokens + ? WHERE id = ?')
                        .run(totalTokens, session.conversationId);
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

          // Save assistant message to DB
          if (assistantContent && assistantContent.length > 0) {
            try {
              const db = getDb();
              const msgId = nanoid();
              db.query(`
                INSERT INTO messages (id, conversation_id, role, content, model, timestamp)
                VALUES (?, ?, 'assistant', ?, ?, ?)
              `).run(msgId, session.conversationId, JSON.stringify(assistantContent), assistantModel, Date.now());

              db.query('UPDATE conversations SET updated_at = ? WHERE id = ?')
                .run(Date.now(), session.conversationId);
            } catch (dbErr) {
              console.error('[claude] Failed to save assistant message:', dbErr);
            }
          }

          if (!cancelled && !sentStop) {
            controller.enqueue(encoder.encode(`data: {"type":"message_stop"}\n\n`));
          }
          if (!cancelled) {
            controller.close();
          }
          session.status = 'idle';
        } catch (err) {
          clearInterval(pingInterval);
          if (!cancelled) {
            const msg = String(err).replace(/"/g, '\\"');
            controller.enqueue(encoder.encode(`data: {"type":"error","error":{"type":"stream_error","message":"${msg}"}}\n\n`));
            controller.close();
          }
          session.status = 'idle';
        }
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

  listSessions(): Array<{ id: string; conversationId: string; status: string }> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      conversationId: s.conversationId,
      status: s.status,
    }));
  }

  private async pipeStderr(session: ClaudeSession): Promise<void> {
    if (!session.process) return;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of session.process.stderr) {
        console.error(`[claude:${session.id}]`, decoder.decode(chunk));
      }
    } catch {
      // Process ended
    }
  }
}

export const claudeManager = new ClaudeProcessManager();
