<script lang="ts">
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { onMount, onDestroy } from 'svelte';

  type NotificationType =
    | 'todo_added'
    | 'test_failure'
    | 'build_error'
    | 'git_conflict'
    | 'type_error';
  type Severity = 'info' | 'warning' | 'error';

  interface AmbientNotification {
    id: string;
    type: NotificationType;
    severity: Severity;
    title: string;
    message: string;
    file?: string;
    line?: number;
    suggestion?: string;
    createdAt: number;
    dismissed: boolean;
  }

  let watching = $state(false);
  let notifications = $state<AmbientNotification[]>([]);
  let loading = $state(false);
  let toggling = $state(false);
  let newIds = $state<Set<string>>(new Set());
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  // Track IDs seen on previous poll to detect new arrivals
  let knownIds = new Set<string>();

  function workspacePath(): string {
    return settingsStore.workspacePath || '.';
  }

  async function loadStatus() {
    try {
      const res = await api.ambient.status(workspacePath());
      watching = res.data.watching ?? false;
    } catch {
      watching = false;
    }
  }

  async function loadNotifications() {
    try {
      const res = await api.ambient.getNotifications(workspacePath());
      const fetched: AmbientNotification[] = (res.data ?? []) as AmbientNotification[];

      // Detect newly arrived notifications
      const fresh = new Set<string>();
      for (const n of fetched) {
        if (!knownIds.has(n.id)) {
          fresh.add(n.id);
          knownIds.add(n.id);
        }
      }
      if (fresh.size > 0) {
        newIds = fresh;
        // Fade out highlight after 3 seconds
        setTimeout(() => {
          newIds = new Set();
        }, 3000);
      }

      notifications = fetched.filter((n) => !n.dismissed);
    } catch {
      // Silently fail polling
    }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      if (watching) {
        await loadNotifications();
      }
    }, 5000);
  }

  async function toggleWatching() {
    if (toggling) return;
    toggling = true;
    try {
      if (watching) {
        await api.ambient.stopWatching(workspacePath());
        watching = false;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      } else {
        await api.ambient.startWatching(workspacePath());
        watching = true;
        await loadNotifications();
        startPolling();
      }
    } catch {
      // Revert on failure
      await loadStatus();
    } finally {
      toggling = false;
    }
  }

  async function dismissNotification(id: string) {
    try {
      await api.ambient.dismissNotification(id);
      notifications = notifications.filter((n) => n.id !== id);
      knownIds.delete(id);
    } catch {
      // Optimistic remove failed; reload
      await loadNotifications();
    }
  }

  async function clearAll() {
    try {
      await api.ambient.clearNotifications(workspacePath());
      notifications = [];
      knownIds.clear();
    } catch {
      await loadNotifications();
    }
  }

  onMount(async () => {
    loading = true;
    await loadStatus();
    if (watching) {
      await loadNotifications();
      // Seed known IDs so existing ones don't flash as new
      for (const n of notifications) knownIds.add(n.id);
      startPolling();
    }
    loading = false;
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  // Helper: relative time
  function timeAgo(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function severityIcon(severity: Severity): string {
    switch (severity) {
      case 'error':
        return '✗';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
    }
  }

  function severityColor(severity: Severity): string {
    switch (severity) {
      case 'error':
        return 'var(--accent-error)';
      case 'warning':
        return 'var(--accent-warning, #e6a817)';
      case 'info':
        return 'var(--accent-primary)';
    }
  }

  function severityBg(severity: Severity): string {
    switch (severity) {
      case 'error':
        return 'rgba(239,68,68,0.06)';
      case 'warning':
        return 'rgba(230,168,23,0.06)';
      case 'info':
        return 'rgba(59,130,246,0.06)';
    }
  }

  function typeLabel(type: NotificationType): string {
    const map: Record<NotificationType, string> = {
      todo_added: 'TODO',
      test_failure: 'TEST',
      build_error: 'BUILD',
      git_conflict: 'CONFLICT',
      type_error: 'TYPE',
    };
    return map[type] ?? type.toUpperCase();
  }
</script>

<div class="ambient-panel">
  <!-- Header -->
  <div class="panel-header">
    <div class="header-left">
      <span class="status-dot" class:active={watching}></span>
      <span class="panel-title">Ambient Watcher</span>
    </div>
    <button
      class="toggle-btn"
      class:on={watching}
      onclick={toggleWatching}
      disabled={toggling}
      title={watching ? 'Stop watching' : 'Start watching'}
      aria-label={watching ? 'Stop watching' : 'Start watching'}
    >
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
    </button>
  </div>

  <!-- Status bar -->
  <div class="status-bar">
    {#if watching}
      <span class="status-active">
        Watching workspace
        {#if notifications.length > 0}
          <span class="notif-count">{notifications.length}</span>
        {/if}
      </span>
    {:else}
      <span class="status-paused">Paused</span>
    {/if}
  </div>

  <!-- Notifications -->
  {#if loading}
    <div class="empty">
      <span class="loading-text">Loading...</span>
    </div>
  {:else if !watching && notifications.length === 0}
    <div class="empty">Enable watching to monitor workspace activity</div>
  {:else if watching && notifications.length === 0}
    <div class="empty all-clear">
      <span class="all-clear-icon">✓</span>
      All clear — no issues detected
    </div>
  {:else}
    <div class="notif-list">
      {#each notifications as n (n.id)}
        <div
          class="notif-card"
          class:notif-new={newIds.has(n.id)}
          style:background={severityBg(n.severity)}
          style:border-left-color={severityColor(n.severity)}
        >
          <!-- Dismiss button -->
          <button
            class="dismiss-btn"
            onclick={() => dismissNotification(n.id)}
            title="Dismiss"
            aria-label="Dismiss notification"
          >
            &times;
          </button>

          <!-- Top row: icon + title + type tag -->
          <div class="notif-top">
            <span class="severity-icon" style:color={severityColor(n.severity)}>
              {severityIcon(n.severity)}
            </span>
            <span class="notif-title">{n.title}</span>
            <span class="type-tag">{typeLabel(n.type)}</span>
          </div>

          <!-- Message -->
          <div class="notif-message">{n.message}</div>

          <!-- File reference -->
          {#if n.file}
            <div class="notif-file">
              {n.file}{#if n.line}:{n.line}{/if}
            </div>
          {/if}

          <!-- Bottom row: suggestion + time -->
          <div class="notif-footer">
            {#if n.suggestion}
              <button
                class="suggestion-btn"
                disabled
                title="Complex action — not yet implemented: {n.suggestion}"
              >
                {n.suggestion}
              </button>
            {:else}
              <span></span>
            {/if}
            <span class="notif-time">{timeAgo(n.createdAt)}</span>
          </div>
        </div>
      {/each}
    </div>

    <!-- Clear all -->
    <div class="panel-footer">
      <button class="clear-btn" onclick={clearAll}>
        Clear All ({notifications.length})
      </button>
    </div>
  {/if}
</div>

<style>
  .ambient-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    font-family: var(--font-family);
  }

  /* Header */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0 4px;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .panel-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Status dot */
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-tertiary);
    flex-shrink: 0;
    transition: background var(--transition);
  }
  .status-dot.active {
    background: #22c55e;
    box-shadow: 0 0 5px rgba(34, 197, 94, 0.6);
    animation: dot-pulse 2.5s ease-in-out infinite;
  }

  /* Toggle switch */
  .toggle-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    opacity: 1;
    transition: opacity var(--transition);
  }
  .toggle-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .toggle-track {
    display: block;
    width: 32px;
    height: 17px;
    border-radius: 9px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    position: relative;
    transition: all var(--transition);
  }
  .toggle-btn.on .toggle-track {
    background: #22c55e;
    border-color: #16a34a;
  }
  .toggle-thumb {
    display: block;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--text-tertiary);
    position: absolute;
    top: 2px;
    left: 2px;
    transition: all var(--transition);
  }
  .toggle-btn.on .toggle-thumb {
    left: 17px;
    background: #fff;
  }

  /* Status bar */
  .status-bar {
    font-size: 10px;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-active {
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
  }
  .status-paused {
    color: var(--text-tertiary);
    font-style: italic;
  }
  .notif-count {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-radius: 2px;
    line-height: 1.5;
  }

  /* Empty states */
  .empty {
    padding: 24px 8px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
    flex: 1;
  }
  .loading-text {
    animation: pulse 1.4s ease-in-out infinite;
  }
  .all-clear {
    color: #22c55e;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .all-clear-icon {
    font-size: 20px;
    font-weight: 700;
  }

  /* Notification list */
  .notif-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 0;
  }

  /* Notification card */
  .notif-card {
    position: relative;
    padding: 8px 28px 8px 10px;
    border: 1px solid var(--border-primary);
    border-left-width: 3px;
    background: var(--bg-tertiary);
    transition: background var(--transition);
  }
  .notif-card.notif-new {
    animation: highlight-fade 3s ease forwards;
  }
  .notif-card:hover {
    border-color: var(--border-secondary);
  }

  /* Dismiss button */
  .dismiss-btn {
    position: absolute;
    top: 6px;
    right: 5px;
    width: 20px;
    height: 20px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--transition),
      color var(--transition);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
  }
  .notif-card:hover .dismiss-btn {
    opacity: 1;
  }
  .dismiss-btn:hover {
    color: var(--accent-error);
    background: var(--bg-hover);
  }

  /* Top row */
  .notif-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }
  .severity-icon {
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
    width: 12px;
    text-align: center;
  }
  .notif-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .type-tag {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    color: var(--text-tertiary);
    flex-shrink: 0;
    line-height: 1.5;
  }

  /* Message */
  .notif-message {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.4;
    margin-left: 18px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* File reference */
  .notif-file {
    font-size: 10px;
    font-family: monospace;
    color: var(--text-tertiary);
    margin-left: 18px;
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Footer: suggestion + time */
  .notif-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-left: 18px;
    margin-top: 5px;
  }
  .suggestion-btn {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 7px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    cursor: not-allowed;
    opacity: 0.65;
    font-family: var(--font-family);
    letter-spacing: 0.3px;
  }
  .notif-time {
    font-size: 9px;
    color: var(--text-tertiary);
    flex-shrink: 0;
    font-family: var(--font-family);
  }

  /* Footer / clear all */
  .panel-footer {
    padding-top: 2px;
    border-top: 1px solid var(--border-primary);
  }
  .clear-btn {
    width: 100%;
    padding: 6px 10px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    transition: all var(--transition);
    font-family: var(--font-family);
  }
  .clear-btn:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: var(--bg-hover);
  }

  /* Animations */
  @keyframes dot-pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 5px rgba(34, 197, 94, 0.6);
    }
    50% {
      opacity: 0.7;
      box-shadow: 0 0 10px rgba(34, 197, 94, 0.8);
    }
  }

  @keyframes highlight-fade {
    0% {
      background: rgba(59, 130, 246, 0.18);
    }
    60% {
      background: rgba(59, 130, 246, 0.08);
    }
    100% {
      background: transparent;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
