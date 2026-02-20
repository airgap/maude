<script lang="ts">
  import { api } from '$lib/api/client';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { managerCommentaryStore } from '$lib/stores/manager-commentary.svelte';
  import { onMount, onDestroy } from 'svelte';
  import type { WorkspaceSettings } from '@e/shared';

  // ---- Types ----
  type CommentaryPersonality =
    | 'sports_announcer'
    | 'documentary_narrator'
    | 'technical_analyst'
    | 'comedic_observer'
    | 'project_lead';

  interface PersonalityOption {
    id: CommentaryPersonality;
    label: string;
    icon: string;
  }

  interface WorkspaceStatus {
    id: string;
    name: string;
    path: string;
    agentStatus: 'idle' | 'running' | 'waiting';
    activeLoops: any[];
    activeSessions: any[];
    pendingApprovals: any[];
    lastOpened: number;
    settings?: WorkspaceSettings;
  }

  interface PendingApproval {
    sessionId: string;
    conversationId: string;
    conversationTitle: string;
    workspacePath: string | null;
    toolCallId: string;
    toolName: string;
    description: string;
  }

  interface StoryEntry {
    id: string;
    title: string;
    status: string;
    workspace_path: string;
    updated_at: number;
    prd_id: string | null;
    conversation_id?: string | null;
    prd_name: string | null;
    attempts?: number | null;
    max_attempts?: number | null;
  }

  interface OverviewData {
    workspaces: WorkspaceStatus[];
    pendingApprovals: PendingApproval[];
    inProgressStories: StoryEntry[];
    completedStories: StoryEntry[];
    summary: {
      totalWorkspaces: number;
      totalPendingApprovals: number;
      totalRunningAgents: number;
      totalActiveLoops: number;
      totalCompletedToday: number;
    };
  }

  // ---- Personality Options ----
  const personalities: PersonalityOption[] = [
    {
      id: 'sports_announcer',
      label: 'Sports',
      icon: 'M3 8L15 1l-6.026 13.634L12 21l9-13h-7.971L21 1z',
    },
    {
      id: 'documentary_narrator',
      label: 'Documentary',
      icon: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    },
    {
      id: 'technical_analyst',
      label: 'Technical',
      icon: 'M3 3l18 18M9 9v6a3 3 0 0 0 5.12 2.12M15 15V9a3 3 0 0 0-3-3M3 12h18M12 3v18',
    },
    {
      id: 'comedic_observer',
      label: 'Comedic',
      icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
    },
    {
      id: 'project_lead',
      label: 'Lead',
      icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    },
  ];

  // ---- State ----
  let loading = $state(false);
  let error = $state<string | null>(null);
  let data = $state<OverviewData | null>(null);
  let lastRefresh = $state<Date | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let evtSource: EventSource | null = null;
  let openPersonalityDropdown = $state<string | null>(null); // workspace ID with open dropdown

  // Derived: expanded workspace from the manager commentary store
  let expandedWsId = $derived(managerCommentaryStore.expandedWorkspaceId);

  // ---- Load ----
  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api.manager.overview();
      data = res.data;
      lastRefresh = new Date();
    } catch (e: any) {
      error = e?.message ?? 'Failed to load manager overview';
    } finally {
      loading = false;
    }
  }

  // ---- SSE for real-time updates ----
  function connectSSE() {
    if (typeof EventSource === 'undefined') return;
    evtSource?.close();
    evtSource = new EventSource('/api/manager/events');
    evtSource.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type !== 'ping') {
          // Re-fetch overview on any meaningful event
          load();
        }
      } catch {}
    };
    evtSource.onerror = () => {
      // Will auto-reconnect
    };
  }

  // ---- Navigation ----
  function openConversation(conversationId: string, title: string) {
    primaryPaneStore.openConversation(conversationId, title);
    uiStore.setSidebarTab('conversations');
  }

  // ---- Workspace status helpers ----
  function statusDot(status: 'idle' | 'running' | 'waiting'): string {
    switch (status) {
      case 'running':
        return 'var(--accent-primary)';
      case 'waiting':
        return 'var(--accent-warning, #f59e0b)';
      case 'idle':
      default:
        return 'var(--text-tertiary)';
    }
  }

  function statusLabel(status: 'idle' | 'running' | 'waiting'): string {
    switch (status) {
      case 'running':
        return 'running';
      case 'waiting':
        return 'waiting';
      default:
        return 'idle';
    }
  }

  function formatTime(ms: number): string {
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  function formatCommentaryTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function workspaceName(path: string | null | undefined): string {
    if (!path) return 'Unknown';
    const ws = workspaceListStore.workspaces.find((w) => w.path === path);
    if (ws) return ws.name;
    return path.split('/').pop() ?? path;
  }

  // ---- Commentary Controls ----

  /**
   * Auto-start commentary SSE connections for active (non-muted) workspaces.
   * This effect runs whenever the workspace data changes.
   */
  $effect(() => {
    if (!data?.workspaces) return;

    for (const ws of data.workspaces) {
      const isMuted = ws.settings?.commentaryMuted ?? false;
      const isAlreadyActive = managerCommentaryStore.isActive(ws.id);

      if (!isMuted && !isAlreadyActive && ws.agentStatus !== 'idle') {
        // Start commentary for active, non-muted workspaces
        const personality = ws.settings?.commentaryPersonality || 'technical_analyst';
        managerCommentaryStore.startCommentary(ws.id, personality);
      } else if (isMuted && isAlreadyActive) {
        // Stop commentary for muted workspaces
        managerCommentaryStore.stopCommentary(ws.id);
      }
    }
  });

  async function toggleCommentaryMute(ws: WorkspaceStatus) {
    const currentMuted = ws.settings?.commentaryMuted ?? false;
    const newMuted = !currentMuted;
    try {
      await api.workspaces.update(ws.id, {
        settings: {
          commentaryMuted: newMuted,
        },
      });
      // Update local state
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            commentaryMuted: newMuted,
          };
        }
      }
      // Update the manager commentary store
      managerCommentaryStore.setMuted(ws.id, newMuted);

      // If unmuting, restart commentary
      if (!newMuted && ws.agentStatus !== 'idle') {
        const personality = ws.settings?.commentaryPersonality || 'technical_analyst';
        managerCommentaryStore.startCommentary(ws.id, personality);
      }
    } catch (err) {
      console.error('Failed to toggle commentary mute:', err);
      uiStore.toast('Failed to update commentary settings', 'error');
    }
  }

  async function toggleCommentaryHistory(ws: WorkspaceStatus) {
    const currentEnabled = ws.settings?.commentaryHistoryEnabled ?? true; // Defaults to enabled
    try {
      await api.workspaces.update(ws.id, {
        settings: {
          commentaryHistoryEnabled: !currentEnabled,
        },
      });
      // Update local state
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            commentaryHistoryEnabled: !currentEnabled,
          };
        }
      }
      uiStore.toast(
        !currentEnabled ? 'Commentary history enabled' : 'Commentary history disabled',
        'info',
      );
    } catch (err) {
      console.error('Failed to toggle commentary history:', err);
      uiStore.toast('Failed to update commentary history setting', 'error');
    }
  }

  async function setCommentaryPersonality(ws: WorkspaceStatus, personality: CommentaryPersonality) {
    openPersonalityDropdown = null;
    try {
      await api.workspaces.update(ws.id, {
        settings: {
          commentaryPersonality: personality,
        },
      });
      // Update local state
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            commentaryPersonality: personality,
          };
        }
      }
      // If commentary is active for this workspace, restart with new personality
      if (managerCommentaryStore.isActive(ws.id)) {
        managerCommentaryStore.startCommentary(ws.id, personality);
      }
    } catch (err) {
      console.error('Failed to set commentary personality:', err);
      uiStore.toast('Failed to update commentary personality', 'error');
    }
  }

  function togglePersonalityDropdown(wsId: string) {
    openPersonalityDropdown = openPersonalityDropdown === wsId ? null : wsId;
  }

  // Close dropdown when clicking outside
  $effect(() => {
    if (openPersonalityDropdown) {
      const handler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.ws-personality-dropdown')) {
          openPersonalityDropdown = null;
        }
      };
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  });

  // ---- Lifecycle ----
  onMount(() => {
    load();
    connectSSE();
    // Poll every 30s as fallback
    refreshInterval = setInterval(load, 30_000);
  });

  onDestroy(() => {
    evtSource?.close();
    if (refreshInterval) clearInterval(refreshInterval);
    // Clean up all commentary SSE connections
    managerCommentaryStore.stopAll();
  });
</script>

<div class="manager-panel">
  <!-- Header -->
  <div class="panel-header">
    <h3 class="panel-title">Manager View</h3>
    <div class="header-actions">
      {#if lastRefresh}
        <span class="last-refresh" title={lastRefresh.toLocaleTimeString()}>
          {formatTime(lastRefresh.getTime())}
        </span>
      {/if}
      <button class="btn-refresh" onclick={load} disabled={loading} title="Refresh">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class:spinning={loading}
        >
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>
  </div>

  {#if error}
    <div class="error-msg">{error}</div>
  {/if}

  {#if data}
    <!-- Summary Stats -->
    <div class="stats-row">
      <div class="stat-chip" class:active={data.summary.totalRunningAgents > 0}>
        <span class="stat-num">{data.summary.totalRunningAgents}</span>
        <span class="stat-lbl">Running</span>
      </div>
      <div class="stat-chip" class:warn={data.summary.totalPendingApprovals > 0}>
        <span class="stat-num">{data.summary.totalPendingApprovals}</span>
        <span class="stat-lbl">Waiting</span>
      </div>
      <div class="stat-chip">
        <span class="stat-num">{data.summary.totalActiveLoops}</span>
        <span class="stat-lbl">Loops</span>
      </div>
      <div class="stat-chip">
        <span class="stat-num">{data.summary.totalCompletedToday}</span>
        <span class="stat-lbl">Done Today</span>
      </div>
    </div>

    <!-- Inbox: Pending Approvals -->
    {#if data.pendingApprovals.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            <span class="dot" style:background="var(--accent-warning, #f59e0b)"></span>
            Pending Approvals
            <span class="badge warn">{data.pendingApprovals.length}</span>
          </span>
        </div>
        <div class="item-list">
          {#each data.pendingApprovals as approval (approval.toolCallId)}
            <button
              class="inbox-item clickable"
              onclick={() => openConversation(approval.conversationId, approval.conversationTitle)}
            >
              <div class="inbox-item-top">
                <span class="tool-badge">{approval.toolName}</span>
                {#if approval.workspacePath}
                  <span class="ws-chip">{workspaceName(approval.workspacePath)}</span>
                {/if}
              </div>
              <div class="inbox-item-desc">{approval.description}</div>
              <div class="inbox-item-sub">{approval.conversationTitle}</div>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- In-Progress Stories -->
    {#if data.inProgressStories.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            <span class="dot spin-dot" style:background="var(--accent-primary)"></span>
            In Progress
            <span class="badge">{data.inProgressStories.length}</span>
          </span>
        </div>
        <div class="item-list">
          {#each data.inProgressStories as story (story.id)}
            <div
              class="inbox-item"
              class:clickable={!!story.conversation_id}
              role={story.conversation_id ? 'button' : undefined}
              tabindex={story.conversation_id ? 0 : undefined}
              onclick={() => {
                if (story.conversation_id) {
                  openConversation(story.conversation_id, story.title);
                }
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' && story.conversation_id) {
                  openConversation(story.conversation_id, story.title);
                }
              }}
            >
              <div class="inbox-item-top">
                <span class="story-title">{story.title}</span>
              </div>
              <div class="inbox-item-sub">
                {workspaceName(story.workspace_path)}
                {#if story.prd_name}
                  · {story.prd_name}
                {/if}
                · attempt {story.attempts ?? '?'}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Workspace Status -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Workspaces</span>
      </div>
      <div class="workspace-list">
        {#each data.workspaces as ws (ws.id)}
          {@const wsCommentary = managerCommentaryStore.getWorkspaceState(ws.id)}
          {@const wsEntries = managerCommentaryStore.getEntries(ws.id)}
          {@const isCommentaryActive = managerCommentaryStore.isActive(ws.id)}
          {@const isMuted = ws.settings?.commentaryMuted ?? false}
          {@const isExpanded = expandedWsId === ws.id}
          <div class="workspace-card" class:muted={isMuted} class:expanded={isExpanded}>
            <!-- Workspace Header Row -->
            <div class="workspace-card-header">
              <span
                class="ws-dot"
                style:background={statusDot(ws.agentStatus)}
                class:ws-dot-pulse={ws.agentStatus === 'running'}
              ></span>
              <div class="ws-info">
                <span class="ws-name">
                  {ws.name}
                  {#if isCommentaryActive && !isMuted}
                    <span class="commentary-live-dot" title="Commentary active"></span>
                  {/if}
                </span>
                <span class="ws-meta">
                  <span class="ws-status">{statusLabel(ws.agentStatus)}</span>
                  {#if ws.activeLoops.length > 0}
                    · {ws.activeLoops.length} loop{ws.activeLoops.length !== 1 ? 's' : ''}
                  {/if}
                  {#if ws.activeSessions.length > 0}
                    · {ws.activeSessions.length} session{ws.activeSessions.length !== 1 ? 's' : ''}
                  {/if}
                </span>
              </div>
              {#if ws.pendingApprovals.length > 0}
                <span class="badge warn sm">{ws.pendingApprovals.length}</span>
              {/if}
              <div class="ws-commentary-controls">
                <!-- Personality Selector -->
                <div class="ws-personality-dropdown">
                  <button
                    class="ws-control-btn"
                    class:active={!isMuted}
                    onclick={(e) => {
                      e.stopPropagation();
                      togglePersonalityDropdown(ws.id);
                    }}
                    title="Change commentary personality"
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
                      <path
                        d={personalities.find(
                          (p) =>
                            p.id === (ws.settings?.commentaryPersonality || 'sports_announcer'),
                        )?.icon || ''}
                      />
                    </svg>
                  </button>

                  {#if openPersonalityDropdown === ws.id}
                    <div class="personality-dropdown" onclick={(e) => e.stopPropagation()}>
                      {#each personalities as p}
                        <button
                          class="personality-option"
                          class:active={(ws.settings?.commentaryPersonality ||
                            'sports_announcer') === p.id}
                          onclick={() => setCommentaryPersonality(ws, p.id)}
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
                            <path d={p.icon} />
                          </svg>
                          <span class="personality-label">{p.label}</span>
                          {#if (ws.settings?.commentaryPersonality || 'sports_announcer') === p.id}
                            <svg
                              width="12"
                              height="12"
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

                <!-- Mute/Unmute Button -->
                <button
                  class="ws-control-btn"
                  class:muted={isMuted}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleCommentaryMute(ws);
                  }}
                  title={isMuted ? 'Unmute commentary' : 'Mute commentary'}
                >
                  {#if isMuted}
                    <!-- Volume X (muted) icon -->
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
                      <line x1="23" y1="9" x2="17" y2="15"></line>
                      <line x1="17" y1="9" x2="23" y2="15"></line>
                    </svg>
                  {:else}
                    <!-- Volume 2 (active) icon -->
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
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                  {/if}
                </button>

                <!-- History Toggle Button -->
                <button
                  class="ws-control-btn"
                  class:active={ws.settings?.commentaryHistoryEnabled !== false}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleCommentaryHistory(ws);
                  }}
                  title={ws.settings?.commentaryHistoryEnabled !== false
                    ? 'Disable commentary history'
                    : 'Enable commentary history'}
                >
                  {#if ws.settings?.commentaryHistoryEnabled === false}
                    <!-- History disabled icon (book with X) -->
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
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      <line x1="18" y1="6" x2="10" y2="14" />
                      <line x1="10" y1="6" x2="18" y2="14" />
                    </svg>
                  {:else}
                    <!-- History enabled icon (book) -->
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
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  {/if}
                </button>
              </div>
            </div>

            <!-- Commentary Feed Area -->
            {#if !isMuted && wsEntries.length > 0}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="ws-commentary-feed"
                class:expanded={isExpanded}
                onclick={() => managerCommentaryStore.toggleExpanded(ws.id)}
                title={isExpanded ? 'Collapse commentary' : 'Expand commentary'}
              >
                <div class="commentary-feed-header">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="commentary-mic-icon"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </svg>
                  <span class="commentary-feed-label">Commentary</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="commentary-chevron"
                    class:rotated={isExpanded}
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
                <div class="commentary-entries">
                  {#each isExpanded ? wsEntries : wsEntries.slice(-2) as entry (entry.timestamp)}
                    <div class="commentary-entry">
                      <span class="commentary-time">{formatCommentaryTime(entry.timestamp)}</span>
                      <span class="commentary-text">{entry.text}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {:else if !isMuted && isCommentaryActive}
              <!-- Active but no entries yet -->
              <div class="ws-commentary-feed waiting">
                <div class="commentary-feed-header">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="commentary-mic-icon"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </svg>
                  <span class="commentary-feed-label waiting-text">Listening...</span>
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty">No workspaces</div>
        {/each}
      </div>
    </div>

    <!-- Completed Work (last 24h) -->
    {#if data.completedStories.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            Completed Today
            <span class="badge success"
              >{data.completedStories.filter((s) => s.status === 'completed').length}</span
            >
          </span>
        </div>
        <div class="item-list">
          {#each data.completedStories as story (story.id)}
            <div class="story-row" class:failed={story.status === 'failed'}>
              <span class="story-check"
                >{#if story.status === 'completed'}<svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-success, #10b981)"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg
                  >{:else}<svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-error)"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><line x1="18" y1="6" x2="6" y2="18" /><line
                      x1="6"
                      y1="6"
                      x2="18"
                      y2="18"
                    /></svg
                  >{/if}</span
              >
              <div class="story-info">
                <span class="story-title-sm">{story.title}</span>
                <span class="story-meta">
                  {workspaceName(story.workspace_path)}
                  {#if story.prd_name}· {story.prd_name}{/if}
                  · {formatTime(story.updated_at)}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if data.pendingApprovals.length === 0 && data.inProgressStories.length === 0 && data.completedStories.length === 0}
      <div class="empty-state">
        <div class="empty-icon">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle
              cx="12"
              cy="12"
              r="2"
            /></svg
          >
        </div>
        <div class="empty-text">All quiet. No active agents or pending approvals.</div>
      </div>
    {/if}
  {:else if loading}
    <div class="loading">Loading...</div>
  {/if}
</div>

<style>
  .manager-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    height: 100%;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .panel-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .last-refresh {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .btn-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    transition: all var(--transition);
  }
  .btn-refresh:hover:not(:disabled) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .btn-refresh:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .spinning {
    animation: spin 0.8s linear infinite;
  }

  .error-msg {
    font-size: var(--fs-sm);
    color: var(--accent-error);
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
  }

  /* Stats row */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }

  .stat-chip {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 6px;
    text-align: center;
    border: 1px solid transparent;
    transition: border-color var(--transition);
  }
  .stat-chip.active {
    border-color: var(--accent-primary);
  }
  .stat-chip.warn {
    border-color: var(--accent-warning, #f59e0b);
  }

  .stat-num {
    display: block;
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .stat-lbl {
    display: block;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 2px;
  }

  /* Sections */
  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  @keyframes pulse-dot {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
  .spin-dot {
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  .badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    padding: 1px 5px;
    border-radius: 999px;
    min-width: 16px;
    text-align: center;
  }
  .badge.warn {
    background: color-mix(in srgb, var(--accent-warning, #f59e0b) 20%, transparent);
    color: var(--accent-warning, #f59e0b);
  }
  .badge.success {
    background: color-mix(in srgb, var(--accent-success, #10b981) 20%, transparent);
    color: var(--accent-success, #10b981);
  }
  .badge.sm {
    font-size: var(--fs-xxs);
    padding: 1px 4px;
  }

  /* Item lists */
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .inbox-item {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid transparent;
    transition: all var(--transition);
    text-align: left;
    width: 100%;
  }
  .inbox-item.clickable {
    cursor: pointer;
  }
  .inbox-item.clickable:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .inbox-item-top {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }

  .tool-badge {
    font-size: var(--fs-xxs);
    font-weight: 600;
    font-family: var(--font-family-mono, monospace);
    background: var(--bg-tertiary);
    color: var(--accent-primary);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .ws-chip {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .inbox-item-desc {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inbox-item-sub {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .story-title {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  /* Workspace cards */
  .workspace-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .workspace-card {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    transition: all var(--transition);
    overflow: hidden;
  }

  .workspace-card.muted {
    opacity: 0.6;
    border-color: var(--border-secondary);
  }

  .workspace-card.expanded {
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }

  .workspace-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
  }

  .ws-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: box-shadow var(--transition);
  }

  .ws-dot-pulse {
    box-shadow: 0 0 0 0 var(--accent-primary);
    animation: ws-dot-ring 2s ease-in-out infinite;
  }

  @keyframes ws-dot-ring {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 40%, transparent);
    }
    70% {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-primary) 0%, transparent);
    }
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 0%, transparent);
    }
  }

  .ws-info {
    flex: 1;
    min-width: 0;
  }

  .ws-name {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Pulsing dot when commentary is active */
  .commentary-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
    animation: commentary-pulse 2s ease-in-out infinite;
  }

  @keyframes commentary-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.3;
      transform: scale(0.8);
    }
  }

  .ws-meta {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .ws-status {
    color: var(--text-tertiary);
  }

  .ws-commentary-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .ws-personality-dropdown {
    position: relative;
  }

  .ws-control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .ws-control-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .ws-control-btn.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .ws-control-btn.muted {
    color: var(--accent-error);
    border-color: var(--border-secondary);
  }

  .ws-control-btn.muted:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
  }

  .personality-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 140px;
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
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
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

  .personality-label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
  }

  .check-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  /* Commentary Feed Area */
  .ws-commentary-feed {
    border-top: 1px solid var(--border-secondary);
    padding: 4px 8px 6px;
    cursor: pointer;
    transition: all var(--transition);
    background: color-mix(in srgb, var(--accent-primary) 3%, transparent);
  }

  .ws-commentary-feed:hover {
    background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
  }

  .ws-commentary-feed.expanded {
    background: color-mix(in srgb, var(--accent-primary) 5%, transparent);
  }

  .ws-commentary-feed.waiting {
    cursor: default;
  }

  .commentary-feed-header {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }

  .commentary-mic-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
    opacity: 0.7;
  }

  .commentary-feed-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent-primary);
    opacity: 0.7;
    flex: 1;
  }

  .waiting-text {
    font-style: italic;
    font-weight: 600;
    opacity: 0.5;
    animation: pulse-dot 2s ease-in-out infinite;
  }

  .commentary-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
  }

  .commentary-chevron.rotated {
    transform: rotate(180deg);
  }

  .commentary-entries {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .commentary-entry {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }

  .commentary-time {
    flex-shrink: 0;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    opacity: 0.7;
    font-family: var(--font-family-mono, monospace);
    line-height: 1.5;
    min-width: 40px;
  }

  .commentary-text {
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .ws-commentary-feed.expanded .commentary-text {
    -webkit-line-clamp: unset;
    overflow: visible;
  }

  /* Completed stories */
  .story-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
  }
  .story-row.failed {
    opacity: 0.6;
  }

  .story-check {
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
  }

  .story-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .story-title-sm {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .story-meta {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Empty states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-tertiary);
  }

  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
  }

  .empty-text {
    font-size: var(--fs-sm);
    text-align: center;
    line-height: 1.5;
  }

  .empty {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    padding: 8px;
    text-align: center;
  }

  .loading {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    padding: 20px;
    text-align: center;
  }
</style>
