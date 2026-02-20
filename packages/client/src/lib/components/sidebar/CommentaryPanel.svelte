<script lang="ts">
  import { commentaryStore, type CommentaryEntry } from '$lib/stores/commentary.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { findHypertheme } from '$lib/config/hyperthemes';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';
  import CommentaryExportModal from '$lib/components/commentary/CommentaryExportModal.svelte';

  type CommentaryPersonality =
    | 'sports_announcer'
    | 'documentary_narrator'
    | 'technical_analyst'
    | 'comedic_observer'
    | 'project_lead'
    | 'wizard';

  type CommentaryVerbosity = 'frequent' | 'strategic' | 'minimal';

  interface VerbosityOption {
    id: CommentaryVerbosity;
    label: string;
    shortLabel: string;
    description: string;
  }

  const verbosityOptions: VerbosityOption[] = [
    { id: 'frequent', label: 'Frequent', shortLabel: 'Freq', description: 'Every few seconds' },
    { id: 'strategic', label: 'Strategic', shortLabel: 'Strat', description: 'Key milestones' },
    { id: 'minimal', label: 'Minimal', shortLabel: 'Min', description: 'Major events only' },
  ];

  interface PersonalityOption {
    id: CommentaryPersonality;
    label: string;
    icon: string;
    description: string;
  }

  const personalities: PersonalityOption[] = [
    {
      id: 'sports_announcer',
      label: 'Sports Announcer',
      icon: 'M3 8L15 1l-6.026 13.634L12 21l9-13h-7.971L21 1z',
      description: 'Fast-paced, energetic play-by-play',
    },
    {
      id: 'documentary_narrator',
      label: 'Documentary Narrator',
      icon: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
      description: 'Calm, thoughtful observations',
    },
    {
      id: 'technical_analyst',
      label: 'Technical Analyst',
      icon: 'M3 3l18 18M9 9v6a3 3 0 0 0 5.12 2.12M15 15V9a3 3 0 0 0-3-3M3 12h18M12 3v18',
      description: 'Strategic, engineering-focused',
    },
    {
      id: 'comedic_observer',
      label: 'Comedic Observer',
      icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
      description: 'Witty, playful, self-aware',
    },
    {
      id: 'project_lead',
      label: 'Project Lead',
      icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
      description: 'First-person, authoritative',
    },
    {
      id: 'wizard',
      label: 'Wizard',
      icon: 'M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z',
      description: 'Mystical, arcane commentary',
    },
  ];

  /** Personality labels keyed by id for the timeline. */
  const personalityLabels: Record<string, string> = Object.fromEntries(
    personalities.map((p) => [p.id, p.label]),
  );

  let workspacePath = $derived(workspaceStore.activeWorkspace?.workspacePath);
  let workspaceId = $derived(workspaceStore.activeWorkspace?.workspaceId);
  let isActive = $derived(commentaryStore.isActive);
  let currentPersonality = $derived(
    (commentaryStore.personality as CommentaryPersonality) || 'sports_announcer',
  );
  let currentPersonalityOption = $derived(
    personalities.find((p) => p.id === currentPersonality) || personalities[0],
  );
  let commentaryText = $derived(commentaryStore.commentaryText);
  let history = $derived(commentaryStore.commentaryHistory);
  let error = $derived(commentaryStore.error);
  let ttsEnabled = $derived(commentaryStore.ttsEnabled);
  let ttsVolume = $derived(commentaryStore.ttsVolume);
  let ttsPaused = $derived(commentaryStore.ttsPaused);

  let showPersonalityDropdown = $state(false);
  let savedPersonality = $state<CommentaryPersonality | null>(null);
  let currentVerbosity = $state<CommentaryVerbosity>('strategic');
  let showExportModal = $state(false);
  let autoScroll = $state(true);
  let contentEl = $state<HTMLDivElement | null>(null);

  // --- Timeline (past commentary) state ---
  type ViewMode = 'live' | 'timeline';
  let viewMode = $state<ViewMode>('live');
  let timelineEntries = $state<CommentaryEntry[]>([]);
  let timelineLoading = $state(false);
  let timelineHasMore = $state(false);
  let timelineOffset = $state(0);
  const TIMELINE_PAGE_SIZE = 50;

  // Auto-scroll to bottom when new commentary arrives
  $effect(() => {
    // Track history length to trigger on new entries
    const _len = history.length;
    const _text = commentaryText;

    if (autoScroll && contentEl) {
      // Use requestAnimationFrame so the DOM has been updated
      requestAnimationFrame(() => {
        if (contentEl) {
          contentEl.scrollTop = contentEl.scrollHeight;
        }
      });
    }
  });

  // Detect manual scroll to disable auto-scroll
  function handleScroll() {
    if (!contentEl) return;
    const { scrollTop, scrollHeight, clientHeight } = contentEl;
    // If user is within 40px of bottom, re-enable auto-scroll
    autoScroll = scrollHeight - scrollTop - clientHeight < 40;
  }

  // Load workspace settings to get saved personality preference
  $effect(() => {
    if (workspaceId && !isActive) {
      // Fetch workspace to get settings
      (async () => {
        try {
          const res = await api.workspaces.get(workspaceId);
          if (res.ok && res.data?.settings) {
            const settings = res.data.settings;

            // Load personality preference
            if (settings.commentaryPersonality) {
              savedPersonality = settings.commentaryPersonality as CommentaryPersonality;
            }

            // Load verbosity preference
            if (settings.commentaryVerbosity) {
              currentVerbosity = settings.commentaryVerbosity as CommentaryVerbosity;
            }

            // Load TTS settings
            if (settings.commentaryTtsEnabled) {
              const volume = settings.commentaryTtsVolume ?? 0.8;
              commentaryStore.enableTts(volume);

              // Configure TTS provider if specified
              if (settings.commentaryTtsProvider) {
                commentaryStore.configureTts(
                  settings.commentaryTtsProvider,
                  settings.commentaryTtsElevenLabsApiKey,
                  settings.commentaryTtsGoogleApiKey,
                );
              }
            }
          }

          // Auto-start commentary when panel is opened.
          // If no saved personality, check whether the active hypertheme
          // suggests one (e.g. Wizard's Study → wizard personality).
          const themeSuggested = findHypertheme(settingsStore.hypertheme)?.suggestedPersonality as
            | CommentaryPersonality
            | undefined;
          const personality = savedPersonality || themeSuggested || 'sports_announcer';
          commentaryStore.startCommentary(workspaceId, personality);
        } catch (err) {
          console.error('[commentary] Failed to load workspace settings:', err);
          // Fall back to theme-suggested personality or default
          const fallback =
            findHypertheme(settingsStore.hypertheme)?.suggestedPersonality || 'sports_announcer';
          commentaryStore.startCommentary(workspaceId, fallback);
        }
      })();
    }
  });

  // Auto-activate wizard personality when Wizard's Study theme is selected
  let previousHypertheme = $state(settingsStore.hypertheme);
  $effect(() => {
    const currentHypertheme = settingsStore.hypertheme;
    if (currentHypertheme !== previousHypertheme) {
      previousHypertheme = currentHypertheme;
      const ht = findHypertheme(currentHypertheme);
      if (ht?.suggestedPersonality && workspaceId && isActive) {
        const suggested = ht.suggestedPersonality as CommentaryPersonality;
        if (suggested !== currentPersonality) {
          selectPersonality(suggested);
        }
      }
    }
  });

  function toggleCommentary() {
    if (isActive) {
      commentaryStore.stopCommentary();
    } else {
      if (workspaceId) {
        commentaryStore.startCommentary(workspaceId, currentPersonality);
      }
    }
  }

  async function selectPersonality(personality: CommentaryPersonality) {
    showPersonalityDropdown = false;

    // Persist to workspace settings
    if (workspaceId) {
      try {
        await api.workspaces.update(workspaceId, {
          settings: {
            commentaryPersonality: personality,
          },
        });
        savedPersonality = personality;
      } catch (err) {
        console.error('[commentary] Failed to save personality preference:', err);
        uiStore.toast('Failed to save personality preference', 'error');
      }
    }

    // Restart commentary with new personality
    if (workspaceId) {
      commentaryStore.startCommentary(workspaceId, personality);
    }
  }

  function clearHistory() {
    commentaryStore.clearHistory();
    // Also clear server-side history if workspace is active
    if (workspaceId) {
      commentaryStore.clearWorkspaceHistory(workspaceId).catch((err: unknown) => {
        console.error('[commentary] Failed to clear server history:', err);
      });
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function closeDropdown() {
    showPersonalityDropdown = false;
  }

  async function selectVerbosity(verbosity: CommentaryVerbosity) {
    currentVerbosity = verbosity;

    // Persist to workspace settings
    if (workspaceId) {
      try {
        await api.commentary.updateSettings(workspaceId, { verbosity });
      } catch (err) {
        console.error('[commentary] Failed to save verbosity preference:', err);
        uiStore.toast('Failed to save verbosity preference', 'error');
      }
    }
  }

  function toggleTts() {
    if (ttsEnabled) {
      commentaryStore.disableTts();
      saveWorkspaceSetting('commentaryTtsEnabled', false);
    } else {
      commentaryStore.enableTts(ttsVolume);
      saveWorkspaceSetting('commentaryTtsEnabled', true);
    }
  }

  function handleVolumeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const volume = parseFloat(input.value);
    commentaryStore.setTtsVolume(volume);
    saveWorkspaceSetting('commentaryTtsVolume', volume);
  }

  async function saveWorkspaceSetting(key: string, value: any) {
    if (!workspaceId) return;
    try {
      await api.workspaces.update(workspaceId, {
        settings: {
          [key]: value,
        },
      });
    } catch (err) {
      console.error('[commentary] Failed to save setting:', err);
    }
  }

  // --- Timeline helpers ---

  /** Switch between live and timeline views. */
  function setViewMode(mode: ViewMode) {
    viewMode = mode;
    if (mode === 'timeline' && timelineEntries.length === 0) {
      loadTimeline();
    }
  }

  /** Load persisted commentary history from the database. */
  async function loadTimeline(append = false) {
    if (!workspaceId) return;
    timelineLoading = true;
    try {
      const loaded = await commentaryStore.loadHistory(
        workspaceId,
        TIMELINE_PAGE_SIZE,
        append ? timelineOffset : 0,
      );
      if (!append) {
        timelineEntries = loaded;
        timelineOffset = loaded.length;
      } else {
        timelineEntries = [...timelineEntries, ...loaded];
        timelineOffset += loaded.length;
      }
      timelineHasMore = loaded.length === TIMELINE_PAGE_SIZE;
    } catch (err) {
      console.error('[commentary] Failed to load timeline:', err);
    }
    timelineLoading = false;
  }

  function loadMoreTimeline() {
    loadTimeline(true);
  }

  /** Format a timestamp for the timeline — includes date for older entries. */
  function formatTimelineTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    return (
      date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }

  // Close dropdown when clicking outside
  $effect(() => {
    if (showPersonalityDropdown) {
      const handler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.personality-dropdown-container')) {
          closeDropdown();
        }
      };
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  });
</script>

<div class="commentary-panel">
  <div class="panel-header">
    <!-- Personality indicator with icon and name -->
    <div class="personality-indicator">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="personality-indicator-icon"
      >
        <path d={currentPersonalityOption.icon} />
      </svg>
      <span class="personality-indicator-name">{currentPersonalityOption.label}</span>
      {#if isActive}
        <span class="live-dot" title="Live"></span>
      {/if}
    </div>
    <div class="header-actions">
      <!-- Personality Selector -->
      <div class="personality-dropdown-container">
        <button
          class="personality-btn"
          onclick={() => (showPersonalityDropdown = !showPersonalityDropdown)}
          title="Change commentator personality"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={currentPersonalityOption.icon} />
          </svg>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="chevron"
            class:rotated={showPersonalityDropdown}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        {#if showPersonalityDropdown}
          <div class="personality-dropdown">
            {#each personalities as p}
              <button
                class="personality-option"
                class:active={currentPersonality === p.id}
                onclick={() => selectPersonality(p.id)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d={p.icon} />
                </svg>
                <div class="personality-info">
                  <span class="personality-label">{p.label}</span>
                  <span class="personality-desc">{p.description}</span>
                </div>
                {#if currentPersonality === p.id}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="check-icon"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Verbosity Selector (segmented control) -->
      <div class="verbosity-selector" title="Commentary verbosity">
        {#each verbosityOptions as opt}
          <button
            class="verbosity-btn"
            class:active={currentVerbosity === opt.id}
            onclick={() => selectVerbosity(opt.id)}
            title="{opt.label}: {opt.description}"
          >
            {opt.shortLabel}
          </button>
        {/each}
      </div>

      <!-- Clear History Button -->
      <button
        class="clear-btn"
        onclick={clearHistory}
        title="Clear commentary history"
        disabled={history.length === 0}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          ></path>
        </svg>
      </button>

      <!-- Export Button -->
      <button
        class="export-btn"
        onclick={() => (showExportModal = true)}
        title="Export commentary"
        disabled={history.length === 0}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      <!-- TTS Toggle -->
      <button
        class="tts-btn"
        class:active={ttsEnabled}
        onclick={toggleTts}
        title={ttsEnabled ? 'Disable text-to-speech' : 'Enable text-to-speech'}
      >
        {#if ttsEnabled}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
        {:else}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          </svg>
        {/if}
      </button>

      <!-- Toggle Commentary (Pause/Resume) -->
      <button
        class="toggle-btn"
        class:active={isActive}
        onclick={toggleCommentary}
        title={isActive ? 'Pause commentary' : 'Resume commentary'}
      >
        {#if isActive}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        {:else}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <!-- TTS Volume Control (shown when TTS is enabled) -->
  {#if ttsEnabled}
    <div class="tts-controls">
      <div class="volume-control">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={ttsVolume}
          oninput={handleVolumeChange}
          class="volume-slider"
          title="TTS Volume"
        />
        <span class="volume-label">{Math.round(ttsVolume * 100)}%</span>
      </div>
    </div>
  {/if}

  <!-- View mode tabs: Live / Past -->
  {#if workspacePath}
    <div class="view-tabs">
      <button
        class="view-tab"
        class:active={viewMode === 'live'}
        onclick={() => setViewMode('live')}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Live
        {#if isActive}
          <span class="tab-live-dot"></span>
        {/if}
      </button>
      <button
        class="view-tab"
        class:active={viewMode === 'timeline'}
        onclick={() => setViewMode('timeline')}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="20" x2="12" y2="4" />
          <polyline points="6 10 12 4 18 10" />
        </svg>
        Past
      </button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="commentary-content" bind:this={contentEl} onscroll={handleScroll}>
    {#if !workspacePath}
      <div class="empty-state">
        <div class="empty-icon">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
            />
          </svg>
        </div>
        Open a workspace to start live commentary.
      </div>
    {:else if viewMode === 'live'}
      <!-- === LIVE VIEW === -->
      {#if error}
        <div class="error-state">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Error: {error}</span>
        </div>
      {:else if !isActive && history.length === 0}
        <div class="empty-state">
          <div class="empty-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
              />
            </svg>
          </div>
          Press play to start commentary.
        </div>
      {:else}
        <!-- Latest commentary (larger) -->
        {#if commentaryText}
          <div class="latest-commentary">
            <div class="commentary-bubble">
              {commentaryText}
            </div>
            {#if !isActive}
              <div class="status-badge stopped">Paused</div>
            {/if}
          </div>
        {/if}

        <!-- History -->
        {#if history.length > 1}
          <div class="history-section">
            <div class="history-header">Previous Commentary</div>
            <div class="history-list">
              {#each history.slice(0, -1).reverse() as entry (entry.timestamp)}
                <div class="history-item">
                  <div class="history-time">{formatTime(entry.timestamp)}</div>
                  <div class="history-text">{entry.text}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    {:else}
      <!-- === TIMELINE VIEW (Past Commentary) === -->
      {#if timelineLoading && timelineEntries.length === 0}
        <div class="empty-state">
          <div class="timeline-spinner"></div>
          Loading commentary history…
        </div>
      {:else if timelineEntries.length === 0}
        <div class="empty-state">
          <div class="empty-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 8v4l3 3" />
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>
          No past commentary stored.
          <p class="empty-hint">Commentary is saved when history storage is enabled in settings.</p>
        </div>
      {:else}
        <div class="timeline">
          <div class="timeline-actions">
            <button
              class="timeline-refresh-btn"
              onclick={() => loadTimeline(false)}
              title="Refresh timeline"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Refresh
            </button>
            <span class="timeline-count">{timelineEntries.length} entries</span>
          </div>

          <div class="timeline-list">
            {#each timelineEntries as entry, i (entry.timestamp + '-' + i)}
              <div class="timeline-entry">
                <div class="timeline-dot-col">
                  <div class="timeline-dot"></div>
                  {#if i < timelineEntries.length - 1}
                    <div class="timeline-line"></div>
                  {/if}
                </div>
                <div class="timeline-entry-content">
                  <div class="timeline-entry-meta">
                    <span class="timeline-entry-time"
                      >{formatTimelineTimestamp(entry.timestamp)}</span
                    >
                    <span class="timeline-entry-personality"
                      >{personalityLabels[entry.personality] || entry.personality}</span
                    >
                  </div>
                  <div class="timeline-entry-text">{entry.text}</div>
                </div>
              </div>
            {/each}
          </div>

          {#if timelineHasMore}
            <button
              class="timeline-load-more"
              onclick={loadMoreTimeline}
              disabled={timelineLoading}
            >
              {timelineLoading ? 'Loading…' : 'Load more'}
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Auto-scroll indicator (shown when user scrolled up in live mode) -->
  {#if viewMode === 'live' && !autoScroll && history.length > 0}
    <button
      class="scroll-to-bottom"
      onclick={() => {
        autoScroll = true;
        if (contentEl) contentEl.scrollTop = contentEl.scrollHeight;
      }}
      title="Scroll to latest"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
      New commentary
    </button>
  {/if}
</div>

<CommentaryExportModal
  bind:show={showExportModal}
  {history}
  {workspacePath}
  {workspaceId}
  onClose={() => (showExportModal = false)}
/>

<style>
  .commentary-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px 8px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .personality-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .personality-indicator-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  .personality-indicator-name {
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .personality-dropdown-container {
    position: relative;
  }

  .personality-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-secondary);
    transition: all var(--transition);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .personality-btn:hover {
    border-color: var(--border-primary);
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .personality-btn .chevron {
    transition: transform var(--transition);
  }

  .personality-btn .chevron.rotated {
    transform: rotate(180deg);
  }

  .personality-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 260px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    overflow: hidden;
  }

  .personality-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-secondary);
    cursor: pointer;
    transition: background var(--transition);
    text-align: left;
  }

  .personality-option:last-child {
    border-bottom: none;
  }

  .personality-option:hover {
    background: var(--bg-hover);
  }

  .personality-option.active {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .personality-option svg {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }

  .personality-option.active svg {
    color: var(--accent-primary);
  }

  .personality-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .personality-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .personality-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .check-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  .clear-btn {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .clear-btn:hover:not(:disabled) {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
  }

  .clear-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .export-btn {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .export-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .export-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .toggle-btn {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .toggle-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .toggle-btn.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  .tts-btn {
    width: 28px;
    height: 26px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .tts-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .tts-btn.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  .tts-controls {
    padding: 8px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .volume-control {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .volume-control svg {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }

  .volume-slider {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--bg-tertiary);
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }

  .volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
    transition: transform var(--transition);
  }

  .volume-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  .volume-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
    border: none;
    transition: transform var(--transition);
  }

  .volume-slider::-moz-range-thumb:hover {
    transform: scale(1.2);
  }

  .volume-label {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    font-weight: 600;
    min-width: 32px;
    text-align: right;
  }

  .commentary-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    scroll-behavior: smooth;
  }

  .empty-state {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 24px 16px;
    line-height: 1.6;
  }

  .empty-icon {
    display: flex;
    justify-content: center;
    margin-bottom: 12px;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--accent-error);
    font-size: var(--fs-sm);
    padding: 24px 16px;
  }

  .latest-commentary {
    margin-bottom: 16px;
  }

  .commentary-bubble {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    font-size: var(--fs-sm);
    line-height: 1.6;
    color: var(--text-primary);
    position: relative;
  }

  .status-badge {
    display: inline-block;
    margin-top: 8px;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-badge.stopped {
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    border: 1px solid var(--border-secondary);
  }

  .history-section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border-secondary);
  }

  .history-header {
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    margin-bottom: 8px;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .history-item {
    padding: 8px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
  }

  .history-time {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }

  .history-text {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .scroll-to-bottom {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border-radius: 12px;
    background: var(--accent-primary);
    color: white;
    border: none;
    cursor: pointer;
    font-size: var(--fs-xxs);
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: all var(--transition);
    z-index: 10;
  }

  .scroll-to-bottom:hover {
    background: color-mix(in srgb, var(--accent-primary) 90%, black);
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
  }

  /* --- View mode tabs --- */

  .view-tabs {
    display: flex;
    gap: 0;
    padding: 0 14px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .view-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    transition: all var(--transition);
  }

  .view-tab:hover {
    color: var(--text-secondary);
  }

  .view-tab.active {
    color: var(--accent-primary);
    border-bottom-color: var(--accent-primary);
  }

  .tab-live-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: pulse 2s ease-in-out infinite;
  }

  /* --- Timeline view --- */

  .empty-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-top: 8px;
  }

  .timeline-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-secondary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 8px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .timeline {
    padding-bottom: 8px;
  }

  .timeline-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2px 10px;
  }

  .timeline-refresh-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
    font-weight: 600;
    transition: all var(--transition);
  }

  .timeline-refresh-btn:hover {
    color: var(--text-secondary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .timeline-count {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
  }

  .timeline-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .timeline-entry {
    display: flex;
    gap: 10px;
    padding: 0;
  }

  .timeline-dot-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    width: 14px;
    padding-top: 4px;
  }

  .timeline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
    border: 2px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }

  .timeline-line {
    width: 2px;
    flex: 1;
    background: var(--border-secondary);
    min-height: 8px;
  }

  .timeline-entry-content {
    flex: 1;
    min-width: 0;
    padding-bottom: 14px;
  }

  .timeline-entry-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .timeline-entry-time {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
    white-space: nowrap;
  }

  .timeline-entry-personality {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 1px 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .timeline-entry-text {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
  }

  .timeline-load-more {
    display: block;
    width: 100%;
    padding: 8px;
    margin-top: 8px;
    background: transparent;
    border: 1px dashed var(--border-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
    font-weight: 600;
    transition: all var(--transition);
  }

  .timeline-load-more:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 5%, transparent);
  }

  .timeline-load-more:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* --- Verbosity selector --- */

  .verbosity-selector {
    display: flex;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
  }

  .verbosity-btn {
    padding: 3px 6px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 600;
    transition: all var(--transition);
    white-space: nowrap;
    line-height: 1;
  }

  .verbosity-btn:last-child {
    border-right: none;
  }

  .verbosity-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .verbosity-btn.active {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    font-weight: 700;
  }
</style>
