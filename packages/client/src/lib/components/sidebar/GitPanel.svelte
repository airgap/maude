<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import { gitStore, type GitFileStatus } from '$lib/stores/git.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';

  // ── Derived state ────────────────────────────────────────────────────────

  let workspacePath = $derived(settingsStore.workspacePath || '');

  let stagedFiles = $derived(gitStore.fileStatuses.filter((f) => f.staged && f.status !== 'U'));
  let unstagedFiles = $derived(gitStore.fileStatuses.filter((f) => !f.staged || f.status === 'U'));

  // ── Local state ──────────────────────────────────────────────────────────

  let loadingKey = $state<string | null>(null);
  let refreshing = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // ── Commit state ─────────────────────────────────────────────────────────

  let commitMessage = $state('');
  let generating = $state(false);
  let committing = $state(false);
  let pushing = $state(false);
  let commitProgress = $state<string[]>([]);
  let pushProgress = $state<string[]>([]);
  let gitError = $state('');
  let showCommitSection = $state(false);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  onMount(() => {
    if (workspacePath) {
      gitStore.refresh(workspacePath);
      pollTimer = setInterval(() => gitStore.refresh(workspacePath), 5000);
    }
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function fileKey(file: GitFileStatus, staged: boolean): string {
    return `${staged ? 'staged' : 'unstaged'}:${file.path}`;
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'M':
        return 'M';
      case 'A':
        return 'A';
      case 'D':
        return 'D';
      case 'R':
        return 'R';
      case 'U':
        return '?';
      default:
        return status;
    }
  }

  function statusTitle(status: string): string {
    switch (status) {
      case 'M':
        return 'Modified';
      case 'A':
        return 'Added';
      case 'D':
        return 'Deleted';
      case 'R':
        return 'Renamed';
      case 'U':
        return 'Untracked';
      default:
        return status;
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'A':
        return 'badge-added';
      case 'D':
        return 'badge-deleted';
      case 'U':
        return 'badge-untracked';
      default:
        return 'badge-modified';
    }
  }

  function basename(path: string): string {
    return path.split('/').pop() ?? path;
  }

  function dirname(path: string): string {
    const parts = path.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function openDiff(file: GitFileStatus, staged: boolean) {
    if (file.status === 'U') return; // untracked — no diff
    const key = fileKey(file, staged);
    loadingKey = key;
    try {
      const res = await api.git.diff(workspacePath, file.path, staged);
      primaryPaneStore.openDiffTab(file.path, res.data.diff, staged);
    } catch (err: any) {
      // Show error as diff content so it's visible in the panel
      primaryPaneStore.openDiffTab(file.path, `Error: ${err?.message ?? err}`, staged);
    } finally {
      loadingKey = null;
    }
  }

  async function refresh() {
    if (!workspacePath) return;
    refreshing = true;
    await gitStore.refresh(workspacePath);
    refreshing = false;
  }

  // ── Commit actions ───────────────────────────────────────────────────────

  async function handleGenerateMessage() {
    if (generating || committing) return;
    generating = true;
    gitError = '';
    try {
      const res = await api.git.generateCommitMessage(workspacePath);
      if (res.ok && res.data.message) {
        commitMessage = res.data.message;
      } else {
        gitError = 'Could not generate message';
      }
    } catch {
      gitError = 'Failed to generate message';
    }
    generating = false;
  }

  async function handleCommit() {
    if (!commitMessage.trim() || committing) return;
    committing = true;
    gitError = '';
    commitProgress = [];
    showCommitSection = true;

    const result = await api.git.commitStream(workspacePath, commitMessage.trim(), (event) => {
      if (event.type === 'status') {
        commitProgress = [...commitProgress, event.message || ''];
      } else if (event.type === 'output') {
        commitProgress = [...commitProgress, event.message || ''];
      } else if (event.type === 'error') {
        gitError = event.message || 'Commit failed';
      }
    });

    committing = false;
    if (result.ok) {
      await gitStore.refresh(workspacePath);
      // Auto-clear on success
      setTimeout(() => {
        if (!gitError) {
          commitMessage = '';
          commitProgress = [];
        }
      }, 2000);
    } else {
      gitError = result.error || 'Commit failed';
    }
  }

  async function handlePush() {
    if (pushing) return;
    pushing = true;
    gitError = '';
    pushProgress = [];
    showCommitSection = true;

    const result = await api.git.pushStream(workspacePath, (event) => {
      if (event.type === 'status') {
        pushProgress = [...pushProgress, event.message || ''];
      } else if (event.type === 'output') {
        pushProgress = [...pushProgress, event.message || ''];
      } else if (event.type === 'error') {
        gitError = event.message || 'Push failed';
      }
    });

    pushing = false;
    if (result.ok) {
      // Auto-clear on success
      setTimeout(() => {
        if (!gitError) {
          pushProgress = [];
        }
      }, 2000);
    } else {
      gitError = result.error || 'Push failed';
    }
  }

  async function handleDiscard() {
    if (committing) return;
    const confirmed = confirm(
      `Discard ${gitStore.dirtyCount} change${gitStore.dirtyCount === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!confirmed) return;

    const result = await gitStore.clean(workspacePath);
    if (!result.ok) {
      gitError = result.error || 'Failed to discard changes';
    }
  }

  function clearOutput() {
    commitMessage = '';
    commitProgress = [];
    pushProgress = [];
    gitError = '';
  }
</script>

<div class="git-panel">
  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <div class="panel-header">
    <div class="branch-info">
      {#if gitStore.isRepo}
        <svg
          class="branch-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M6 9c0 3.314 2.686 6 6 6h2M18 15V9" />
        </svg>
        <span class="branch-name">{gitStore.branch || 'HEAD'}</span>
        <span class="file-count">{gitStore.fileStatuses.length} changed</span>
      {:else if workspacePath}
        <span class="no-repo">Not a git repository</span>
      {:else}
        <span class="no-repo">No workspace open</span>
      {/if}
    </div>
    <button class="refresh-btn" onclick={refresh} disabled={refreshing} title="Refresh">
      <svg
        class="refresh-icon"
        class:spinning={refreshing}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>
  </div>

  <!-- ── Commit Section ─────────────────────────────────────────────────── -->
  {#if gitStore.isRepo && gitStore.isDirty}
    <div class="commit-section">
      <button
        class="commit-header"
        onclick={() => (showCommitSection = !showCommitSection)}
        title={showCommitSection ? 'Collapse' : 'Expand'}
      >
        <svg
          class="expand-icon"
          class:expanded={showCommitSection}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>Commit & Actions</span>
      </button>

      {#if showCommitSection}
        <div class="commit-content">
          <!-- Message input with generate button -->
          <div class="commit-input-row">
            <input
              class="commit-input"
              type="text"
              placeholder="Commit message..."
              bind:value={commitMessage}
              onkeydown={(e) => e.key === 'Enter' && handleCommit()}
              disabled={committing || pushing}
            />
            <button
              class="generate-btn"
              onclick={handleGenerateMessage}
              disabled={generating || committing || pushing}
              title="Auto-generate commit message"
            >
              {#if generating}
                <svg
                  class="spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M15 4V2" />
                  <path d="M15 16v-2" />
                  <path d="M8 9h2" />
                  <path d="M20 9h2" />
                  <path d="M17.8 11.8L19 13" />
                  <path d="M15 9h0" />
                  <path d="M17.8 6.2L19 5" />
                  <path d="M3 21l9-9" />
                  <path d="M12.2 6.2L11 5" />
                </svg>
              {/if}
            </button>
          </div>

          <!-- Action buttons -->
          <div class="action-buttons">
            <button
              class="action-btn commit-btn"
              onclick={handleCommit}
              disabled={!commitMessage.trim() || committing || pushing}
            >
              {committing ? 'Committing...' : 'Commit'}
            </button>
            <button
              class="action-btn push-btn"
              onclick={handlePush}
              disabled={committing || pushing}
            >
              {pushing ? 'Pushing...' : 'Push'}
            </button>
            <button
              class="action-btn discard-btn"
              onclick={handleDiscard}
              disabled={committing || pushing}
            >
              Discard All
            </button>
          </div>

          <!-- Commit progress output -->
          {#if commitProgress.length > 0}
            <div class="progress-output">
              <div class="progress-header">
                <span>Commit Output</span>
                <button class="clear-btn" onclick={clearOutput} title="Clear">✕</button>
              </div>
              <div class="progress-lines">
                {#each commitProgress.slice(-15) as line}
                  <div class="progress-line">{line}</div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Push progress output -->
          {#if pushProgress.length > 0}
            <div class="progress-output">
              <div class="progress-header">
                <span>Push Output</span>
                <button class="clear-btn" onclick={clearOutput} title="Clear">✕</button>
              </div>
              <div class="progress-lines">
                {#each pushProgress.slice(-15) as line}
                  <div class="progress-line">{line}</div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Error display -->
          {#if gitError}
            <div class="error-message">{gitError}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── Empty / no-repo states ─────────────────────────────────────────── -->
  {#if !gitStore.isRepo}
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="18" r="3" />
        <path d="M6 9c0 3.314 2.686 6 6 6h2M18 15V9" />
      </svg>
      <p>{workspacePath ? 'Not a git repository' : 'Open a workspace to view git changes'}</p>
    </div>
  {:else if gitStore.fileStatuses.length === 0}
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <p>No changes — working tree clean</p>
    </div>
  {:else}
    <div class="file-sections">
      <!-- ── Staged ─────────────────────────────────────────────────────── -->
      {#if stagedFiles.length > 0}
        <div class="section-header">
          <span>Staged</span>
          <span class="section-count">{stagedFiles.length}</span>
        </div>
        {#each stagedFiles as file (file.path)}
          {@const key = fileKey(file, true)}
          {@const isLoading = loadingKey === key}
          <button
            class="file-row"
            onclick={() => openDiff(file, true)}
            disabled={isLoading}
            title={file.path}
          >
            <span class="status-badge {statusClass(file.status)}" title={statusTitle(file.status)}>
              {statusLabel(file.status)}
            </span>
            <span class="file-name">{basename(file.path)}</span>
            {#if dirname(file.path)}
              <span class="file-dir">{dirname(file.path)}</span>
            {/if}
            {#if isLoading}
              <svg
                class="spinner"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                />
              </svg>
            {:else}
              <svg
                class="open-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            {/if}
          </button>
        {/each}
      {/if}

      <!-- ── Unstaged ────────────────────────────────────────────────────── -->
      {#if unstagedFiles.length > 0}
        <div class="section-header">
          <span>Unstaged</span>
          <span class="section-count">{unstagedFiles.length}</span>
        </div>
        {#each unstagedFiles as file (file.path)}
          {@const key = fileKey(file, false)}
          {@const isLoading = loadingKey === key}
          {@const isUntracked = file.status === 'U'}
          <button
            class="file-row"
            class:no-diff={isUntracked}
            onclick={() => openDiff(file, false)}
            disabled={isLoading || isUntracked}
            title={isUntracked ? 'Untracked — no diff available' : file.path}
          >
            <span class="status-badge {statusClass(file.status)}" title={statusTitle(file.status)}>
              {statusLabel(file.status)}
            </span>
            <span class="file-name">{basename(file.path)}</span>
            {#if dirname(file.path)}
              <span class="file-dir">{dirname(file.path)}</span>
            {/if}
            {#if isLoading}
              <svg
                class="spinner"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                />
              </svg>
            {:else if !isUntracked}
              <svg
                class="open-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .git-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: var(--fs-sm);
  }

  /* ── Header ── */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 6px;
  }

  .branch-info {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .branch-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .branch-name {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .file-count {
    color: var(--text-muted);
    white-space: nowrap;
  }

  .no-repo {
    color: var(--text-muted);
    font-style: italic;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
    padding: 0;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .refresh-icon {
    width: 14px;
    height: 14px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 20px;
    color: var(--text-muted);
    text-align: center;
  }

  .empty-state svg {
    width: 32px;
    height: 32px;
    opacity: 0.4;
  }

  .empty-state p {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  /* ── File sections ── */
  .file-sections {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px 4px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 1px solid var(--border);
  }

  .section-count {
    background: var(--bg-hover);
    color: var(--text-muted);
    border-radius: 10px;
    padding: 1px 6px;
    font-size: var(--fs-xxs);
    font-weight: 600;
  }

  /* ── File row ── */
  .file-row {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 5px 10px;
    gap: 6px;
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    transition: background 0.1s;
    min-width: 0;
  }

  .file-row:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .file-row:disabled {
    cursor: default;
  }

  .file-row.no-diff {
    opacity: 0.6;
  }

  /* ── Status badge ── */
  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    flex-shrink: 0;
    font-family: monospace;
  }

  .badge-modified {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }
  .badge-added {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }
  .badge-deleted {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }
  .badge-untracked {
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
  }

  /* ── File name / dir ── */
  .file-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    min-width: 0;
  }

  .file-dir {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
    flex-shrink: 1;
    font-size: var(--fs-xxs);
  }

  /* ── Open icon / spinner ── */
  .open-icon {
    width: 11px;
    height: 11px;
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.1s;
  }

  .file-row:hover .open-icon {
    opacity: 1;
  }

  .spinner {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--text-muted);
    animation: spin 0.8s linear infinite;
  }

  /* ── Commit Section ── */
  .commit-section {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .commit-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-hover);
    border: none;
    cursor: pointer;
    color: var(--text);
    font-weight: 600;
    font-size: var(--fs-sm);
    transition: background 0.1s;
  }

  .commit-header:hover {
    background: var(--bg-active);
  }

  .expand-icon {
    width: 12px;
    height: 12px;
    transition: transform 0.2s;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  .commit-content {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .commit-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .commit-input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: var(--fs-sm);
    font-family: inherit;
  }

  .commit-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .commit-input:disabled {
    opacity: 0.5;
  }

  .generate-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-hover);
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
  }

  .generate-btn svg {
    width: 14px;
    height: 14px;
  }

  .generate-btn:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }

  .generate-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .generate-btn .spin {
    animation: spin 1s linear infinite;
  }

  .action-buttons {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .commit-btn {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .commit-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .commit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .push-btn {
    background: var(--bg-hover);
    color: var(--text);
  }

  .push-btn:hover:not(:disabled) {
    background: var(--bg-active);
  }

  .push-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .discard-btn {
    background: transparent;
    color: var(--text-danger, #ef4444);
    border-color: var(--text-danger, #ef4444);
  }

  .discard-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
  }

  .discard-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .progress-output {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--bg-hover);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .clear-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0 4px;
    font-size: var(--fs-sm);
    transition: color 0.15s;
  }

  .clear-btn:hover {
    color: var(--text-danger, #ef4444);
  }

  .progress-lines {
    max-height: 150px;
    overflow-y: auto;
    padding: 6px 8px;
  }

  .progress-line {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono, monospace);
  }

  .error-message {
    padding: 6px 8px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--text-danger, #ef4444);
    border-radius: 4px;
    color: var(--text-danger, #ef4444);
    font-size: var(--fs-sm);
  }
</style>
