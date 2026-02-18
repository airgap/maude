<script lang="ts">
  import { api } from '$lib/api/client';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { onMount, onDestroy } from 'svelte';

  // ---- Types ----
  interface WorkspaceStatus {
    id: string;
    name: string;
    path: string;
    agentStatus: 'idle' | 'running' | 'waiting';
    activeLoops: any[];
    activeSessions: any[];
    pendingApprovals: any[];
    lastOpened: number;
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

  // ---- State ----
  let loading = $state(false);
  let error = $state<string | null>(null);
  let data = $state<OverviewData | null>(null);
  let lastRefresh = $state<Date | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let evtSource: EventSource | null = null;

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

  function workspaceName(path: string): string {
    const ws = workspaceListStore.workspaces.find((w) => w.path === path);
    if (ws) return ws.name;
    return path.split('/').pop() ?? path;
  }

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
          <div class="workspace-row">
            <span class="ws-dot" style:background={statusDot(ws.agentStatus)}></span>
            <div class="ws-info">
              <span class="ws-name">{ws.name}</span>
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
            <span class="badge success">{data.completedStories.filter((s) => s.status === 'completed').length}</span>
          </span>
        </div>
        <div class="item-list">
          {#each data.completedStories as story (story.id)}
            <div class="story-row" class:failed={story.status === 'failed'}>
              <span class="story-check">{story.status === 'completed' ? '✅' : '❌'}</span>
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
        <div class="empty-icon">🎯</div>
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
    font-size: 13px;
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
    font-size: 10px;
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
    font-size: 12px;
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
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .stat-lbl {
    display: block;
    font-size: 9px;
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
    font-size: 11px;
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
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .spin-dot {
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  .badge {
    font-size: 9px;
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
    font-size: 8px;
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
    font-size: 10px;
    font-weight: 600;
    font-family: var(--font-family-mono, monospace);
    background: var(--bg-tertiary);
    color: var(--accent-primary);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .ws-chip {
    font-size: 10px;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .inbox-item-desc {
    font-size: 11px;
    color: var(--text-primary);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inbox-item-sub {
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .story-title {
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  /* Workspace list */
  .workspace-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .workspace-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
  }

  .ws-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ws-info {
    flex: 1;
    min-width: 0;
  }

  .ws-name {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-meta {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .ws-status {
    color: var(--text-tertiary);
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
    font-size: 11px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .story-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .story-title-sm {
    font-size: 11px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .story-meta {
    font-size: 10px;
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
    font-size: 24px;
  }

  .empty-text {
    font-size: 12px;
    text-align: center;
    line-height: 1.5;
  }

  .empty {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 8px;
    text-align: center;
  }

  .loading {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 20px;
    text-align: center;
  }
</style>
