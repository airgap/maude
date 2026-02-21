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
  AgentNote,
  StreamAgentNoteCreated,
} from '@e/shared';

// Priority ordering for story selection
const PRIORITY_ORDER: Record<StoryPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Manages the Golem lifecycle. Singleton, like claudeManager.
 * Each loop run creates real E conversations and tasks for traceability.
 */
class LoopOrchestrator {
  private runners = new Map<string, LoopRunner>();
  readonly events = new EventEmitter();
  private zombieCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up finished runners
    this.events.on('loop_done', (loopId: string) => {
      this.runners.delete(loopId);
    });

    // On startup, recover or resume any orphaned loops from a previous server crash / hot reload
    this.recoverOrResumeZombieLoops();

    // Periodically check for zombie loops (runner died without updating DB)
    this.zombieCheckInterval = setInterval(() => this.recoverZombieLoops(), 30_000);
  }

  /**
   * On startup (including hot reload), detect orphaned running loops and
   * automatically resume them instead of marking them failed. This ensures
   * loops survive Bun --hot reloads transparently.
   */
  private recoverOrResumeZombieLoops(): void {
    try {
      const db = getDb();
      const activeLoops = db
        .query("SELECT * FROM loops WHERE status IN ('running', 'paused')")
        .all() as any[];

      for (const row of activeLoops) {
        if (this.runners.has(row.id)) continue; // Already has a runner

        // Check if there are still pending stories to work on
        let hasPendingWork = false;
        if (row.prd_id) {
          const count = db
            .query(
              "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
            )
            .get(row.prd_id) as any;
          hasPendingWork = count && count.c > 0;
        } else {
          const count = db
            .query(
              "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
            )
            .get(row.workspace_path) as any;
          hasPendingWork = count && count.c > 0;
        }

        if (hasPendingWork && row.status === 'running') {
          // Auto-resume: create a new runner to continue this loop
          console.log(`[loop] Auto-resuming orphaned loop ${row.id} (hot reload recovery)`);
          // Reset any in_progress stories back to pending — but only for THIS loop's PRD/workspace
          // to avoid clobbering other running loops' story states.
          const prdId = row.prd_id;
          if (prdId) {
            db.query(
              "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id = ? AND status = 'in_progress'",
            ).run(Date.now(), prdId);
          } else {
            db.query(
              "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'in_progress'",
            ).run(Date.now(), row.workspace_path);
          }

          const config: LoopConfig = JSON.parse(row.config || '{}');
          const runner = new LoopRunner(
            row.id,
            row.prd_id || null,
            row.workspace_path,
            config,
            this.events,
          );
          this.runners.set(row.id, runner);

          runner.run().catch((err) => {
            console.error(`[loop:${row.id}] Resumed runner error:`, err);
            this.updateStatus(row.id, 'failed');
            this.emitEvent(row.id, 'failed', {
              message: `Loop failed after resume: ${String(err)}`,
            });
            this.events.emit('loop_done', row.id);
          });
        } else {
          // No pending work or paused — just mark as failed/completed
          const newStatus = hasPendingWork ? 'failed' : 'completed';
          db.query('UPDATE loops SET status = ?, completed_at = ? WHERE id = ?').run(
            newStatus,
            Date.now(),
            row.id,
          );
          console.log(`[loop] Recovered zombie loop ${row.id} → ${newStatus}`);
          this.emitEvent(row.id, newStatus as StreamLoopEvent['event'], {
            message:
              newStatus === 'completed'
                ? 'All stories completed!'
                : 'Loop runner lost. Please start a new loop.',
          });
          this.events.emit('loop_done', row.id);
        }
      }
    } catch (err) {
      console.error('[loop] Startup recovery failed:', err);
    }
  }

  /** How long a runner can go without a heartbeat before being considered dead. */
  private static HEARTBEAT_STALE_MS = 90_000; // 90 seconds

  /** Find loops marked running/paused in DB that have no in-memory runner
   *  (or whose heartbeat is stale) and mark them failed. */
  private recoverZombieLoops(): void {
    try {
      const db = getDb();
      const now = Date.now();

      const activeLoops = db
        .query("SELECT id, last_heartbeat FROM loops WHERE status IN ('running', 'paused')")
        .all() as any[];

      const zombieLoops = activeLoops.filter((z) => {
        // No runner in memory → definitely a zombie
        if (!this.runners.has(z.id)) return true;
        // Runner exists but heartbeat is stale → runner is stuck/dead
        if (z.last_heartbeat && now - z.last_heartbeat > LoopOrchestrator.HEARTBEAT_STALE_MS) {
          console.log(
            `[loop] Runner for ${z.id} has stale heartbeat (${Math.round((now - z.last_heartbeat) / 1000)}s ago)`,
          );
          this.runners.delete(z.id);
          return true;
        }
        return false;
      });

      for (const z of zombieLoops) {
        db.query('UPDATE loops SET status = ?, completed_at = ? WHERE id = ?').run(
          'failed',
          now,
          z.id,
        );
        console.log(`[loop] Recovered zombie loop ${z.id} → failed`);
        // Notify any connected SSE clients so UI updates immediately
        this.emitEvent(z.id, 'failed', {
          message: 'Loop runner lost (process may have crashed). Please start a new loop.',
        });
        this.events.emit('loop_done', z.id);
      }

      // Reset in_progress stories belonging to zombie loops back to 'pending'
      // so they can be retried when a new loop starts.
      // IMPORTANT: Only reset stories for zombie loops — a global reset would
      // interfere with actively-running loops' current stories.
      for (const z of zombieLoops) {
        const zombieLoop = db
          .query('SELECT prd_id, workspace_path FROM loops WHERE id = ?')
          .get(z.id) as any;
        if (!zombieLoop) continue;

        let reset;
        if (zombieLoop.prd_id) {
          reset = db
            .query(
              "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id = ? AND status = 'in_progress'",
            )
            .run(now, zombieLoop.prd_id);
        } else {
          reset = db
            .query(
              "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'in_progress'",
            )
            .run(now, zombieLoop.workspace_path);
        }
        if (reset.changes > 0) {
          console.log(
            `[loop] Reset ${reset.changes} in_progress stories → pending for zombie loop ${z.id}`,
          );
        }
      }
    } catch (err) {
      console.error('[loop] Zombie recovery failed:', err);
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
          "SELECT COUNT(*) as count FROM prd_stories WHERE prd_id = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
        )
        .get(prdId) as any;
      if (!storyCount || storyCount.count === 0) {
        throw new Error(
          'Cannot activate Golem: PRD has no pending stories. Add at least one story first.',
        );
      }
      label = `PRD: ${prd.name}`;
    } else {
      // Standalone mode: validate standalone stories exist in this workspace
      const storyCount = db
        .query(
          "SELECT COUNT(*) as count FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
        )
        .get(workspacePath) as any;
      if (!storyCount || storyCount.count === 0) {
        throw new Error('Cannot activate Golem: No pending standalone stories in this workspace.');
      }
      label = 'Standalone stories';
    }

    // Refuse to start if the working tree has uncommitted changes.
    // Dirty state causes cascading quality-check failures — one story's
    // leftover changes break every subsequent story's build.
    await this.ensureCleanWorkingTree(workspacePath);

    const loopId = nanoid(12);
    const now = Date.now();

    // Persist loop to DB
    db.query(
      `INSERT INTO loops (id, prd_id, workspace_path, status, config, current_iteration, started_at, total_stories_completed, total_stories_failed, total_iterations, iteration_log, last_heartbeat)
       VALUES (?, ?, ?, 'running', ?, 0, ?, 0, 0, 0, '[]', ?)`,
    ).run(loopId, prdId, workspacePath, JSON.stringify(config), now, now);

    const runner = new LoopRunner(loopId, prdId, workspacePath, config, this.events);
    this.runners.set(loopId, runner);

    // Start the loop asynchronously
    runner.run().catch((err) => {
      console.error(`[loop:${loopId}] Unhandled error:`, err);
      this.updateStatus(loopId, 'failed');
      this.emitEvent(loopId, 'failed', { message: `Loop failed: ${String(err)}` });
      this.events.emit('loop_done', loopId);
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
        this.emitEvent(loopId, 'failed', {
          message:
            'Loop runner not available (server may have restarted). Please start a new loop.',
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
    // Detect zombie on read: DB says active but no runner exists
    if ((row.status === 'running' || row.status === 'paused') && !this.runners.has(loopId)) {
      this.recoverZombieLoops();
      // Re-read after recovery
      const fresh = db.query('SELECT * FROM loops WHERE id = ?').get(loopId) as any;
      return fresh ? loopFromRow(fresh) : null;
    }
    return loopFromRow(row);
  }

  listLoops(status?: string): LoopState[] {
    const db = getDb();
    // Eagerly recover zombies before listing so callers always see accurate state
    if (!status || status === 'running' || status === 'paused') {
      this.recoverZombieLoops();
    }
    let rows: any[];
    if (status) {
      rows = db.query('SELECT * FROM loops WHERE status = ? ORDER BY started_at DESC').all(status);
    } else {
      rows = db.query('SELECT * FROM loops ORDER BY started_at DESC LIMIT 50').all();
    }
    return rows.map(loopFromRow);
  }

  /**
   * Refuse to start a loop if git reports uncommitted changes.
   * Dirty working trees cause cascading quality-check failures.
   */
  private async ensureCleanWorkingTree(workspacePath: string): Promise<void> {
    try {
      const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
        cwd: workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
      if (!isRepo) return; // Not a git repo — nothing to check

      const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
        cwd: workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = (await new Response(statusProc.stdout).text()).trim();
      if (output.length > 0) {
        const changedFiles = output.split('\n').length;
        throw new Error(
          `Cannot activate Golem: working tree has ${changedFiles} uncommitted change${changedFiles === 1 ? '' : 's'}. ` +
            `Please commit or stash your changes first. Dirty state causes cascading build failures across stories.`,
        );
      }
    } catch (err) {
      // Re-throw our own Error, but swallow git failures (e.g. git not installed)
      if (err instanceof Error && err.message.startsWith('Cannot activate Golem:')) {
        throw err;
      }
      console.warn(`[loop] ensureCleanWorkingTree check failed (non-fatal):`, err);
    }
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
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Tracks per-story fix-up state. When a story fails quality checks, we keep
   * the broken code in place and give the agent multiple chances to fix it
   * surgically ("fix-up" passes) before reverting and starting a fresh attempt.
   *
   * Each fresh attempt gets up to `config.maxFixUpAttempts` sub-attempts.
   * Fix-up passes do NOT consume the story's main attempt counter.
   *
   * Map key: story ID
   * Map value: { subAttempts count, lastResults from most recent failure }
   */
  private fixUpState = new Map<
    string,
    { subAttempts: number; lastResults: QualityCheckResult[] }
  >();

  constructor(
    private loopId: string,
    private prdId: string | null,
    private workspacePath: string,
    private config: LoopConfig,
    private events: EventEmitter,
  ) {}

  /** Update heartbeat timestamp so zombie recovery knows we're alive. */
  private sendHeartbeat(): void {
    try {
      const db = getDb();
      db.query('UPDATE loops SET last_heartbeat = ? WHERE id = ?').run(Date.now(), this.loopId);
    } catch {
      /* best effort */
    }
  }

  /** Start periodic heartbeat (every 15s). */
  private startHeartbeat(): void {
    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 15_000);
  }

  /** Stop periodic heartbeat. */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async run(): Promise<void> {
    const db = getDb();
    let iteration = 0;
    let noStoryNullCount = 0; // Tracks consecutive times selectNextStory returned null
    const mode = this.prdId ? `PRD:${this.prdId}` : 'standalone';

    console.log(
      `[loop:${this.loopId}] Starting ${mode} loop (maxIter=${this.config.maxIterations})`,
    );

    this.startHeartbeat();

    // Apply maxAttemptsPerStory from loop config to all stories.
    // Stories have their own max_attempts (default 3), but the loop config
    // should override this so the user's setting actually takes effect.
    this.applyMaxAttemptsConfig();

    // Ensure maxIterations is large enough to actually complete all stories.
    // Each story may need up to maxAttemptsPerStory fresh starts, and each
    // fresh start may need up to (1 + maxFixUpAttempts) iterations (the initial
    // attempt plus fix-up passes). Auto-increase if the budget is too low.
    const stories = this.getAllStories();
    const nonTerminalStories = stories.filter(
      (s) => s.status !== 'completed' && s.status !== 'skipped' && !s.researchOnly,
    );
    const maxAttempts = this.config.maxAttemptsPerStory || 3;
    const maxFixUps = this.config.maxFixUpAttempts ?? 2;
    const iterationsPerAttempt = 1 + maxFixUps; // initial + fix-ups
    const minIterationsNeeded = nonTerminalStories.length * maxAttempts * iterationsPerAttempt;
    if (this.config.maxIterations < minIterationsNeeded) {
      console.log(
        `[loop:${this.loopId}] Auto-increasing maxIterations from ${this.config.maxIterations} to ${minIterationsNeeded} (${nonTerminalStories.length} stories × ${maxAttempts} attempts × ${iterationsPerAttempt} iterations/attempt)`,
      );
      this.config.maxIterations = minIterationsNeeded;
    }

    try {
      while (iteration < this.config.maxIterations && !this.cancelled) {
        // Check pause gate
        await this.checkPauseGate();
        if (this.cancelled) break;

        // Update heartbeat at the start of each iteration
        this.sendHeartbeat();

        // Recover any orphaned in_progress stories before selecting next.
        // Wrapped in try/catch so a transient DB issue doesn't crash the loop.
        try {
          this.recoverOrphanedStories();
        } catch (recoverErr) {
          console.error(
            `[loop:${this.loopId}] recoverOrphanedStories() failed (non-fatal):`,
            recoverErr,
          );
        }

        // Select next story.
        // If selectNextStory() returns null, it could be a transient issue (e.g. the
        // previous story's status update hasn't settled). Retry once after a brief
        // delay before deciding the loop is truly done.
        let story: UserStory | null = null;
        try {
          story = this.selectNextStory();
        } catch (selectErr) {
          console.error(`[loop:${this.loopId}] selectNextStory() threw:`, selectErr);
          // Wait and retry once — if it fails again we'll handle it in the next iteration
          await new Promise((r) => setTimeout(r, 2000));
          try {
            story = this.selectNextStory();
          } catch (retryErr) {
            console.error(`[loop:${this.loopId}] selectNextStory() retry also failed:`, retryErr);
            // Continue to next iteration — the while condition may still allow us to try again
            continue;
          }
        }

        if (!story) {
          // No story selected. Before giving up, wait briefly and retry once.
          // This handles the race where a story was just marked completed but the
          // DB read for the next story happens before the write is visible (unlikely
          // in SQLite, but defensive against other transient issues).
          await new Promise((r) => setTimeout(r, 1000));
          try {
            story = this.selectNextStory();
          } catch {
            /* handled below */
          }
        }

        if (!story) {
          // Wrap exit-path logic in try/catch — an unhandled error here (e.g. from
          // getAllStories() or storyFromRow() JSON parsing) would crash the entire
          // loop, which was the root cause of silent loop termination after one story.
          let stories: UserStory[] = [];
          try {
            stories = this.getAllStories();
          } catch (exitErr) {
            console.error(
              `[loop:${this.loopId}] getAllStories() threw in exit path (non-fatal):`,
              exitErr,
            );
            // Transient DB error — retry on next iteration instead of crashing
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          console.log(
            `[loop:${this.loopId}] No eligible story. ${stories.length} total stories: ${stories.map((s) => `${s.title}[${s.status}:${s.attempts}/${s.maxAttempts}${s.researchOnly ? ':research' : ''}]`).join(', ')}`,
          );

          // Guard: empty stories array means the query returned nothing (possibly
          // a workspace_path mismatch or DB transient issue). [].every() returns
          // true which would incorrectly mark the loop as "completed".
          if (stories.length === 0) {
            // Retry a few times before giving up — the stories might reappear
            // (e.g. after a concurrent workspace_path update settles).
            noStoryNullCount++;
            if (noStoryNullCount < 3) {
              console.warn(
                `[loop:${this.loopId}] getAllStories() returned empty (attempt ${noStoryNullCount}/3). Retrying...`,
              );
              await new Promise((r) => setTimeout(r, 3000));
              continue;
            }
            console.warn(
              `[loop:${this.loopId}] getAllStories() returned empty after ${noStoryNullCount} attempts — cannot determine loop state. Marking as failed.`,
            );
            this.updateLoopDb({
              status: 'failed',
              completed_at: Date.now(),
              current_story_id: null,
              current_agent_id: null,
            });
            this.emitEvent('failed', {
              message:
                'No stories found. They may have been deleted or the workspace path changed.',
            });
            this.events.emit('loop_done', this.loopId);
            return;
          }

          const allCompleted = stories.every(
            (s) => s.status === 'completed' || s.status === 'skipped' || s.researchOnly,
          );

          if (allCompleted) {
            this.updateLoopDb({
              status: 'completed',
              completed_at: Date.now(),
              current_story_id: null,
              current_agent_id: null,
            });
            this.emitEvent('completed', { message: 'All stories completed!' });
            this.events.emit('loop_done', this.loopId);
            return;
          }

          // Check if any stories are still in_progress (shouldn't happen after recovery, but guard)
          const hasInProgress = stories.some((s) => s.status === 'in_progress');
          if (hasInProgress) {
            console.warn(
              `[loop:${this.loopId}] Stories still in_progress after recovery — forcing reset`,
            );
            for (const s of stories.filter((s) => s.status === 'in_progress')) {
              if (s.attempts >= s.maxAttempts) {
                this.updateStory(s.id, { status: 'failed' });
              } else {
                this.updateStory(s.id, { status: 'pending' });
              }
            }
            // Retry selection after forced reset
            continue;
          }

          // Check if there are pending stories that SHOULD be eligible (no unmet deps,
          // attempts < maxAttempts, not researchOnly). If selectNextStory() returned
          // null but these exist, it's a transient issue — retry instead of quitting.
          const pendingEligible = stories.filter(
            (s) =>
              s.status === 'pending' &&
              s.attempts < s.maxAttempts &&
              !s.researchOnly &&
              (s.dependsOn || []).every((depId) =>
                stories.some((d) => d.id === depId && d.status === 'completed'),
              ),
          );
          if (pendingEligible.length > 0) {
            noStoryNullCount++;
            console.warn(
              `[loop:${this.loopId}] selectNextStory() returned null but ${pendingEligible.length} pending eligible stories exist (null-streak ${noStoryNullCount}): ${pendingEligible.map((s) => `"${s.title}"[attempts=${s.attempts}/${s.maxAttempts}]`).join(', ')}. Retrying...`,
            );
            // Brief delay then retry on next iteration
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          // Check if there are pending stories with unmet dependencies — they're
          // not eligible yet but may become eligible as other stories complete.
          // However, since no eligible stories exist to unblock them, this is a deadlock.
          const hasPendingWithDeps = stories.some(
            (s) =>
              s.status === 'pending' &&
              s.attempts < s.maxAttempts &&
              !s.researchOnly &&
              (s.dependsOn || []).length > 0,
          );
          if (hasPendingWithDeps) {
            console.warn(
              `[loop:${this.loopId}] Pending stories exist with unmet dependencies — cannot proceed. Marking loop as failed.`,
            );
          }

          // No eligible stories left (all failed/maxed out or blocked by deps)
          this.updateLoopDb({
            status: 'failed',
            completed_at: Date.now(),
            current_story_id: null,
            current_agent_id: null,
          });
          this.emitEvent('failed', {
            message: 'No more eligible stories. Some stories could not be completed.',
          });
          this.events.emit('loop_done', this.loopId);
          return;
        }

        // Story selected — reset the null-streak counter
        noStoryNullCount = 0;

        iteration++;
        console.log(
          `[loop:${this.loopId}] Iteration ${iteration}: "${story.title}" (attempt ${story.attempts + 1}/${story.maxAttempts})`,
        );

        try {
          // === Begin iteration try block ===
          const checksToRun = this.config.qualityChecks.filter((c) => c.enabled);

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

          const isStoryFixUp = this.fixUpState.has(story.id);
          const fixUpInfo = isStoryFixUp ? this.fixUpState.get(story.id)! : null;
          const maxFixUps = this.config.maxFixUpAttempts ?? 2;
          this.addLogEntry({
            iteration,
            storyId: story.id,
            storyTitle: story.title,
            action: 'started',
            detail: isStoryFixUp
              ? `Fix-up pass ${fixUpInfo!.subAttempts}/${maxFixUps} for: ${story.title} (attempt ${story.attempts}/${story.maxAttempts}) — fixing errors in-place`
              : `Starting story: ${story.title} (attempt ${story.attempts + 1}/${story.maxAttempts})`,
            timestamp: Date.now(),
          });

          // Mark story as in_progress.
          // Only increment the attempt counter on fresh starts, NOT fix-up passes.
          // Fix-ups are sub-attempts within a single main attempt.
          if (isStoryFixUp) {
            this.updateStory(story.id, { status: 'in_progress' });
          } else {
            this.updateStory(story.id, { status: 'in_progress', attempts: story.attempts + 1 });
          }

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

          // Pre-story quality gate: if the build is already broken (e.g. from a
          // previous story's uncommitted failure), clean the working tree before
          // the agent starts. This prevents cascading failures where story B gets
          // blamed for story A's broken code.
          //
          // EXCEPTION: skip this gate when we intentionally kept broken code for a
          // fix-up pass on this same story — the agent needs that code in-place.
          const isFixUpPass = this.fixUpState.has(story.id);
          if (checksToRun.length > 0 && !isFixUpPass) {
            const preCheckResults = await runAllQualityChecks(checksToRun, this.workspacePath);
            const preBuildBroken = preCheckResults.some((qr) => {
              const cfg = checksToRun.find((c) => c.id === qr.checkId);
              return cfg?.required && !qr.passed;
            });
            if (preBuildBroken) {
              console.warn(
                `[loop:${this.loopId}] Pre-story quality gate failed — build is already broken. Reverting uncommitted changes.`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Pre-story gate: build already broken, reverting uncommitted changes`,
                timestamp: Date.now(),
                qualityResults: preCheckResults,
              });
              await this.revertUncommittedChanges();
            }
          } else if (isFixUpPass) {
            console.log(
              `[loop:${this.loopId}] Skipping pre-story quality gate — fix-up pass for "${story.title}"`,
            );
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
              try {
                reader.cancel();
              } catch {
                /* best effort */
              }
            }
          } catch (err) {
            agentError = String(err);
            console.error(`[loop:${this.loopId}] Agent error for story ${story.id}:`, err);
          }

          if (this.cancelled) break;

          // Run quality checks
          let qualityResults: QualityCheckResult[] = [];

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
            // Story succeeded! Clear any fix-up state if it was a fix-up pass.
            this.fixUpState.delete(story.id);
            this.updateStory(story.id, { status: 'completed' });

            // Increment completed counter
            const loop = db.query('SELECT * FROM loops WHERE id = ?').get(this.loopId) as any;
            this.updateLoopDb({
              total_stories_completed: (loop?.total_stories_completed || 0) + 1,
            });

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

            // Create agent note with report for the user
            this.createAgentNote(story, conversationId, 'completed', agentResult, qualityResults);

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

            // Create agent note with failure report for the user
            this.createAgentNote(
              story,
              conversationId,
              'failed',
              agentResult,
              qualityResults,
              failReason,
            );

            // --- Fix-up pass logic ---
            // When quality checks fail, instead of immediately reverting all work,
            // we give the agent multiple chances to fix the broken code in-place.
            // This is much more efficient than starting from scratch — most failures
            // are small typecheck or lint errors that are quick to patch.
            //
            // Each fresh attempt gets up to maxFixUpAttempts sub-attempts:
            //   fresh start → fail → fix-up 1 → fail → fix-up 2 → fail → REVERT → fresh start → ...
            //   agent error → always revert immediately (code may be inconsistent)
            const currentFixUp = this.fixUpState.get(story.id);
            const fixUpSubAttempts = currentFixUp?.subAttempts ?? 0;
            const maxFixUps = this.config.maxFixUpAttempts ?? 2;
            const fixUpsExhausted = fixUpSubAttempts >= maxFixUps;

            let didRevert = false;
            if (hasAgentError) {
              // Agent error — always revert, code may be in an inconsistent state
              this.fixUpState.delete(story.id);
              console.log(
                `[loop:${this.loopId}] Agent error — reverting to clean state for "${story.title}"`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Post-failure rollback: agent error — reverting to clean state`,
                timestamp: Date.now(),
              });
              await this.revertUncommittedChanges();
              didRevert = true;
            } else if (requiredChecksFailed && fixUpsExhausted) {
              // All fix-up sub-attempts exhausted — revert and let the next fresh attempt start clean
              this.fixUpState.delete(story.id);
              console.log(
                `[loop:${this.loopId}] Fix-up attempts exhausted (${fixUpSubAttempts}/${maxFixUps}) — reverting to clean state for "${story.title}"`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Post-failure rollback: fix-up attempts exhausted (${fixUpSubAttempts}/${maxFixUps}), reverting for fresh attempt`,
                timestamp: Date.now(),
              });
              await this.revertUncommittedChanges();
              didRevert = true;
            } else if (requiredChecksFailed) {
              // Fix-up sub-attempts remaining — keep the code, store/update errors for next fix-up
              const failedResults = qualityResults.filter((qr) => !qr.passed);
              const nextSubAttempt = fixUpSubAttempts + 1;
              this.fixUpState.set(story.id, {
                subAttempts: nextSubAttempt,
                lastResults: failedResults,
              });
              console.log(
                `[loop:${this.loopId}] Keeping broken code for fix-up pass ${nextSubAttempt}/${maxFixUps} on "${story.title}" (${failedResults.length} failed check(s))`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Skipping revert — next attempt will be fix-up pass ${nextSubAttempt}/${maxFixUps}`,
                timestamp: Date.now(),
              });
            }

            // Check if main retries exhausted (only matters after a revert,
            // since fix-ups don't consume the attempt counter)
            const updatedStory = this.getStory(story.id);
            const retriesExhausted =
              didRevert && updatedStory && updatedStory.attempts >= updatedStory.maxAttempts;

            if (retriesExhausted) {
              this.fixUpState.delete(story.id);
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
              // Reset to pending for retry (either fix-up or fresh)
              this.updateStory(story.id, { status: 'pending' });
            }

            const willRetry = !retriesExhausted;
            const hasFixUpNext = this.fixUpState.has(story.id);
            this.emitEvent('story_failed', {
              storyId: story.id,
              storyTitle: story.title,
              iteration,
              conversationId,
              message: failReason,
              willRetry,
            });
            this.addLogEntry({
              iteration,
              storyId: story.id,
              storyTitle: story.title,
              action: 'failed',
              detail:
                failReason +
                (hasFixUpNext
                  ? ` (fix-up pass ${this.fixUpState.get(story.id)!.subAttempts}/${maxFixUps} next)`
                  : didRevert
                    ? ' (reverted, fresh start next)'
                    : ''),
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

          // Clear current story/agent so UI doesn't show stale state between iterations
          this.updateLoopDb({ current_story_id: null, current_agent_id: null });

          this.emitEvent('iteration_end', {
            storyId: story.id,
            storyTitle: story.title,
            iteration,
          });
          // === End iteration try block ===
        } catch (iterErr) {
          // Don't let a single iteration crash kill the entire loop.
          // Log the error, mark the story as failed if it was in_progress, and continue.
          console.error(`[loop:${this.loopId}] Iteration ${iteration} crashed:`, iterErr);
          this.addLogEntry({
            iteration,
            storyId: story.id,
            storyTitle: story.title,
            action: 'failed',
            detail: `Iteration crashed: ${String(iterErr).slice(0, 500)}`,
            timestamp: Date.now(),
          });

          // Reset story to pending if it was in_progress (so it can be retried)
          let willRetry = false;
          try {
            const crashedStory = this.getStory(story.id);
            if (crashedStory?.status === 'in_progress') {
              if (crashedStory.attempts >= crashedStory.maxAttempts) {
                this.updateStory(story.id, { status: 'failed' });
              } else {
                this.updateStory(story.id, { status: 'pending' });
                willRetry = true;
              }
            }
          } catch {
            /* best effort */
          }

          // Clear current story/agent so UI doesn't show stale state after crash
          this.updateLoopDb({ current_story_id: null, current_agent_id: null });

          this.emitEvent('story_failed', {
            storyId: story.id,
            storyTitle: story.title,
            iteration,
            message: `Iteration crashed: ${String(iterErr).slice(0, 200)}`,
            willRetry,
          });
        }

        // Small delay between iterations
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (this.cancelled) {
        console.log(`[loop:${this.loopId}] Cancelled after ${iteration} iterations`);
        this.updateLoopDb({
          status: 'cancelled',
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.events.emit('loop_done', this.loopId);
        return;
      }

      // Max iterations reached — check final state
      const finalStories = this.getAllStories();
      console.log(
        `[loop:${this.loopId}] Loop ended after ${iteration} iterations. Stories: ${finalStories.map((s) => `${s.title}[${s.status}]`).join(', ')}`,
      );
      const allDone =
        finalStories.length > 0 &&
        finalStories.every(
          (s) => s.status === 'completed' || s.status === 'skipped' || s.researchOnly,
        );

      if (allDone) {
        this.updateLoopDb({
          status: 'completed',
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.emitEvent('completed', { message: 'All stories completed!' });
      } else {
        this.updateLoopDb({
          status: 'failed',
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.emitEvent('failed', {
          message: `Max iterations (${this.config.maxIterations}) reached. Some stories remain incomplete.`,
        });
      }

      // Clean up — the orchestrator will remove us from the runners Map
      // via the 'loop_done' event handler
      this.events.emit('loop_done', this.loopId);
    } finally {
      this.stopHeartbeat();
      // Safety net: if the loop somehow exits without setting a terminal status,
      // mark it as failed so it doesn't appear stuck as "running" forever.
      try {
        const db = getDb();
        const row = db.query('SELECT status FROM loops WHERE id = ?').get(this.loopId) as any;
        if (row && (row.status === 'running' || row.status === 'paused')) {
          console.warn(
            `[loop:${this.loopId}] Safety net: loop exited while still "${row.status}", marking failed`,
          );
          db.query(
            'UPDATE loops SET status = ?, completed_at = ?, current_story_id = NULL, current_agent_id = NULL WHERE id = ?',
          ).run('failed', Date.now(), this.loopId);
          this.emitEvent('failed', { message: 'Loop runner exited unexpectedly.' });
          this.events.emit('loop_done', this.loopId);
        }
      } catch {
        /* best effort */
      }
    }
  }

  // --- Config application ---

  /**
   * Apply the loop config's maxAttemptsPerStory to all stories that will be
   * processed in this loop. This ensures the user's retry setting actually
   * takes effect, overriding the per-story DB default (usually 3).
   */
  private applyMaxAttemptsConfig(): void {
    const configMaxAttempts = this.config.maxAttemptsPerStory;
    if (!configMaxAttempts || configMaxAttempts < 1) return;

    const db = getDb();
    let result;
    if (this.prdId) {
      result = db
        .query(
          "UPDATE prd_stories SET max_attempts = ?, updated_at = ? WHERE prd_id = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
        )
        .run(configMaxAttempts, Date.now(), this.prdId);
    } else {
      result = db
        .query(
          "UPDATE prd_stories SET max_attempts = ?, updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
        )
        .run(configMaxAttempts, Date.now(), this.workspacePath);
    }

    if (result.changes > 0) {
      console.log(
        `[loop:${this.loopId}] Applied maxAttemptsPerStory=${configMaxAttempts} to ${result.changes} stories`,
      );
    }
  }

  // --- Story selection ---

  /**
   * Reset any orphaned in_progress stories back to pending.
   * This handles the case where a story was marked in_progress but the iteration
   * crashed or exited without properly transitioning the story to completed/failed/pending.
   * Only resets stories that are NOT the current story being worked on.
   */
  private recoverOrphanedStories(): void {
    const stories = this.getAllStories();
    const db = getDb();
    const loop = db
      .query('SELECT current_story_id FROM loops WHERE id = ?')
      .get(this.loopId) as any;
    const currentStoryId = loop?.current_story_id;

    for (const s of stories) {
      if (s.status !== 'in_progress') continue;
      if (s.id === currentStoryId) continue; // Don't touch the actively-running story

      console.warn(
        `[loop:${this.loopId}] Recovering orphaned in_progress story "${s.title}" (${s.id}) — resetting to pending`,
      );
      if (s.attempts >= s.maxAttempts) {
        this.updateStory(s.id, { status: 'failed' });
      } else {
        this.updateStory(s.id, { status: 'pending' });
      }
    }
  }

  private selectNextStory(): UserStory | null {
    const stories = this.getAllStories();
    const completedIds = new Set(stories.filter((s) => s.status === 'completed').map((s) => s.id));

    const eligible = stories.filter((s) => {
      if (s.status !== 'pending') return false;
      if (s.attempts >= s.maxAttempts) return false;
      // Skip research-only stories — they are not picked up by the implementation loop
      if (s.researchOnly) return false;
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

    const fixUpInfo = this.fixUpState.get(story.id);
    const isFixUp = !!fixUpInfo;
    const maxFixUps = this.config.maxFixUpAttempts ?? 2;

    let prompt = `## User Story: ${story.title}

${story.description}

## Acceptance Criteria
${criteria}
`;

    if (isFixUp) {
      prompt += `\n## Attempt ${story.attempts} of ${story.maxAttempts} — Fix-up ${fixUpInfo.subAttempts} of ${maxFixUps}`;
    } else {
      prompt += `\n## Attempt ${story.attempts + 1} of ${story.maxAttempts}`;
    }

    // Fix-up pass: the previous attempt's code is still in place — tell the
    // agent to fix the specific errors rather than rewriting from scratch.
    if (isFixUp) {
      prompt += `\n\n## ⚠️ FIX-UP PASS — Do Not Start Over`;
      prompt += `\nYour previous attempt for this story is still in the working tree.`;
      prompt += ` Quality checks failed. Your job is to **fix the specific errors below**,`;
      prompt += ` not rewrite the implementation from scratch.`;
      if (fixUpInfo.subAttempts > 1) {
        prompt += ` This is fix-up attempt ${fixUpInfo.subAttempts} of ${maxFixUps} — previous fixes did not resolve all issues.`;
      }
      prompt += '\n';

      for (const qr of fixUpInfo.lastResults) {
        prompt += `\n### Failed: ${qr.checkName} (exit code ${qr.exitCode})`;
        // Include up to 3000 chars of actual error output so the agent can
        // see exactly what line/file/message caused each failure.
        const output = qr.output.trim();
        if (output) {
          prompt += `\n\`\`\`\n${output.slice(0, 3000)}\n\`\`\`\n`;
        }
      }

      prompt += `\nFix these errors. Keep all working code intact. Do not restructure or rewrite unchanged files.`;
    }

    // Add learnings from previous attempts (always useful context, even on fix-up)
    if (story.learnings.length > 0) {
      prompt += '\n\n## Learnings from Previous Attempts\n';
      for (const learning of story.learnings) {
        prompt += `- ${learning}\n`;
      }
      if (!isFixUp) {
        prompt += '\nPlease address these issues in this attempt. Do not repeat the same mistakes.';
      }
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

  // --- Agent Notes ---

  /**
   * Create an agent note when a story completes or fails.
   * This lets users review agent reports/results without digging through conversations.
   */
  private createAgentNote(
    story: UserStory,
    conversationId: string,
    outcome: 'completed' | 'failed',
    agentOutput: string,
    qualityResults: QualityCheckResult[],
    failReason?: string,
  ): void {
    try {
      const db = getDb();
      const id = nanoid(12);
      const now = Date.now();

      const isSuccess = outcome === 'completed';
      const category = isSuccess ? 'report' : 'status';
      const statusEmoji = isSuccess ? '✅' : '❌';
      const title = `${statusEmoji} ${story.title}`;

      // Build the note content as markdown
      const sections: string[] = [];

      sections.push(`# ${isSuccess ? 'Completed' : 'Failed'}: ${story.title}\n`);

      if (story.description) {
        sections.push(`## Story Description\n${story.description}\n`);
      }

      sections.push(`## Outcome\n**Status:** ${isSuccess ? 'Completed successfully' : 'Failed'}  `);
      sections.push(`**Attempts:** ${story.attempts + 1}/${story.maxAttempts}  `);
      sections.push(`**Iteration:** Loop \`${this.loopId}\`\n`);

      if (failReason) {
        sections.push(`## Failure Reason\n${failReason}\n`);
      }

      if (qualityResults.length > 0) {
        sections.push(`## Quality Check Results`);
        for (const qr of qualityResults) {
          const icon = qr.passed ? '✅' : '❌';
          sections.push(
            `- ${icon} **${qr.checkName}** (${qr.checkType}): ${qr.passed ? 'Passed' : 'Failed'} — ${qr.duration}ms`,
          );
          if (!qr.passed && qr.output) {
            // Include first 500 chars of failure output
            const truncated = qr.output.slice(0, 500);
            sections.push(
              `  \`\`\`\n  ${truncated}${qr.output.length > 500 ? '\n  ...(truncated)' : ''}\n  \`\`\``,
            );
          }
        }
        sections.push('');
      }

      // Include a summary from the agent output (first 2000 chars)
      if (agentOutput && agentOutput.trim().length > 0) {
        const trimmedOutput = agentOutput.trim().slice(0, 2000);
        sections.push(
          `## Agent Output Summary\n\`\`\`\n${trimmedOutput}${agentOutput.length > 2000 ? '\n...(truncated)' : ''}\n\`\`\`\n`,
        );
      }

      const content = sections.join('\n');

      const metadata = {
        loopId: this.loopId,
        storyId: story.id,
        conversationId,
        outcome,
        attempts: story.attempts + 1,
        maxAttempts: story.maxAttempts,
        qualityPassed: qualityResults.filter((qr) => qr.passed).length,
        qualityFailed: qualityResults.filter((qr) => !qr.passed).length,
      };

      db.query(
        `INSERT INTO agent_notes (id, workspace_path, conversation_id, story_id, title, content, category, status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?, ?)`,
      ).run(
        id,
        this.workspacePath,
        conversationId,
        story.id,
        title,
        content,
        category,
        JSON.stringify(metadata),
        now,
        now,
      );

      // Emit stream event so UI updates in real time
      const note: AgentNote = {
        id,
        workspacePath: this.workspacePath,
        conversationId,
        storyId: story.id,
        title,
        content,
        category,
        status: 'unread',
        metadata,
        createdAt: now,
        updatedAt: now,
      };

      const evt: StreamAgentNoteCreated = {
        type: 'agent_note_created',
        note,
      };
      this.events.emit('loop_event', evt);

      console.log(`[loop:${this.loopId}] Created agent note "${title}" (${id})`);
    } catch (err) {
      console.error(`[loop:${this.loopId}] Failed to create agent note:`, err);
    }
  }

  // --- Git operations ---

  /**
   * Revert all uncommitted changes (tracked modifications + untracked files)
   * so the working tree matches the last commit. Used to clean up after a
   * story fails quality checks, preventing cascading failures.
   */
  private async revertUncommittedChanges(): Promise<void> {
    try {
      const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
      if (!isRepo) return;

      // Revert tracked file modifications
      const checkoutProc = Bun.spawn(['git', 'checkout', '.'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await checkoutProc.exited;

      // Remove untracked files and directories added by the failed story
      const cleanProc = Bun.spawn(['git', 'clean', '-fd'], {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await cleanProc.exited;

      console.log(`[loop:${this.loopId}] Reverted uncommitted changes`);
    } catch (err) {
      console.error(`[loop:${this.loopId}] Failed to revert uncommitted changes:`, err);
    }
  }

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
        ? `[golem] ${story.title}\n\nImplemented by E Golem.\nPRD: ${this.prdId}\nStory: ${story.id}`
        : `[golem] ${story.title}\n\nImplemented by E Golem.\nStory: ${story.id}`;
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
    researchOnly: !!row.research_only,
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
    lastHeartbeat: row.last_heartbeat ?? undefined,
  };
}

export const loopOrchestrator = new LoopOrchestrator();
