<script lang="ts">
  import { golemsStore, type GolemStatus, type GolemActivity } from '$lib/stores/golems.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { onMount } from 'svelte';
  import type { GolemMood, GolemPhase } from '@e/shared';

  // Ensure the golems store gets synced from the loop store on mount
  onMount(() => {
    if (loopStore.activeLoop) {
      loopStore.syncGolemFromLoop(loopStore.activeLoop);
    }
  });

  // Thought text animation: type out new thoughts character by character
  let displayedThoughts = $state<Record<string, string>>({});
  let typewriterTimers = $state<Record<string, ReturnType<typeof setInterval>>>({});

  function startTypewriter(golemId: string, fullText: string) {
    // Clear existing timer
    if (typewriterTimers[golemId]) {
      clearInterval(typewriterTimers[golemId]);
    }
    displayedThoughts[golemId] = '';
    let charIndex = 0;
    typewriterTimers[golemId] = setInterval(() => {
      if (charIndex < fullText.length) {
        displayedThoughts[golemId] = fullText.slice(0, charIndex + 1);
        charIndex++;
      } else {
        clearInterval(typewriterTimers[golemId]);
        delete typewriterTimers[golemId];
      }
    }, 25);
  }

  // Track thought changes per golem
  let lastThoughts = $state<Record<string, string>>({});

  $effect(() => {
    for (const golem of golemsStore.golems) {
      if (golem.thought !== lastThoughts[golem.id]) {
        lastThoughts[golem.id] = golem.thought;
        startTypewriter(golem.id, golem.thought);
      }
    }
  });

  function getDisplayedThought(golemId: string): string {
    return displayedThoughts[golemId] ?? '';
  }

  // Mood emoji/icon
  function getMoodEmoji(mood: GolemMood): string {
    switch (mood) {
      case 'focused':
        return '🔍';
      case 'determined':
        return '💪';
      case 'excited':
        return '🎉';
      case 'proud':
        return '✨';
      case 'frustrated':
        return '😤';
      case 'worried':
        return '😟';
      case 'relieved':
        return '😌';
      default:
        return '🤖';
    }
  }

  function getMoodLabel(mood: GolemMood): string {
    switch (mood) {
      case 'focused':
        return 'Focused';
      case 'determined':
        return 'Determined';
      case 'excited':
        return 'Excited';
      case 'proud':
        return 'Proud';
      case 'frustrated':
        return 'Frustrated';
      case 'worried':
        return 'Worried';
      case 'relieved':
        return 'Relieved';
      default:
        return 'Neutral';
    }
  }

  // Phase display
  function getPhaseLabel(phase: GolemPhase): string {
    switch (phase) {
      case 'idle':
        return 'Idle';
      case 'selecting_story':
        return 'Selecting Story';
      case 'preparing':
        return 'Preparing';
      case 'snapshot':
        return 'Snapshotting';
      case 'pre_check':
        return 'Pre-Check';
      case 'spawning_agent':
        return 'Spawning Agent';
      case 'implementing':
        return 'Implementing';
      case 'quality_checking':
        return 'Quality Check';
      case 'committing':
        return 'Committing';
      case 'recording_learnings':
        return 'Learning';
      case 'fixing_up':
        return 'Fixing Up';
      case 'reverting':
        return 'Reverting';
      case 'celebrating':
        return 'Celebrating';
      case 'resting':
        return 'Resting';
      default:
        return 'Unknown';
    }
  }

  // Status display helpers
  function getStatusClass(status: GolemStatus['status']): string {
    switch (status) {
      case 'running':
        return 'status-running';
      case 'paused':
        return 'status-paused';
      case 'completed':
        return 'status-completed';
      case 'failed':
        return 'status-failed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-idle';
    }
  }

  function getStatusLabel(status: GolemStatus['status']): string {
    switch (status) {
      case 'running':
        return 'Active';
      case 'paused':
        return 'Paused';
      case 'completed':
        return 'Complete';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Idle';
    }
  }

  // Elapsed time formatting
  function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  // Activity type icon
  function getActivityIcon(type: GolemActivity['type']): string {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'warning':
        return '!';
      case 'thought':
        return '~';
      default:
        return '›';
    }
  }

  function getProgressPercent(g: GolemStatus): number {
    if (g.totalStories === 0) return 0;
    return Math.round((g.storiesCompleted / g.totalStories) * 100);
  }

  function handlePause() {
    loopStore.pauseLoop();
  }

  function handleResume() {
    loopStore.resumeLoop();
  }

  function handleCancel() {
    loopStore.cancelLoop();
  }

  function handleDismiss(golemId: string) {
    golemsStore.removeGolem(golemId);
  }

  function handleClearInactive() {
    golemsStore.clearInactive();
  }

  function goToWork() {
    uiStore.setSidebarTab('work');
  }

  // Thought bubble cursor blink state
  const isTyping = $derived.by(() => {
    for (const golem of golemsStore.golems) {
      if (typewriterTimers[golem.id]) return true;
    }
    return false;
  });

  const IDLE_THOUGHTS = [
    'No golems are active. Start a loop from the Work panel to summon one.',
    'Golems are autonomous workers that implement your stories one by one.',
    'Each golem takes a story, implements it, runs quality checks, and moves on.',
  ];
  let idleThoughtIndex = $state(0);

  onMount(() => {
    const interval = setInterval(() => {
      idleThoughtIndex = (idleThoughtIndex + 1) % IDLE_THOUGHTS.length;
    }, 8000);
    return () => clearInterval(interval);
  });
</script>

<div class="golems-panel">
  {#if golemsStore.golems.length === 0}
    <!-- Empty state -->
    <div class="empty-state">
      <div class="empty-golem-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12 2a4 4 0 0 0-4 4v1H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"
          />
          <circle cx="9" cy="13" r="1.5" />
          <circle cx="15" cy="13" r="1.5" />
        </svg>
        <div class="empty-golem-zzz">z z z</div>
      </div>
      <div class="empty-title">No Active Golems</div>
      <div class="empty-hint">{IDLE_THOUGHTS[idleThoughtIndex]}</div>
      <button class="go-to-work-btn" onclick={goToWork}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        Go to Work Panel
      </button>
    </div>
  {:else}
    <!-- Golem cards -->
    <div class="golems-list">
      {#each golemsStore.golems as golem (golem.id)}
        <div
          class="golem-card"
          class:active={golem.status === 'running'}
          class:paused={golem.status === 'paused'}
        >
          <!-- Header: Avatar + Name + Status -->
          <div class="golem-header">
            <div class="golem-avatar" class:pulse={golem.status === 'running'}>
              <span class="golem-mood-emoji">{getMoodEmoji(golem.mood)}</span>
            </div>
            <div class="golem-identity">
              <div class="golem-name">{golem.label}</div>
              <div class="golem-meta">
                <span class="golem-status-badge {getStatusClass(golem.status)}"
                  >{getStatusLabel(golem.status)}</span
                >
                <span class="golem-phase">{getPhaseLabel(golem.phase)}</span>
              </div>
            </div>
            <div class="golem-mood-label" title="Mood: {getMoodLabel(golem.mood)}">
              {getMoodLabel(golem.mood)}
            </div>
          </div>

          <!-- Thought bubble -->
          <div class="thought-bubble" class:thinking={golem.status === 'running'}>
            <div class="thought-dots">
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
            <div class="thought-text">
              {getDisplayedThought(golem.id)}{#if typewriterTimers[golem.id]}<span class="cursor"
                  >|</span
                >{/if}
            </div>
          </div>

          <!-- Current story -->
          {#if golem.currentStoryTitle}
            <div class="current-story">
              <span class="story-label">Working on</span>
              <span class="story-title">{golem.currentStoryTitle}</span>
              {#if golem.currentAttempt > 0}
                <span class="attempt-info">
                  Attempt {golem.currentAttempt}/{golem.maxAttempts}
                  {#if golem.fixUpAttempt > 0}
                    · Fix-up {golem.fixUpAttempt}/{golem.maxFixUpAttempts}
                  {/if}
                </span>
              {/if}
            </div>
          {/if}

          <!-- Progress bar -->
          <div class="progress-section">
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: {getProgressPercent(golem)}%"></div>
            </div>
            <div class="progress-stats">
              <span class="progress-text"
                >{golem.storiesCompleted}/{golem.totalStories} stories</span
              >
              {#if golem.storiesFailed > 0}
                <span class="progress-failed">{golem.storiesFailed} failed</span>
              {/if}
              <span class="progress-elapsed">{formatElapsed(golem.elapsedMs)}</span>
            </div>
          </div>

          <!-- Iteration info -->
          <div class="iteration-info">
            <span class="iteration-label">Iteration {golem.currentIteration}</span>
          </div>

          <!-- Controls -->
          {#if golem.status === 'running' || golem.status === 'paused'}
            <div class="golem-controls">
              {#if golem.status === 'running'}
                <button class="ctrl-btn pause-btn" onclick={handlePause} title="Pause">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  Pause
                </button>
              {:else}
                <button class="ctrl-btn resume-btn" onclick={handleResume} title="Resume">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                  Resume
                </button>
              {/if}
              <button class="ctrl-btn cancel-btn" onclick={handleCancel} title="Cancel">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </div>
          {:else}
            <div class="golem-controls">
              <button
                class="ctrl-btn dismiss-btn"
                onclick={() => handleDismiss(golem.id)}
                title="Dismiss"
              >
                Dismiss
              </button>
            </div>
          {/if}

          <!-- Activity feed -->
          {#if golem.activities.length > 0}
            <details class="activity-section">
              <summary class="activity-toggle">
                Activity Log ({golem.activities.length})
              </summary>
              <div class="activity-feed">
                {#each golem.activities.slice(0, 20) as activity (activity.id)}
                  <div class="activity-item activity-{activity.type}">
                    <span class="activity-icon">{getActivityIcon(activity.type)}</span>
                    <span class="activity-detail">{activity.detail}</span>
                    <span class="activity-time">{formatTimestamp(activity.timestamp)}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Footer actions -->
    {#if golemsStore.golems.some((g) => g.status !== 'running' && g.status !== 'paused')}
      <div class="panel-footer">
        <button class="clear-btn" onclick={handleClearInactive}> Clear Inactive </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .golems-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Empty state ── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
  }

  .empty-golem-icon {
    position: relative;
    color: var(--text-tertiary);
    opacity: 0.6;
    animation: emptyGolemFloat 4s ease-in-out infinite;
  }

  .empty-golem-zzz {
    position: absolute;
    top: -8px;
    right: -12px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    opacity: 0.5;
    letter-spacing: 3px;
    animation: zzzFloat 3s ease-in-out infinite;
  }

  @keyframes emptyGolemFloat {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-4px);
    }
  }

  @keyframes zzzFloat {
    0%,
    100% {
      transform: translateY(0) translateX(0);
      opacity: 0.3;
    }
    50% {
      transform: translateY(-8px) translateX(4px);
      opacity: 0.7;
    }
  }

  .empty-title {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .empty-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.5;
    max-width: 200px;
    transition: opacity 300ms ease;
  }

  .go-to-work-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    cursor: pointer;
    transition: all var(--transition);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .go-to-work-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
    border-color: var(--accent-primary);
  }

  /* ── Golem list ── */
  .golems-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ── Golem card ── */
  .golem-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all var(--transition);
    position: relative;
    overflow: hidden;
  }

  .golem-card.active {
    border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .golem-card.active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
    background-size: 200% 100%;
    animation: golemCardSlide 2.5s ease-in-out infinite;
  }

  .golem-card.paused {
    border-color: color-mix(in srgb, var(--accent-warning) 30%, transparent);
  }

  .golem-card.paused::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent-warning);
    opacity: 0.5;
  }

  @keyframes golemCardSlide {
    0% {
      background-position: -200% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }

  /* ── Golem header ── */
  .golem-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .golem-avatar {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: 50%;
    flex-shrink: 0;
    position: relative;
  }

  .golem-avatar.pulse {
    animation: avatarPulse 2s ease-in-out infinite;
  }

  @keyframes avatarPulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 30%, transparent);
    }
    50% {
      box-shadow: 0 0 8px 2px color-mix(in srgb, var(--accent-primary) 20%, transparent);
    }
  }

  .golem-mood-emoji {
    line-height: 1;
  }

  .golem-identity {
    flex: 1;
    min-width: 0;
  }

  .golem-name {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .golem-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }

  .golem-status-badge {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    border: 1px solid;
  }

  .status-running {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .status-paused {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 10%, transparent);
  }

  .status-completed {
    color: var(--accent-secondary);
    border-color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
  }

  .status-failed {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
  }

  .status-cancelled {
    color: var(--text-tertiary);
    border-color: var(--border-secondary);
    background: var(--bg-secondary);
  }

  .status-idle {
    color: var(--text-tertiary);
    border-color: var(--border-primary);
    background: var(--bg-tertiary);
  }

  .golem-phase {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .golem-mood-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    flex-shrink: 0;
  }

  /* ── Thought bubble ── */
  .thought-bubble {
    position: relative;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    border-radius: 8px;
    padding: 8px 10px;
    margin-left: 16px;
    min-height: 32px;
    display: flex;
    align-items: center;
  }

  .thought-bubble.thinking {
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }

  .thought-dots {
    position: absolute;
    left: -12px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .thought-dots .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--border-secondary);
  }

  .thought-bubble.thinking .thought-dots .dot {
    background: var(--accent-primary);
    animation: dotPulse 1.5s ease-in-out infinite;
  }

  .thought-dots .dot:nth-child(2) {
    width: 3px;
    height: 3px;
    margin-left: -2px;
    animation-delay: 0.3s;
  }

  @keyframes dotPulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  .thought-text {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    font-style: italic;
    word-break: break-word;
  }

  .cursor {
    color: var(--accent-primary);
    animation: cursorBlink 0.8s step-end infinite;
    font-style: normal;
  }

  @keyframes cursorBlink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  /* ── Current story ── */
  .current-story {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
  }

  .story-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
  }

  .story-title {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .attempt-info {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  /* ── Progress bar ── */
  .progress-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .progress-bar-container {
    height: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--accent-primary);
    transition: width 500ms ease;
    position: relative;
  }

  .golem-card.active .progress-bar {
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-primary) 40%, transparent);
  }

  .progress-stats {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xxs);
  }

  .progress-text {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .progress-failed {
    color: var(--accent-error);
    font-weight: 600;
  }

  .progress-elapsed {
    margin-left: auto;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xxs);
  }

  /* ── Iteration info ── */
  .iteration-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .iteration-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  /* ── Controls ── */
  .golem-controls {
    display: flex;
    gap: 6px;
  }

  .ctrl-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 5px 8px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    border: 1px solid var(--border-secondary);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .ctrl-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pause-btn:hover {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
  }

  .resume-btn {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
  }

  .resume-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border-color: var(--accent-primary);
  }

  .cancel-btn:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  .dismiss-btn {
    color: var(--text-tertiary);
  }

  /* ── Activity feed ── */
  .activity-section {
    border-top: 1px solid var(--border-primary);
    margin-top: 2px;
    padding-top: 4px;
  }

  .activity-toggle {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 4px 0;
    font-weight: 600;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    user-select: none;
    list-style: none;
  }

  .activity-toggle::marker {
    content: '';
  }

  .activity-toggle::-webkit-details-marker {
    display: none;
  }

  .activity-toggle::before {
    content: '▸ ';
  }

  details[open] .activity-toggle::before {
    content: '▾ ';
  }

  .activity-feed {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 4px;
  }

  .activity-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 3px 4px;
    font-size: var(--fs-xxs);
    line-height: 1.4;
    border-left: 2px solid var(--border-primary);
    transition: background var(--transition);
  }

  .activity-item:hover {
    background: var(--bg-hover);
  }

  .activity-item.activity-success {
    border-left-color: var(--accent-secondary);
  }

  .activity-item.activity-error {
    border-left-color: var(--accent-error);
  }

  .activity-item.activity-warning {
    border-left-color: var(--accent-warning);
  }

  .activity-icon {
    flex-shrink: 0;
    width: 12px;
    text-align: center;
    font-weight: 700;
    color: var(--text-tertiary);
  }

  .activity-success .activity-icon {
    color: var(--accent-secondary);
  }

  .activity-error .activity-icon {
    color: var(--accent-error);
  }

  .activity-warning .activity-icon {
    color: var(--accent-warning);
  }

  .activity-detail {
    flex: 1;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .activity-time {
    flex-shrink: 0;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xxs);
    opacity: 0.7;
  }

  /* ── Footer ── */
  .panel-footer {
    padding: 8px 0 0;
    border-top: 1px solid var(--border-primary);
    display: flex;
    justify-content: center;
  }

  .clear-btn {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    padding: 4px 8px;
    transition: color var(--transition);
  }

  .clear-btn:hover {
    color: var(--text-primary);
  }
</style>
