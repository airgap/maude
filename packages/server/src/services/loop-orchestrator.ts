import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { claudeManager } from './claude-process';
import { runAllQualityChecks } from './quality-checker';
import type {
  LoopConfig,
  LoopState,
  LoopStatus,
  IterationLogEntry,
  QualityCheckResult,
  UserStory,
  StreamLoopEvent,
  StoryPriority,
} from '@e/shared';

// Priority ordering for story selection
const PRIORITY_ORDER: Record<StoryPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Manages the autonomous loop lifecycle. Singleton, like claudeManager.
 * Each loop run creates real E conversations and tasks for traceability.
 */
class LoopOrchestrator {
  private runners = new Map<string, LoopRunner>();
  readonly events = new EventEmitter();

  constructor() {
    // Clean up finished runners
    this.events.on('loop_done', (loopId: string) => {
      this.runners.delete(loopId);
    });

    // On startup, fix any DB state stuck from a previous server crash
    try {
      const db = getDb();
      const now = Date.now();

      // 1. Recover zombie loops (running or paused with no in-memory runner)
      const zombieLoops = db
        .query("SELECT id FROM loops WHERE status IN ('running', 'paused')")
        .all() as any[];
      for (const z of zombieLoops) {
        db.query('UPDATE loops SET status = ?, completed_at = ? WHERE id = ?').run(
          'failed',
          now,
          z.id,
        );
        console.log(`[loop] Recovered zombie loop ${z.id} → failed`);
      }

      // 2. Reset any stories stuck as 'in_progress' back to 'pending' so they
      //    can be retried when a new loop starts. Without this, the story stays
      //    in_progress forever after a server crash mid-execution.
      if (zombieLoops.length > 0) {
        const reset = db
          .query("UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE status = 'in_progress'")
          .run(now);
        if (reset.changes > 0) {
          console.log(`[loop] Reset ${reset.changes} in_progress stories → pending`);
        }
      }
    } catch {
      /* DB may not be ready yet */
    }
  }

  async startLoop(
    prdId: string | null,
    workspacePath: string,
    config: LoopConfig,
  ): Promise<string> {
    const db = getDb();
    let label: string;

    if (prdId) {
      // PRD mode: validate PRD exists and has pending stories
      const prd = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
      if (!prd) throw new Error(`PRD ${prdId} not found`);

      const storyCount = db
        .query(
          "SELECT COUNT(*) as count FROM prd_stories WHERE prd_id = ? AND status IN ('pending', 'in_progress')",
        )
        .get(prdId) as any;
      if (!storyCount || storyCount.count === 0) {
        throw new Error(
          'Cannot start loop: PRD has no pending stories. Add at least one story first.',
        );
      }
      label = `PRD: ${prd.name}`;
    } else {
      // Standalone mode: validate standalone stories exist in this workspace
      const storyCount = db
        .query(
          "SELECT COUNT(*) as count FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress')",
        )
        .get(workspacePath) as any;
      if (!storyCount || storyCount.count === 0) {
        throw new Error('Cannot start loop: No pending standalone stories in this workspace.');
      }
      label = 'Standalone stories';
    }

    const loopId = nanoid(12);
    const now = Date.now();

    // Persist loop to DB
    db.query(
      `INSERT INTO loops (id, prd_id, workspace_path, status, config, current_iteration, started_at, total_stories_completed, total_stories_failed, total_iterations, iteration_log)
       VALUES (?, ?, ?, 'running', ?, 0, ?, 0, 0, 0, '[]')`,
    ).run(loopId, prdId, workspacePath, JSON.stringify(config), now);

    const runner = new LoopRunner(loopId, prdId, workspacePath, config, this.events);
    this.runners.set(loopId, runner);

    // Start the loop asynchronously
    runner.run().catch((err) => {
      console.error(`[loop:${loopId}] Unhandled error:`, err);
      this.updateStatus(loopId, 'failed');
      this.emitEvent(loopId, 'completed', { message: `Loop failed: ${String(err)}` });
      this.runners.delete(loopId);
    });

    this.emitEvent(loopId, 'started', { message: `Loop started for ${label}` });

    return loopId;
  }

  async pauseLoop(loopId: string): Promise<void> {
    const runner = this.runners.get(loopId);
    if (!runner) {
      // No runner in memory — just update DB if it's still running
      const db = getDb();
      const row = db.query('SELECT status FROM loops WHERE id = ?').get(loopId) as any;
      if (!row) throw new Error(`Loop ${loopId} not found`);
      if (row.status !== 'running') return;
    } else {
      runner.pause();
    }
    this.updateStatus(loopId, 'paused');
    this.emitEvent(loopId, 'paused', { message: 'Loop paused' });
  }

  async resumeLoop(loopId: string): Promise<void> {
    const runner = this.runners.get(loopId);
    if (!runner) {
      const db = getDb();
      const row = db.query('SELECT status FROM loops WHERE id = ?').get(loopId) as any;
      if (!row) throw new Error(`Loop ${loopId} not found`);
      // Can't resume a zombie — it has no runner. Mark it failed.
      if (row.status === 'paused') {
        this.updateStatus(loopId, 'failed');
        this.emitEvent(loopId, 'completed', {
          message: 'Loop runner not available (server may have restarted). Please start a new loop.',
        });
        return;
      }
    } else {
      runner.resume();
    }
    this.updateStatus(loopId, 'running');
    this.emitEvent(loopId, 'resumed', { message: 'Loop resumed' });
  }

  async cancelLoop(loopId: string): Promise<void> {
    const runner = this.runners.get(loopId);
    if (runner) {
      runner.cancel();
      this.runners.delete(loopId);
    } else {
      // Runner not in memory (server restart or crash) — just update DB
      const db = getDb();
      const row = db.query('SELECT status FROM loops WHERE id = ?').get(loopId) as any;
      if (!row) throw new Error(`Loop ${loopId} not found`);
      if (row.status !== 'running' && row.status !== 'paused') {
        return; // Already terminal
      }
    }
    this.updateStatus(loopId, 'cancelled');
    this.emitEvent(loopId, 'cancelled', { message: 'Loop cancelled by user' });
  }

  getLoopState(loopId: string): LoopState | null {
    const db = getDb();
    const row = db.query('SELECT * FROM loops WHERE id = ?').get(loopId) as any;
    if (!row) return null;
    return loopFromRow(row);
  }

  listLoops(status?: string): LoopState[] {
    const db = getDb();
    let rows: any[];
    if (status) {
      rows = db.query('SELECT * FROM loops WHERE status = ? ORDER BY started_at DESC').all(status);
    } else {
      rows = db.query('SELECT * FROM loops ORDER BY started_at DESC LIMIT 50').all();
    }
    return rows.map(loopFromRow);
  }

  private updateStatus(loopId: string, status: LoopStatus): void {
    const db = getDb();
    const updates: string[] = ['status = ?'];
    const values: any[] = [status];

    if (status === 'paused') {
      updates.push('paused_at = ?');
      values.push(Date.now());
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.push('completed_at = ?');
      values.push(Date.now());
    }

    values.push(loopId);
    db.query(`UPDATE loops SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  private emitEvent(
    loopId: string,
    event: StreamLoopEvent['event'],
    data: StreamLoopEvent['data'],
  ): void {
    const evt: StreamLoopEvent = { type: 'loop_event', loopId, event, data };
    this.events.emit('loop_event', evt);
  }
}

/**
 * Drives a single loop execution. Manages the iteration cycle, story selection,
 * agent spawning, quality checks, and progress tracking.
 */
class LoopRunner {
  private cancelled = false;
  private pauseGate: { promise: Promise<void>; resolve: () => void } | null = null;

  constructor(
    private loopId: string,
    private prdId: string | null,
    private workspacePath: string,
    private config: LoopConfig,
    private events: EventEmitter,
  ) {}

  async run(): Promise<void> {
    const db = getDb();
    let iteration = 0;

    while (iteration < this.config.maxIterations && !this.cancelled) {
      // Check pause gate
      await this.checkPauseGate();
      if (this.cancelled) break;

      // Select next story
      const story = this.selectNextStory();
      if (!story) {
        // Check if all done or all failed
        const stories = this.getAllStories();
        const allCompleted = stories.every(
          (s) => s.status === 'completed' || s.status === 'skipped',
        );

        if (allCompleted) {
          this.updateLoopDb({ status: 'completed', completed_at: Date.now() });
          this.emitEvent('completed', { message: 'All stories completed!' });
          this.events.emit('loop_done', this.loopId);
          return;
        }

        // No eligible stories left (all failed/maxed out)
        this.updateLoopDb({ status: 'failed', completed_at: Date.now() });
        this.emitEvent('completed', {
          message: 'No more eligible stories. Some stories could not be completed.',
        });
        this.events.emit('loop_done', this.loopId);
        return;
      }

      iteration++;
      this.updateLoopDb({
        current_iteration: iteration,
        current_story_id: story.id,
        total_iterations: iteration,
      });

      this.emitEvent('iteration_start', {
        storyId: story.id,
        storyTitle: story.title,
        iteration,
      });

      this.addLogEntry({
        iteration,
        storyId: story.id,
        storyTitle: story.title,
        action: 'started',
        detail: `Starting story: ${story.title} (attempt ${story.attempts + 1}/${story.maxAttempts})`,
        timestamp: Date.now(),
      });

      // Mark story as in_progress
      this.updateStory(story.id, { status: 'in_progress', attempts: story.attempts + 1 });

      // Pre-generate assistant message ID for snapshot linkage
      const assistantMsgId = nanoid();

      // Create git snapshot if configured, linked to the upcoming assistant message
      if (this.config.autoSnapshot) {
        try {
          await this.createGitSnapshot(story.id, assistantMsgId);
        } catch (err) {
          console.error(`[loop:${this.loopId}] Git snapshot failed:`, err);
        }
      }

      // Create an E conversation for this story
      const conversationId = nanoid();
      const now = Date.now();
      db.query(
        `INSERT INTO conversations (id, title, model, system_prompt, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        conversationId,
        `[Loop] ${story.title}`,
        this.config.model,
        this.config.systemPromptOverride || null,
        this.workspacePath,
        now,
        now,
      );

      this.updateStory(story.id, { conversationId });

      // Emit story_started AFTER conversation creation so the client can navigate to it
      this.emitEvent('story_started', {
        storyId: story.id,
        storyTitle: story.title,
        iteration,
        conversationId,
      });

      // NOTE: Task creation side-effect removed — the story itself is now the
      // canonical work item. Previously created a `tasks` table entry here.

      // Build the prompt
      const prompt = this.buildStoryPrompt(story);

      // Add user message to conversation
      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, 'user', ?, ?)`,
      ).run(nanoid(), conversationId, JSON.stringify([{ type: 'text', text: prompt }]), now);

      // Spawn Claude session
      let agentResult = '';
      let agentError: string | null = null;
      const AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per story
      try {
        const sessionId = await claudeManager.createSession(conversationId, {
          model: this.config.model,
          workspacePath: this.workspacePath,
          effort: this.config.effort,
          systemPrompt: this.buildSystemPrompt(),
        });

        this.updateStory(story.id, { agentId: sessionId });
        this.updateLoopDb({ current_agent_id: sessionId });

        // Read the stream to completion with timeout
        const stream = await claudeManager.sendMessage(sessionId, prompt);
        const reader = stream.getReader();

        const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), AGENT_TIMEOUT_MS),
        );
        let timedOut = false;

        while (true) {
          const result = await Promise.race([reader.read(), timeoutPromise]);
          if (result.done) {
            if (!result.value && agentResult.length === 0) {
              // Timeout likely hit before any data
              timedOut = true;
            }
            break;
          }
          agentResult += new TextDecoder().decode(result.value);
          // Reset timeout awareness — we got data
        }

        if (timedOut) {
          agentError = `Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s with no output`;
          console.error(`[loop:${this.loopId}] Agent timeout for story ${story.id}`);
          try { reader.cancel(); } catch { /* best effort */ }
        }
      } catch (err) {
        agentError = String(err);
        console.error(`[loop:${this.loopId}] Agent error for story ${story.id}:`, err);
      }

      if (this.cancelled) break;

      // Run quality checks
      let qualityResults: QualityCheckResult[] = [];
      const checksToRun = this.config.qualityChecks.length > 0 ? this.config.qualityChecks : [];

      if (checksToRun.length > 0) {
        qualityResults = await runAllQualityChecks(checksToRun, this.workspacePath);

        for (const qr of qualityResults) {
          this.emitEvent('quality_check', {
            storyId: story.id,
            storyTitle: story.title,
            qualityResult: qr,
          });
          this.addLogEntry({
            iteration,
            storyId: story.id,
            storyTitle: story.title,
            action: 'quality_check',
            detail: `${qr.checkName}: ${qr.passed ? 'PASSED' : 'FAILED'} (${qr.duration}ms)`,
            timestamp: Date.now(),
            qualityResults: [qr],
          });
        }
      }

      // Determine success
      const requiredChecksFailed = qualityResults.some((qr) => {
        const checkConfig = checksToRun.find((c) => c.id === qr.checkId);
        return checkConfig?.required && !qr.passed;
      });
      const hasAgentError = !!agentError;
      const passed = !hasAgentError && !requiredChecksFailed;

      if (passed) {
        // Story succeeded!
        this.updateStory(story.id, { status: 'completed' });

        // Increment completed counter
        const loop = db.query('SELECT * FROM loops WHERE id = ?').get(this.loopId) as any;
        this.updateLoopDb({ total_stories_completed: (loop?.total_stories_completed || 0) + 1 });

        // Git commit if configured
        if (this.config.autoCommit) {
          try {
            const sha = await this.gitCommit(story);
            if (sha) {
              this.updateStory(story.id, { commitSha: sha });
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'committed',
                detail: `Committed: ${sha.slice(0, 8)}`,
                timestamp: Date.now(),
              });
            }
          } catch (err) {
            console.error(`[loop:${this.loopId}] Git commit failed:`, err);
          }
        }

        this.emitEvent('story_completed', {
          storyId: story.id,
          storyTitle: story.title,
          iteration,
          conversationId,
        });
        this.addLogEntry({
          iteration,
          storyId: story.id,
          storyTitle: story.title,
          action: 'passed',
          detail: 'Story completed successfully',
          timestamp: Date.now(),
        });

        // Record learnings from success
        this.recordLearning(story, 'Completed successfully', qualityResults);

        // External status writeback hook
        const completedStory = this.getStory(story.id);
        if (completedStory?.externalRef) {
          this.pushExternalStatus(completedStory, 'completed').catch((err) => {
            console.error(`[loop:${this.loopId}] External status push failed:`, err);
          });
        }
      } else {
        // Story failed
        const failReason = hasAgentError
          ? `Agent error: ${agentError}`
          : `Quality checks failed: ${qualityResults
              .filter((qr) => !qr.passed)
              .map((qr) => qr.checkName)
              .join(', ')}`;

        // Record learning
        this.recordLearning(story, failReason, qualityResults);

        // Check if retries exhausted
        const updatedStory = this.getStory(story.id);
        const retriesExhausted = updatedStory && updatedStory.attempts >= updatedStory.maxAttempts;

        if (retriesExhausted) {
          this.updateStory(story.id, { status: 'failed' });

          const loop = db.query('SELECT * FROM loops WHERE id = ?').get(this.loopId) as any;
          this.updateLoopDb({ total_stories_failed: (loop?.total_stories_failed || 0) + 1 });

          // External status writeback hook for failures
          const failedStory = this.getStory(story.id);
          if (failedStory?.externalRef) {
            this.pushExternalStatus(failedStory, 'failed').catch((err) => {
              console.error(`[loop:${this.loopId}] External status push failed:`, err);
            });
          }
        } else {
          // Reset to pending for retry
          this.updateStory(story.id, { status: 'pending' });
        }

        this.emitEvent('story_failed', {
          storyId: story.id,
          storyTitle: story.title,
          iteration,
          conversationId,
          message: failReason,
          willRetry: !retriesExhausted,
        });
        this.addLogEntry({
          iteration,
          storyId: story.id,
          storyTitle: story.title,
          action: 'failed',
          detail: failReason,
          timestamp: Date.now(),
          qualityResults,
        });

        // Pause on failure if configured
        if (this.config.pauseOnFailure) {
          this.pause();
          this.updateLoopDb({ status: 'paused', paused_at: Date.now() });
          this.emitEvent('paused', { message: `Paused: story "${story.title}" failed` });
          await this.checkPauseGate();
          if (this.cancelled) break;
          this.updateLoopDb({ status: 'running' });
        }
      }

      this.emitEvent('iteration_end', { storyId: story.id, storyTitle: story.title, iteration });

      // Small delay between iterations
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (this.cancelled) {
      this.updateLoopDb({ status: 'cancelled', completed_at: Date.now() });
      this.events.emit('loop_done', this.loopId);
      return;
    }

    // Max iterations reached — check final state
    const finalStories = this.getAllStories();
    const allDone = finalStories.every((s) => s.status === 'completed' || s.status === 'skipped');

    if (allDone) {
      this.updateLoopDb({ status: 'completed', completed_at: Date.now() });
      this.emitEvent('completed', { message: 'All stories completed!' });
    } else {
      this.updateLoopDb({ status: 'failed', completed_at: Date.now() });
      this.emitEvent('completed', {
        message: `Max iterations (${this.config.maxIterations}) reached. Some stories remain incomplete.`,
      });
    }

    // Clean up — the orchestrator will remove us from the runners Map
    // via the 'loop_done' event handler
    this.events.emit('loop_done', this.loopId);
  }

  // --- Story selection ---

  private selectNextStory(): UserStory | null {
    const stories = this.getAllStories();
    const completedIds = new Set(stories.filter((s) => s.status === 'completed').map((s) => s.id));

    const eligible = stories.filter((s) => {
      if (s.status !== 'pending') return false;
      if (s.attempts >= s.maxAttempts) return false;
      // Check dependencies resolved
      const deps = s.dependsOn || [];
      return deps.every((depId) => completedIds.has(depId));
    });

    if (eligible.length === 0) return null;

    // Sort by priority
    eligible.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.sortOrder - b.sortOrder;
    });

    return eligible[0];
  }

  // --- Prompt building ---

  private buildSystemPrompt(): string {
    let prompt = `You are an autonomous AI agent implementing user stories for a software project.

## Instructions
1. Read the user story carefully, including all acceptance criteria
2. Implement the story completely — make all necessary code changes
3. Ensure every acceptance criterion is met
4. Follow existing project conventions and patterns
5. Write clean, well-structured code
6. Do NOT ask questions — make reasonable decisions and document them
7. After implementation, the system will automatically run quality checks`;

    // Add project memory context
    try {
      const db = getDb();
      const memories = db
        .query(
          `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 50`,
        )
        .all(this.workspacePath) as any[];

      if (memories.length > 0) {
        const grouped: Record<string, string[]> = {};
        for (const m of memories) {
          if (!grouped[m.category]) grouped[m.category] = [];
          grouped[m.category].push(`- ${m.key}: ${m.content}`);
        }

        prompt += '\n\n## Project Memory\n';
        const labels: Record<string, string> = {
          convention: 'Coding Conventions',
          decision: 'Architecture Decisions',
          preference: 'User Preferences',
          pattern: 'Common Patterns',
          context: 'Project Context',
        };
        for (const [cat, items] of Object.entries(grouped)) {
          prompt += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
        }
      }
    } catch {
      /* no project memory available */
    }

    return prompt;
  }

  private buildStoryPrompt(story: UserStory): string {
    const criteria = story.acceptanceCriteria
      .map((ac, i) => `${i + 1}. ${ac.description}`)
      .join('\n');

    let prompt = `## User Story: ${story.title}

${story.description}

## Acceptance Criteria
${criteria}

## Attempt ${story.attempts + 1} of ${story.maxAttempts}`;

    // Add learnings from previous attempts
    if (story.learnings.length > 0) {
      prompt += '\n\n## Learnings from Previous Attempts\n';
      for (const learning of story.learnings) {
        prompt += `- ${learning}\n`;
      }
      prompt += '\nPlease address these issues in this attempt. Do not repeat the same mistakes.';
    }

    // Add progress context
    const stories = this.getAllStories();
    const completed = stories.filter((s) => s.status === 'completed');
    const remaining = stories.filter((s) => s.status === 'pending' || s.status === 'in_progress');

    prompt += `\n\n## Project Progress
- Completed: ${completed.length} of ${stories.length} stories
- Remaining: ${remaining.length} stories (including this one)`;

    if (completed.length > 0) {
      prompt += '\n\nAlready completed:';
      for (const cs of completed) {
        prompt += `\n- ✅ ${cs.title}`;
      }
    }

    return prompt;
  }

  // --- Helpers ---

  private getAllStories(): UserStory[] {
    const db = getDb();
    let rows: any[];
    if (this.prdId) {
      rows = db
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
        .all(this.prdId) as any[];
    } else {
      // Standalone mode: get stories with no PRD in this workspace
      rows = db
        .query(
          'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC',
        )
        .all(this.workspacePath) as any[];
    }
    return rows.map(storyFromRow);
  }

  private getStory(storyId: string): UserStory | null {
    const db = getDb();
    const row = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
    return row ? storyFromRow(row) : null;
  }

  /** Push status back to external provider (Jira/Linear/Asana) if story has an externalRef */
  private async pushExternalStatus(
    story: UserStory,
    status: 'completed' | 'failed',
  ): Promise<void> {
    if (!story.externalRef) return;

    const { getProviderConfig, getExternalProvider } = await import('./external-providers');
    const config = getProviderConfig(story.externalRef.provider);
    if (!config) return; // provider not configured, skip silently

    const provider = getExternalProvider(story.externalRef.provider);
    await provider.pushStatus(config, story.externalRef.externalId, status, {
      commitSha: story.commitSha,
      comment:
        status === 'completed'
          ? `Implemented automatically by E. Commit: ${story.commitSha || 'N/A'}`
          : `Automatic implementation failed after ${story.attempts} attempt(s).`,
    });

    // Update syncedAt
    const db = getDb();
    const updatedRef = { ...story.externalRef, syncedAt: Date.now() };
    db.query('UPDATE prd_stories SET external_ref = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(updatedRef),
      Date.now(),
      story.id,
    );
  }

  private updateStory(storyId: string, updates: Record<string, any>): void {
    const db = getDb();
    const fieldMap: Record<string, string> = {
      status: 'status',
      taskId: 'task_id',
      agentId: 'agent_id',
      conversationId: 'conversation_id',
      commitSha: 'commit_sha',
      attempts: 'attempts',
    };

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const col = fieldMap[key] || key;
      setClauses.push(`${col} = ?`);
      values.push(value);
    }

    setClauses.push('updated_at = ?');
    values.push(Date.now());
    values.push(storyId);

    db.query(`UPDATE prd_stories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  private updateLoopDb(updates: Record<string, any>): void {
    const db = getDb();
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }

    values.push(this.loopId);
    db.query(`UPDATE loops SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  private addLogEntry(entry: IterationLogEntry): void {
    const db = getDb();
    const row = db.query('SELECT iteration_log FROM loops WHERE id = ?').get(this.loopId) as any;
    const log: IterationLogEntry[] = JSON.parse(row?.iteration_log || '[]');
    log.push(entry);
    db.query('UPDATE loops SET iteration_log = ? WHERE id = ?').run(
      JSON.stringify(log),
      this.loopId,
    );
  }

  private recordLearning(
    story: UserStory,
    summary: string,
    qualityResults: QualityCheckResult[],
  ): void {
    const failedChecks = qualityResults.filter((qr) => !qr.passed);
    let learning = summary;
    if (failedChecks.length > 0) {
      learning += `. Failed checks: ${failedChecks.map((qr) => `${qr.checkName} (${qr.output.slice(0, 200)})`).join('; ')}`;
    }

    // Append to story learnings
    const db = getDb();
    const row = db.query('SELECT learnings FROM prd_stories WHERE id = ?').get(story.id) as any;
    const learnings: string[] = JSON.parse(row?.learnings || '[]');
    learnings.push(learning);
    db.query('UPDATE prd_stories SET learnings = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(learnings),
      Date.now(),
      story.id,
    );

    // Also store in project memory for cross-loop persistence
    try {
      const memKey = `loop-learning:${story.title.slice(0, 60)}`;
      const existing = db
        .query('SELECT * FROM workspace_memories WHERE workspace_path = ? AND key = ?')
        .get(this.workspacePath, memKey) as any;

      if (existing) {
        db.query(
          'UPDATE workspace_memories SET content = ?, times_seen = times_seen + 1, updated_at = ? WHERE id = ?',
        ).run(learning.slice(0, 500), Date.now(), existing.id);
      } else {
        db.query(
          `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at)
           VALUES (?, ?, 'context', ?, ?, 'auto', 0.6, 1, ?, ?)`,
        ).run(nanoid(), this.workspacePath, memKey, learning.slice(0, 500), Date.now(), Date.now());
      }
    } catch {
      /* non-critical */
    }

    this.emitEvent('learning', {
      storyId: story.id,
      storyTitle: story.title,
      learning,
    });
  }

  // --- Git operations ---

  private async createGitSnapshot(storyId: string, messageId?: string): Promise<void> {
    try {
      const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
      if (!isRepo) return;

      const headProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const headSha = (await new Response(headProc.stdout).text()).trim();
      if ((await headProc.exited) !== 0) return;

      const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const statusOutput = (await new Response(statusProc.stdout).text()).trim();
      const hasChanges = statusOutput.length > 0;

      let stashSha: string | null = null;
      if (hasChanges) {
        const stashProc = Bun.spawn(['git', 'stash', 'create'], {
          cwd: this.workspacePath,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        stashSha = (await new Response(stashProc.stdout).text()).trim() || null;
      }

      const db = getDb();
      db.query(
        `INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        nanoid(),
        this.workspacePath,
        headSha,
        stashSha,
        `loop:${this.loopId}:story:${storyId}`,
        hasChanges ? 1 : 0,
        messageId || null,
        Date.now(),
      );
    } catch (err) {
      console.error(`[loop:${this.loopId}] Git snapshot failed:`, err);
    }
  }

  private async gitCommit(story: UserStory): Promise<string | null> {
    try {
      // Stage all changes
      const addProc = Bun.spawn(['git', 'add', '-A'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await addProc.exited;

      // Check if there are staged changes
      const diffProc = Bun.spawn(['git', 'diff', '--cached', '--quiet'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const diffExit = await diffProc.exited;
      if (diffExit === 0) return null; // No changes to commit

      // Commit
      const msg = this.prdId
        ? `[loop] ${story.title}\n\nImplemented by E autonomous loop.\nPRD: ${this.prdId}\nStory: ${story.id}`
        : `[loop] ${story.title}\n\nImplemented by E autonomous loop.\nStory: ${story.id}`;
      const commitProc = Bun.spawn(['git', 'commit', '-m', msg], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await commitProc.exited;

      // Get commit SHA
      const shaProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const sha = (await new Response(shaProc.stdout).text()).trim();

      return sha;
    } catch (err) {
      console.error(`[loop:${this.loopId}] Git commit failed:`, err);
      return null;
    }
  }

  // --- Pause/Resume/Cancel ---

  pause(): void {
    let resolve: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.pauseGate = { promise, resolve: resolve! };
  }

  resume(): void {
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
  }

  cancel(): void {
    this.cancelled = true;
    // Also resolve pause gate if paused
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
  }

  private async checkPauseGate(): Promise<void> {
    if (this.pauseGate) {
      await this.pauseGate.promise;
    }
  }

  private emitEvent(event: StreamLoopEvent['event'], data: StreamLoopEvent['data']): void {
    const evt: StreamLoopEvent = { type: 'loop_event', loopId: this.loopId, event, data };
    this.events.emit('loop_event', evt);
  }
}

// --- Row mappers ---

function storyFromRow(row: any): UserStory {
  return {
    id: row.id,
    prdId: row.prd_id || null,
    workspacePath: row.workspace_path || undefined,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria || '[]'),
    priority: row.priority,
    dependsOn: JSON.parse(row.depends_on || '[]'),
    dependencyReasons: JSON.parse(row.dependency_reasons || '{}'),
    status: row.status,
    taskId: row.task_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    commitSha: row.commit_sha,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    learnings: JSON.parse(row.learnings || '[]'),
    externalRef: row.external_ref ? JSON.parse(row.external_ref) : undefined,
    externalStatus: row.external_status || undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loopFromRow(row: any): LoopState {
  return {
    id: row.id,
    prdId: row.prd_id || null,
    workspacePath: row.workspace_path,
    status: row.status,
    config: JSON.parse(row.config || '{}'),
    currentIteration: row.current_iteration,
    currentStoryId: row.current_story_id,
    currentAgentId: row.current_agent_id,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
    totalStoriesCompleted: row.total_stories_completed,
    totalStoriesFailed: row.total_stories_failed,
    totalIterations: row.total_iterations,
    iterationLog: JSON.parse(row.iteration_log || '[]'),
  };
}

export const loopOrchestrator = new LoopOrchestrator();
