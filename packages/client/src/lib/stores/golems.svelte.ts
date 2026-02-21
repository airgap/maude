import type { GolemPhase, GolemMood, StreamLoopEvent, IterationLogEntry } from '@e/shared';

/** A single activity entry in a golem's recent timeline */
export interface GolemActivity {
  id: string;
  timestamp: number;
  event: string;
  detail: string;
  storyTitle?: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'thought';
}

/** Full status of a single golem (mapped 1:1 from a loop) */
export interface GolemStatus {
  id: string; // loop ID
  label: string; // PRD name or "Standalone Stories"
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'idle';
  phase: GolemPhase;
  mood: GolemMood;
  thought: string;
  thoughtTimestamp: number;

  // Story progress
  currentStoryId: string | null;
  currentStoryTitle: string | null;
  currentIteration: number;
  totalIterations: number;
  storiesCompleted: number;
  storiesFailed: number;
  totalStories: number;

  // Attempt tracking
  currentAttempt: number;
  maxAttempts: number;
  fixUpAttempt: number;
  maxFixUpAttempts: number;

  // Timing
  startedAt: number;
  elapsedMs: number;

  // Recent activity feed
  activities: GolemActivity[];
}

const MAX_ACTIVITIES = 50;
let activityIdCounter = 0;

function createGolemsStore() {
  let golems = $state<GolemStatus[]>([]);
  let elapsedInterval = $state<ReturnType<typeof setInterval> | null>(null);

  function ensureElapsedTimer() {
    if (elapsedInterval) return;
    elapsedInterval = setInterval(() => {
      const now = Date.now();
      for (const g of golems) {
        if (g.status === 'running') {
          g.elapsedMs = now - g.startedAt;
        }
      }
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  function getOrCreateGolem(loopId: string): GolemStatus {
    let g = golems.find((g) => g.id === loopId);
    if (!g) {
      g = {
        id: loopId,
        label: 'Golem',
        status: 'idle',
        phase: 'idle',
        mood: 'neutral',
        thought: 'Initializing...',
        thoughtTimestamp: Date.now(),
        currentStoryId: null,
        currentStoryTitle: null,
        currentIteration: 0,
        totalIterations: 0,
        storiesCompleted: 0,
        storiesFailed: 0,
        totalStories: 0,
        currentAttempt: 0,
        maxAttempts: 0,
        fixUpAttempt: 0,
        maxFixUpAttempts: 0,
        startedAt: Date.now(),
        elapsedMs: 0,
        activities: [],
      };
      golems = [...golems, g];
    }
    return g;
  }

  function addActivity(
    golem: GolemStatus,
    event: string,
    detail: string,
    type: GolemActivity['type'] = 'info',
    storyTitle?: string,
  ) {
    const activity: GolemActivity = {
      id: `ga-${++activityIdCounter}`,
      timestamp: Date.now(),
      event,
      detail,
      storyTitle,
      type,
    };
    golem.activities = [activity, ...golem.activities].slice(0, MAX_ACTIVITIES);
  }

  return {
    get golems() {
      return golems;
    },
    get activeGolems() {
      return golems.filter((g) => g.status === 'running' || g.status === 'paused');
    },
    get hasActiveGolems() {
      return golems.some((g) => g.status === 'running' || g.status === 'paused');
    },

    /** Initialize or update a golem when a loop starts */
    initGolem(loopId: string, label: string, totalStories: number, startedAt: number) {
      const g = getOrCreateGolem(loopId);
      g.label = label;
      g.status = 'running';
      g.phase = 'idle';
      g.mood = 'focused';
      g.thought = 'Waking up...';
      g.thoughtTimestamp = Date.now();
      g.totalStories = totalStories;
      g.startedAt = startedAt;
      g.elapsedMs = Date.now() - startedAt;
      g.storiesCompleted = 0;
      g.storiesFailed = 0;
      g.activities = [];
      addActivity(g, 'started', `Golem activated: ${label}`, 'info');
      ensureElapsedTimer();
      // Force reactivity
      golems = [...golems];
    },

    /** Handle a loop SSE event and update golem state */
    handleEvent(event: StreamLoopEvent) {
      const g = getOrCreateGolem(event.loopId);

      switch (event.event) {
        case 'started':
          g.status = 'running';
          g.phase = 'idle';
          g.mood = 'focused';
          g.thought = 'Golem activated!';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'started', event.data.message || 'Loop started', 'info');
          ensureElapsedTimer();
          break;

        case 'golem_thought':
          g.thought = event.data.thought || g.thought;
          g.thoughtTimestamp = Date.now();
          if (event.data.phase) g.phase = event.data.phase;
          if (event.data.mood) g.mood = event.data.mood;
          if (event.data.storyId) g.currentStoryId = event.data.storyId;
          if (event.data.storyTitle) g.currentStoryTitle = event.data.storyTitle;
          if (event.data.attempt) g.currentAttempt = event.data.attempt;
          if (event.data.maxAttempts) g.maxAttempts = event.data.maxAttempts;
          if (event.data.fixUpAttempt !== undefined) g.fixUpAttempt = event.data.fixUpAttempt;
          if (event.data.maxFixUpAttempts !== undefined)
            g.maxFixUpAttempts = event.data.maxFixUpAttempts;
          // Don't add thoughts to activity feed — they're too noisy
          break;

        case 'iteration_start':
          g.currentIteration = event.data.iteration ?? g.currentIteration;
          if (event.data.storyId) g.currentStoryId = event.data.storyId;
          if (event.data.storyTitle) g.currentStoryTitle = event.data.storyTitle;
          addActivity(
            g,
            'iteration',
            `Iteration ${event.data.iteration}: ${event.data.storyTitle || 'selecting...'}`,
            'info',
            event.data.storyTitle,
          );
          break;

        case 'story_started':
          g.currentStoryId = event.data.storyId ?? null;
          g.currentStoryTitle = event.data.storyTitle ?? null;
          g.phase = 'implementing';
          addActivity(
            g,
            'story_started',
            `Working on: ${event.data.storyTitle}`,
            'info',
            event.data.storyTitle,
          );
          break;

        case 'story_completed':
          g.storiesCompleted++;
          g.phase = 'celebrating';
          g.mood = 'proud';
          g.thought = `Completed "${event.data.storyTitle}"!`;
          g.thoughtTimestamp = Date.now();
          addActivity(
            g,
            'story_completed',
            `Completed: ${event.data.storyTitle}`,
            'success',
            event.data.storyTitle,
          );
          break;

        case 'story_failed':
          if (!event.data.willRetry) g.storiesFailed++;
          g.phase = 'idle';
          g.mood = event.data.willRetry ? 'determined' : 'frustrated';
          g.thought = event.data.willRetry
            ? `"${event.data.storyTitle}" stumbled — will try again`
            : `"${event.data.storyTitle}" failed after all attempts`;
          g.thoughtTimestamp = Date.now();
          addActivity(
            g,
            'story_failed',
            `${event.data.willRetry ? 'Retry' : 'Failed'}: ${event.data.storyTitle}${event.data.message ? ` — ${event.data.message.slice(0, 100)}` : ''}`,
            event.data.willRetry ? 'warning' : 'error',
            event.data.storyTitle,
          );
          break;

        case 'quality_check':
          if (event.data.qualityResult) {
            const qr = event.data.qualityResult;
            addActivity(
              g,
              'quality_check',
              `${qr.checkName}: ${qr.passed ? 'PASSED' : 'FAILED'}`,
              qr.passed ? 'success' : 'warning',
              event.data.storyTitle,
            );
          }
          break;

        case 'paused':
          g.status = 'paused';
          g.phase = 'idle';
          g.thought = 'Paused... waiting for instructions';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'paused', event.data.message || 'Golem paused', 'warning');
          break;

        case 'resumed':
          g.status = 'running';
          g.mood = 'determined';
          g.thought = 'Resuming work...';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'resumed', 'Golem resumed', 'info');
          ensureElapsedTimer();
          break;

        case 'completed':
          g.status = 'completed';
          g.phase = 'celebrating';
          g.mood = 'excited';
          g.thought = 'All done! Every story is complete.';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'completed', event.data.message || 'All stories completed!', 'success');
          break;

        case 'failed':
          g.status = 'failed';
          g.phase = 'idle';
          g.mood = 'frustrated';
          g.thought = event.data.message || 'Something went wrong...';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'failed', event.data.message || 'Loop failed', 'error');
          break;

        case 'cancelled':
          g.status = 'cancelled';
          g.phase = 'idle';
          g.mood = 'neutral';
          g.thought = 'Cancelled. Standing down.';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'cancelled', 'Golem cancelled by user', 'warning');
          break;

        case 'learning':
          addActivity(
            g,
            'learning',
            `Learned: ${(event.data.learning || '').slice(0, 100)}`,
            'info',
            event.data.storyTitle,
          );
          break;
      }

      // Force reactivity
      golems = [...golems];

      // Stop timer if no active golems
      if (!golems.some((g) => g.status === 'running')) {
        stopElapsedTimer();
      }
    },

    /** Sync golem from existing loop state (e.g., on page load / reconnect) */
    syncFromLoopState(
      loopId: string,
      label: string,
      status: string,
      totalStories: number,
      storiesCompleted: number,
      storiesFailed: number,
      currentIteration: number,
      currentStoryId: string | null,
      currentStoryTitle: string | null,
      startedAt: number,
      iterationLog: IterationLogEntry[],
    ) {
      const g = getOrCreateGolem(loopId);
      g.label = label;
      g.status = status as GolemStatus['status'];
      g.totalStories = totalStories;
      g.storiesCompleted = storiesCompleted;
      g.storiesFailed = storiesFailed;
      g.currentIteration = currentIteration;
      g.currentStoryId = currentStoryId;
      g.currentStoryTitle = currentStoryTitle;
      g.startedAt = startedAt;
      g.elapsedMs = Date.now() - startedAt;

      // Set mood/phase based on status
      if (status === 'running') {
        g.mood = storiesFailed > storiesCompleted ? 'determined' : 'focused';
        g.phase = currentStoryId ? 'implementing' : 'selecting_story';
        g.thought = currentStoryTitle
          ? `Working on "${currentStoryTitle}"...`
          : 'Scanning backlog...';
      } else if (status === 'paused') {
        g.mood = 'neutral';
        g.phase = 'idle';
        g.thought = 'Paused... waiting for instructions';
      } else if (status === 'completed') {
        g.mood = 'excited';
        g.phase = 'celebrating';
        g.thought = 'All done!';
      } else if (status === 'failed') {
        g.mood = 'frustrated';
        g.phase = 'idle';
        g.thought = 'Loop ended with failures';
      }
      g.thoughtTimestamp = Date.now();

      // Build activities from iteration log (most recent first)
      const recentLog = iterationLog.slice(-MAX_ACTIVITIES).reverse();
      g.activities = recentLog.map((entry, i) => ({
        id: `sync-${loopId}-${i}`,
        timestamp: entry.timestamp,
        event: entry.action,
        detail: entry.detail,
        storyTitle: entry.storyTitle,
        type:
          entry.action === 'passed' || entry.action === 'committed'
            ? ('success' as const)
            : entry.action === 'failed'
              ? ('error' as const)
              : ('info' as const),
      }));

      if (status === 'running') {
        ensureElapsedTimer();
      }

      // Force reactivity
      golems = [...golems];
    },

    /** Remove a golem (e.g., when dismissed) */
    removeGolem(loopId: string) {
      golems = golems.filter((g) => g.id !== loopId);
      if (!golems.some((g) => g.status === 'running')) {
        stopElapsedTimer();
      }
    },

    /** Clear all non-active golems */
    clearInactive() {
      golems = golems.filter((g) => g.status === 'running' || g.status === 'paused');
    },
  };
}

export const golemsStore = createGolemsStore();
