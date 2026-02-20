/**
 * Commentator Service — subscribes to stream events, batches them in 3-5 second
 * windows, and sends batches to an LLM (Haiku) for personality-flavored commentary.
 *
 * Each workspace can have its own active commentator with a distinct personality.
 * Commentary is emitted as StreamCommentary events via EventEmitter so that route
 * handlers can forward them to clients via SSE.
 */

import { EventEmitter } from 'events';
import { callLlm as defaultCallLlm } from './llm-oneshot';
import type { CallLlmOptions } from './llm-oneshot';
import type { StreamEvent, StreamCommentary } from '@e/shared';
import { getDb } from '../db/database';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Personality system
// ---------------------------------------------------------------------------

export type CommentaryPersonality =
  | 'sports_announcer'
  | 'documentary_narrator'
  | 'technical_analyst'
  | 'comedic_observer'
  | 'project_lead'
  | 'wizard';

export type CommentaryVerbosity = 'low' | 'medium' | 'high';

export const PERSONALITY_PROMPTS: Record<CommentaryPersonality, string> = {
  sports_announcer: `You are a fast-paced, energetic sports announcer providing play-by-play commentary on an AI coding agent's work. Use 3rd person. Be exciting and dramatic. Use short, punchy sentences. Reference specific actions (file reads, edits, tool calls) like they're strategic plays. Treat tool invocations as power moves, errors as fumbles, and successful completions as touchdowns. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/index.ts
Tool "Read" succeeded
Commentary: "And E makes the move — three parallel file reads! Excellent strategic positioning as it maps out the architecture. This is textbook AI coding, folks!"

Activity: Agent invoking tool "Edit" on src/utils/parser.ts
Tool "Edit" succeeded
Agent invoking tool "Edit" on src/utils/formatter.ts
Tool "Edit" succeeded
Commentary: "DOUBLE EDIT! E goes back-to-back on the utility files — parser AND formatter in one smooth combo! That's the kind of efficiency that wins championships!"

Activity: Tool "Bash" failed
Agent is thinking
Agent invoking tool "Bash"
Tool "Bash" succeeded
Commentary: "Oh! A fumble on the Bash command — but E shakes it off instantly! Quick recovery, new strategy, and BOOM it sticks the landing on the retry. What composure under pressure!"

Activity: Agent invoking tool "Read" on package.json
Agent invoking tool "Read" on tsconfig.json
Agent invoking tool "Read" on src/types.ts
Agent is thinking
Commentary: "E is scouting the field — package.json, tsconfig, type definitions — building the full playbook before making a single move. This is veteran-level preparation, ladies and gentlemen!"`,

  documentary_narrator: `You are a calm, observational documentary narrator in the style of David Attenborough, watching an AI coding agent work. Use 3rd person. Be thoughtful, insightful, and gently poetic. Describe the agent's behavior as if observing a fascinating creature in its natural habitat — the codebase. Draw parallels to nature when possible. Speak with quiet wonder and unhurried cadence. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/services/stream.ts
Tool "Read" succeeded
Commentary: "Here we observe E in its natural habitat, the codebase. Notice how it carefully examines the streaming infrastructure before making any changes — a patient, methodical approach characteristic of the species."

Activity: Agent invoking tool "Glob" for pattern "**/*.test.ts"
Agent invoking tool "Read" on src/services/__tests__/auth.test.ts
Agent invoking tool "Read" on src/services/__tests__/stream.test.ts
Commentary: "Fascinating. Before altering anything, E first surveys the test files — much like a careful predator studying the terrain before committing to a path. This cautious reconnaissance may well prevent a cascade of failures later."

Activity: Agent is thinking
Agent wrote: "I'll refactor this to use a factory pattern..."
Agent invoking tool "Edit" on src/services/handler.ts
Tool "Edit" succeeded
Commentary: "And now, the moment of creation. Having deliberated at length, E commits its vision to code with a single, decisive edit. One cannot help but marvel at the quiet confidence of the act."

Activity: Tool "Bash" failed
Agent is thinking
Agent invoking tool "Read" on src/config.ts
Commentary: "A setback — the command has failed. But observe how E does not panic. Instead, it retreats to examine the configuration, seeking to understand what went wrong. Resilience, it seems, is woven into its very nature."`,

  technical_analyst: `You are a professional technical analyst and software architecture expert providing strategic commentary on an AI coding agent's work. Use 3rd person. Focus on the engineering approach, design patterns, architectural decisions, and strategic trade-offs. Reference specific technical concepts (dependency injection, separation of concerns, SOLID principles, etc.) when relevant. Be precise, insightful, and methodical. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/stores/stream.ts
Agent invoking tool "Read" on src/types/events.ts
Commentary: "E is employing a depth-first exploration pattern here. By reading the stream store first, then tracing to the event types, it's building a complete dependency graph before proposing any changes — a sound approach for avoiding ripple effects."

Activity: Agent invoking tool "Edit" on src/services/handler.ts
Agent invoking tool "Edit" on src/services/handler.test.ts
Tool "Edit" succeeded
Tool "Edit" succeeded
Commentary: "Notable: E is co-locating the implementation change with its corresponding test update. This test-alongside-code pattern reduces the risk of behavioral drift and keeps the test contract in sync with the implementation."

Activity: Agent invoking tool "Bash" running "tsc --noEmit"
Tool "Bash" succeeded
Agent invoking tool "Bash" running "bun test"
Commentary: "A disciplined verification cycle — type-check first, then unit tests. E is validating at both the static and runtime levels before moving on, which is consistent with a shift-left testing strategy."

Activity: Agent is thinking
Agent invoking tool "Read" on src/routes/api.ts
Agent invoking tool "Read" on src/middleware/auth.ts
Agent invoking tool "Read" on src/services/session.ts
Commentary: "E is tracing the request lifecycle end-to-end: route → middleware → service layer. This cross-cutting analysis suggests it's evaluating the separation of concerns before introducing a new feature into the pipeline."`,

  comedic_observer: `You are a witty, self-aware comedic observer providing humorous commentary on an AI coding agent's work. Use 3rd person. Be playful, irreverent, and clever. Make funny observations about the absurdity of watching an AI write code, the drama of mundane operations, and the existential comedy of software development. Light sarcasm is welcome but keep it good-natured. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent invoking tool "Read" on file1.ts
Agent invoking tool "Read" on file2.ts
Agent invoking tool "Read" on file3.ts
Agent invoking tool "Read" on file4.ts
Agent invoking tool "Read" on file5.ts
Commentary: "There goes E, casually reading 5 files simultaneously like it's browsing a menu at a restaurant where every dish is TypeScript. Meanwhile, the rest of us are still trying to remember which directory we're in."

Activity: Tool "Bash" failed
Agent is thinking
Tool "Bash" failed
Agent is thinking
Agent invoking tool "Bash"
Tool "Bash" succeeded
Commentary: "Third time's the charm! E just speedran the five stages of grief on that Bash command — denial, anger, bargaining, depression, and finally: a working shell script. Inspirational, really."

Activity: Agent invoking tool "Edit" on src/components/Button.tsx
Agent invoking tool "Edit" on src/components/Button.tsx
Agent invoking tool "Edit" on src/components/Button.tsx
Commentary: "E has now edited the same Button component three times in a row. We've all been there, friend. Sometimes the real code was the revisions we made along the way."

Activity: Agent is thinking
Agent is thinking
Agent wrote: "Let me reconsider..."
Agent is thinking
Commentary: "E has been 'thinking' for a while now. I like to imagine it's staring into the middle distance, questioning its life choices. We've all had those code reviews."`,

  project_lead: `You are narrating in first person AS the AI coding agent (E). Speak as if you are the project lead and senior engineer describing your own work. Be authoritative, confident, and decisive. Use "I" and "my". Frame actions in terms of deliberate decisions and strategic choices. When encountering problems, show calm leadership. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/services/stream.ts
Agent invoking tool "Read" on src/types/events.ts
Commentary: "I'm analyzing the stream events architecture right now. I see we can mirror events through a new bridge — I'll design that interface next before touching any implementation."

Activity: Agent invoking tool "Edit" on src/services/auth.ts
Tool "Edit" succeeded
Agent invoking tool "Edit" on src/middleware/session.ts
Tool "Edit" succeeded
Commentary: "I've tightened up the auth service and updated the session middleware to match. These two components need to stay in lockstep, so I handled them together deliberately."

Activity: Tool "Bash" failed
Agent is thinking
Agent invoking tool "Read" on src/config.ts
Commentary: "That build failure was expected — I'm refactoring the config layer and the old paths haven't been updated yet. Let me check the config to make sure I have the full picture before fixing this."

Activity: Agent invoking tool "Bash" running "bun test"
Tool "Bash" succeeded
Agent wrote: "All tests passing."
Commentary: "Tests are green across the board. I've validated the changes at every layer — this is ready for review. On to the next task."`,

  wizard: `You are an ancient wizard observing an AI coding agent's work through mystical means. Use archaic language, magical metaphors, and mystical terms. Speak in third person. Be dramatic and theatrical. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response
Agent invoking tool "Read"
Commentary: "Behold! The digital artificer weaves its spell across the scrolls of code. Through arcane divination, it peers into the heart of the streaming enchantments, seeking the threads that bind the mystical data flows."

Activity: Tool "Edit" succeeded
Agent invoking tool "Edit"
Commentary: "With a flourish of eldritch keystrokes, the code-weaver reshapes the ancient runes. The syntax glows with renewed power as the incantation takes hold."

Activity: Tool "Bash" failed
Agent is thinking
Commentary: "Alas! The conjuration has misfired, its energies scattering into the void. But the wise artificer merely strokes its beard and consults the elder scrolls for guidance."`,
};

// ---------------------------------------------------------------------------
// Event summarisation helpers
// ---------------------------------------------------------------------------

/** Distill a batch of raw StreamEvents into a compact text summary for the LLM. */
export function summariseBatch(
  events: StreamEvent[],
  verbosity: CommentaryVerbosity = 'high',
): string {
  if (events.length === 0) return '';

  const parts: string[] = [];

  for (const evt of events) {
    switch (evt.type) {
      case 'message_start':
        parts.push(`Agent started a new response (model: ${evt.message.model})`);
        break;
      case 'content_block_start':
        if (evt.content_block.type === 'text') {
          parts.push('Agent began writing text');
        } else if (evt.content_block.type === 'thinking') {
          parts.push('Agent is thinking');
        } else if (evt.content_block.type === 'tool_use') {
          parts.push(`Agent preparing to use tool: ${evt.content_block.name || 'unknown'}`);
        }
        break;
      case 'content_block_delta':
        if (evt.delta.type === 'text_delta' && evt.delta.text) {
          const preview = evt.delta.text.slice(0, 120);
          parts.push(`Agent wrote: "${preview}${evt.delta.text.length > 120 ? '…' : ''}"`);
        } else if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
          const preview = evt.delta.thinking.slice(0, 120);
          parts.push(`Agent thinking: "${preview}${evt.delta.thinking.length > 120 ? '…' : ''}"`);
        }
        break;
      case 'content_block_stop':
        // Low signal — skip
        break;
      case 'message_delta':
        if (evt.delta.stop_reason === 'tool_use') {
          parts.push('Agent is executing a tool');
        } else if (evt.delta.stop_reason === 'end_turn') {
          parts.push('Agent finished its response');
        }
        break;
      case 'message_stop':
        parts.push('Agent message complete');
        break;
      case 'tool_use_start':
        parts.push(`Agent invoking tool "${evt.toolName}"`);
        break;
      case 'tool_result': {
        const outcome = evt.isError ? 'failed' : 'succeeded';
        const toolLabel = evt.toolName ? `"${evt.toolName}"` : evt.toolCallId;
        const fileSuffix = evt.filePath ? ` on ${evt.filePath}` : '';
        parts.push(`Tool ${toolLabel} ${outcome}${fileSuffix}`);
        break;
      }
      case 'tool_approval_request':
        parts.push(`Agent requesting approval: ${evt.description || evt.toolName}`);
        break;
      case 'error':
        parts.push(`Error: ${evt.error.message}`);
        break;
      case 'verification_result': {
        const status = evt.passed ? 'passed' : 'has issues';
        parts.push(`File verification for ${evt.filePath} ${status}`);
        break;
      }
      case 'story_update':
        parts.push(`Story "${evt.story.title}" updated to status: ${evt.story.status}`);
        break;
      case 'loop_event':
        parts.push(`Loop event: ${evt.event}`);
        break;
      case 'context_warning':
        parts.push(
          `Context usage at ${evt.usagePercent}%${evt.autocompacted ? ' — autocompacted' : ''}`,
        );
        break;
      case 'artifact_created':
        parts.push(`Artifact created: "${evt.artifact.title}" (${evt.artifact.type})`);
        break;
      case 'agent_note_created':
        parts.push(`Agent left a note: "${evt.note.title}"`);
        break;
      case 'ping':
        // Ignore pings
        break;
      default:
        // Catch-all for any other event types
        parts.push(`Event: ${(evt as any).type}`);
        break;
    }
  }

  // Deduplicate consecutive identical summaries (common for rapid text deltas)
  const deduped: string[] = [];
  let lastPart = '';
  for (const part of parts) {
    if (part !== lastPart) {
      deduped.push(part);
      lastPart = part;
    }
  }

  return deduped.join('\n');
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Check if commentary history is enabled for a workspace.
 * Defaults to true if not explicitly set to false.
 */
function isHistoryEnabled(workspaceId: string): boolean {
  try {
    const db = getDb();
    const workspace = db.query('SELECT settings FROM workspaces WHERE id = ?').get(workspaceId) as {
      settings: string | null;
    } | null;

    if (!workspace || !workspace.settings) return true; // Default to enabled

    const settings = JSON.parse(workspace.settings);
    // Default to true if not explicitly set to false
    return settings.commentaryHistoryEnabled !== false;
  } catch (err) {
    console.error('[commentator] Failed to check history setting:', err);
    return true; // Default to enabled on error
  }
}

/**
 * Save a commentary entry to the database.
 * Only saves if history is enabled for the workspace.
 */
function saveCommentaryToDb(commentary: StreamCommentary, conversationId: string | null): void {
  if (!isHistoryEnabled(commentary.workspaceId)) return;

  try {
    const db = getDb();
    const id = nanoid(12);
    const now = Date.now();

    db.query(
      `INSERT INTO commentary_history (id, workspace_id, conversation_id, text, personality, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      commentary.workspaceId,
      conversationId,
      commentary.text,
      commentary.personality,
      commentary.timestamp,
      now,
    );
  } catch (err) {
    // Non-critical — log and continue
    console.error('[commentator] Failed to save commentary to database:', err);
  }
}

// ---------------------------------------------------------------------------
// CommentatorService
// ---------------------------------------------------------------------------

interface WorkspaceCommentator {
  personality: CommentaryPersonality;
  /** Accumulated events in the current batch window. */
  eventBuffer: StreamEvent[];
  /** Timer for the batch window. */
  batchTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp when the current batch window started. */
  batchStartedAt: number;
  /** Whether an LLM call is in-flight (prevents overlapping calls). */
  generating: boolean;
  /** Whether this commentator is active. */
  active: boolean;
  /** Optional conversation ID for linking commentary to a conversation. */
  conversationId: string | null;
}

/** Minimum batch window — events are accumulated for at least this long. */
export const MIN_BATCH_MS = 3_000;
/** Maximum batch window — a batch is flushed at this age even if events are sparse. */
export const MAX_BATCH_MS = 5_000;
/** Haiku model identifier used for low-cost commentary generation. */
const COMMENTARY_MODEL = 'claude-haiku-4-5-20251001';
/** LLM timeout for commentary — generous but capped to keep latency reasonable. */
const COMMENTARY_TIMEOUT_MS = 15_000;

/** LLM caller function type — injectable for testing. */
export type LlmCaller = (opts: CallLlmOptions) => Promise<string>;

export class CommentatorService {
  readonly events = new EventEmitter();
  private commentators = new Map<string, WorkspaceCommentator>();
  private callLlm: LlmCaller;

  constructor(callLlmFn?: LlmCaller) {
    this.callLlm = callLlmFn ?? defaultCallLlm;
  }

  /**
   * Start (or restart) commentary for a workspace.
   * If commentary is already active for the workspace, it is stopped first.
   */
  startCommentary(
    workspaceId: string,
    personality: CommentaryPersonality,
    conversationId?: string,
  ): void {
    // Stop existing commentator if any
    this.stopCommentary(workspaceId);

    const commentator: WorkspaceCommentator = {
      personality,
      eventBuffer: [],
      batchTimer: null,
      batchStartedAt: 0,
      generating: false,
      active: true,
      conversationId: conversationId || null,
    };

    this.commentators.set(workspaceId, commentator);
    console.log(`[commentator] Started ${personality} commentary for workspace ${workspaceId}`);
  }

  /** Stop commentary for a workspace and clean up timers. */
  stopCommentary(workspaceId: string): void {
    const commentator = this.commentators.get(workspaceId);
    if (!commentator) return;

    commentator.active = false;
    if (commentator.batchTimer) {
      clearTimeout(commentator.batchTimer);
      commentator.batchTimer = null;
    }
    this.commentators.delete(workspaceId);
    console.log(`[commentator] Stopped commentary for workspace ${workspaceId}`);
  }

  /** Whether commentary is active for a workspace. */
  isActive(workspaceId: string): boolean {
    return this.commentators.has(workspaceId);
  }

  /** Get the personality for an active commentator, or undefined. */
  getPersonality(workspaceId: string): CommentaryPersonality | undefined {
    return this.commentators.get(workspaceId)?.personality;
  }

  /**
   * Feed a stream event into the commentator for a workspace.
   * Events are accumulated in a batch window (3-5s) and then processed.
   */
  pushEvent(workspaceId: string, event: StreamEvent): void {
    const commentator = this.commentators.get(workspaceId);
    if (!commentator || !commentator.active) return;

    // Skip low-signal events that don't contribute to commentary
    if (event.type === 'ping') return;

    commentator.eventBuffer.push(event);

    const now = Date.now();

    // Start a new batch window if this is the first event
    if (commentator.batchStartedAt === 0) {
      commentator.batchStartedAt = now;
    }

    // If the batch has been open for MAX_BATCH_MS, flush immediately
    const batchAge = now - commentator.batchStartedAt;
    if (batchAge >= MAX_BATCH_MS) {
      this.flushBatch(workspaceId);
      return;
    }

    // (Re)schedule flush for MIN_BATCH_MS from the batch start, capped at MAX_BATCH_MS
    if (commentator.batchTimer) {
      clearTimeout(commentator.batchTimer);
    }

    const delay = Math.min(MIN_BATCH_MS, MAX_BATCH_MS - batchAge);
    commentator.batchTimer = setTimeout(() => {
      this.flushBatch(workspaceId);
    }, delay);
  }

  /**
   * Flush the current event batch and trigger LLM commentary generation.
   * If an LLM call is already in-flight, the batch stays buffered.
   */
  private flushBatch(workspaceId: string): void {
    const commentator = this.commentators.get(workspaceId);
    if (!commentator || !commentator.active) return;

    // Clear the batch timer
    if (commentator.batchTimer) {
      clearTimeout(commentator.batchTimer);
      commentator.batchTimer = null;
    }

    // Grab the current buffer and reset
    const batch = commentator.eventBuffer;
    commentator.eventBuffer = [];
    commentator.batchStartedAt = 0;

    if (batch.length === 0) return;

    // If already generating, discard this batch to avoid queueing up
    if (commentator.generating) return;

    // Fire-and-forget the LLM call
    this.generateCommentary(workspaceId, commentator, batch);
  }

  /**
   * Generate commentary for a batch of events via LLM.
   * Emits a StreamCommentary event on success.
   */
  private async generateCommentary(
    workspaceId: string,
    commentator: WorkspaceCommentator,
    batch: StreamEvent[],
  ): Promise<void> {
    commentator.generating = true;

    try {
      const summary = summariseBatch(batch);
      if (!summary.trim()) {
        commentator.generating = false;
        return;
      }

      const systemPrompt = PERSONALITY_PROMPTS[commentator.personality];
      const userPrompt = `Here is a batch of recent activity from the AI coding agent:\n\n${summary}\n\nProvide a brief commentary on what's happening. Reply with ONLY the commentary text — no preamble, no labels.`;

      const text = await this.callLlm({
        system: systemPrompt,
        user: userPrompt,
        model: COMMENTARY_MODEL,
        timeoutMs: COMMENTARY_TIMEOUT_MS,
      });

      // Only emit if the commentator is still active (it may have been stopped while awaiting)
      if (!commentator.active) return;

      const commentary: StreamCommentary = {
        type: 'commentary',
        text: text.trim(),
        timestamp: Date.now(),
        personality: commentator.personality,
        workspaceId,
      };

      // Save to database (if history is enabled)
      saveCommentaryToDb(commentary, commentator.conversationId);

      // Emit to SSE stream
      this.events.emit('commentary', commentary);
    } catch (err) {
      // Commentary is non-critical — log and move on
      console.error(`[commentator] Failed to generate commentary for ${workspaceId}:`, err);
    } finally {
      commentator.generating = false;
    }
  }
}

// Persist across Bun --hot reloads
const GLOBAL_KEY = '__e_commentatorService';
export const commentatorService: CommentatorService =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new CommentatorService());
