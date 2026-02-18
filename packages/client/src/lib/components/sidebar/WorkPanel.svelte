<script lang="ts">
  import { workStore } from '$lib/stores/work.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import LoopPanel from './LoopPanel.svelte';

  let workspacePath = $derived(settingsStore.workspacePath || '');
  let newStoryTitle = $state('');
  let estimatingStoryId = $state<string | null>(null);

  onMount(() => {
    if (workspacePath) {
      workStore.loadStandaloneStories(workspacePath);
      loopStore.loadPrds(workspacePath);
      loopStore.loadActiveLoop();
    }
  });

  async function addStandaloneStory() {
    if (!newStoryTitle.trim() || !workspacePath) return;
    await workStore.createStandaloneStory(workspacePath, newStoryTitle.trim());
    newStoryTitle = '';
  }

  async function estimateStory(storyId: string) {
    estimatingStoryId = storyId;
    try {
      const res = await api.prds.estimateStandaloneStory(storyId);
      if (res.ok) {
        await workStore.loadStandaloneStories(workspacePath);
      }
    } finally {
      estimatingStoryId = null;
    }
  }

  function statusIcon(status: string): string {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '●';
      case 'failed':
        return '✗';
      case 'skipped':
        return '⊘';
      default:
        return '○';
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'in_progress':
        return 'status-in-progress';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-pending';
    }
  }

  function priorityLabel(p: string): string {
    switch (p) {
      case 'critical':
        return '!!!';
      case 'high':
        return '!!';
      case 'low':
        return '';
      default:
        return '!';
    }
  }

  async function startStandaloneLoop() {
    if (!workspacePath) return;
    uiStore.openModal('loop-config');
  }
</script>

<div class="work-panel">
  <!-- Header -->
  <div class="section-header">
    <h3>Work</h3>
    <div class="header-actions">
      <button
        class="header-btn"
        title="Import from Jira/Linear/Asana"
        onclick={() => uiStore.openModal('external-provider-config')}
      >
        +
      </button>
      {#if loopStore.isActive}
        <span
          class="loop-badge"
          class:running={loopStore.isRunning}
          class:paused={loopStore.isPaused}
        >
          {loopStore.isRunning ? 'Running' : 'Paused'}
        </span>
      {/if}
    </div>
  </div>

  <!-- Filter Bar -->
  <div class="filter-bar">
    <button
      class="filter-btn"
      class:active={workStore.activeFilter === 'standalone'}
      onclick={() => workStore.setFilter('standalone')}
    >
      Standalone
      {#if workStore.standaloneCount > 0}
        <span class="filter-count">{workStore.standaloneCount}</span>
      {/if}
    </button>
    {#each loopStore.prds as prd}
      <button
        class="filter-btn"
        class:active={workStore.activeFilter === prd.id}
        onclick={() => {
          workStore.setFilter(prd.id);
          loopStore.loadPrd(prd.id);
        }}
      >
        {prd.name}
        {#if prd.stories?.length > 0}
          <span class="filter-count">{prd.stories.length}</span>
        {/if}
      </button>
    {/each}
    {#if workStore.hasExternalStories}
      <button
        class="filter-btn"
        class:active={workStore.activeFilter === 'external'}
        onclick={() => workStore.setFilter('external')}
      >
        External
        <span class="filter-count">{workStore.externalCount}</span>
      </button>
    {/if}
    <button
      class="filter-btn"
      class:active={workStore.activeFilter === 'all'}
      onclick={() => workStore.setFilter('all')}
    >
      All
    </button>
  </div>

  <!-- Content based on filter -->
  {#if workStore.activeFilter === 'external'}
    <!-- External Stories View -->
    <div class="standalone-section">
      <div class="external-header-row">
        <span class="section-label">From External Providers</span>
        <button class="btn-sm" onclick={() => workStore.refreshAllExternalStories(workspacePath)}>
          Refresh All
        </button>
      </div>

      <div class="story-sections">
        {#each workStore.filteredStories as story (story.id)}
          <div class="story-item" class:active={story.status === 'in_progress'}>
            <div class="story-header">
              <button
                class="story-status {statusClass(story.status)}"
                onclick={() => workStore.toggleStoryStatus(story.id, story.status, null)}
                title="Toggle status"
              >
                {statusIcon(story.status)}
              </button>
              {#if story.externalRef}
                <span class="external-badge" title={story.externalRef.provider}>
                  {story.externalRef.provider === 'jira'
                    ? 'J'
                    : story.externalRef.provider === 'linear'
                      ? 'L'
                      : 'A'}
                </span>
              {/if}
              <span class="story-title" class:completed-title={story.status === 'completed'}>
                {story.title}
              </span>
              {#if story.externalRef}
                <a
                  class="external-link"
                  href={story.externalRef.externalUrl}
                  target="_blank"
                  rel="noopener"
                  title="Open in {story.externalRef.provider}"
                >
                  ↗
                </a>
                <button
                  class="estimate-btn"
                  title="Refresh from source"
                  onclick={() => workStore.refreshExternalStory(story.id)}
                >
                  ↻
                </button>
              {/if}
              {#if priorityLabel(story.priority)}
                <span class="priority-badge">{priorityLabel(story.priority)}</span>
              {/if}
            </div>
            {#if story.externalStatus}
              <div class="external-status-row">
                <span class="external-status">{story.externalStatus}</span>
                {#if story.externalRef?.syncedAt}
                  <span class="synced-at"
                    >synced {new Date(story.externalRef.syncedAt).toLocaleDateString()}</span
                  >
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty-stories">
            <p class="empty-hint">No external stories imported yet.</p>
            <button
              class="btn-sm btn-primary"
              onclick={() => uiStore.openModal('external-provider-config')}
            >
              Import Issues
            </button>
          </div>
        {/each}
      </div>

      <!-- Loop controls for external stories -->
      {#if workStore.filteredStories.some((s) => s.status === 'pending' || s.status === 'in_progress')}
        <div class="loop-controls">
          {#if !loopStore.isActive}
            <button class="btn-sm btn-primary" onclick={startStandaloneLoop}><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg> Loop </button>
          {/if}
        </div>
      {/if}
    </div>
  {:else if workStore.activeFilter === 'standalone'}
    <!-- Standalone Stories View -->
    <div class="standalone-section">
      <!-- Add story input -->
      <div class="add-story">
        <input
          type="text"
          bind:value={newStoryTitle}
          placeholder="Add a story..."
          onkeydown={(e) => e.key === 'Enter' && addStandaloneStory()}
        />
      </div>

      <!-- Story list by status -->
      <div class="story-sections">
        {#if workStore.inProgressStories.length > 0}
          <div class="section">
            <div class="section-label">In Progress</div>
            {#each workStore.inProgressStories as story (story.id)}
              <div class="story-item active">
                <div class="story-header">
                  <button
                    class="story-status {statusClass(story.status)}"
                    onclick={() => workStore.toggleStoryStatus(story.id, story.status, null)}
                    title="Toggle status"
                  >
                    {statusIcon(story.status)}
                  </button>
                  <span class="story-title">{story.title}</span>
                  {#if story.estimate}
                    <span class="estimate-badge" title="{story.estimate.storyPoints} points">
                      {story.estimate.size?.[0]?.toUpperCase()}{story.estimate.storyPoints}
                    </span>
                  {/if}
                  {#if priorityLabel(story.priority)}
                    <span class="priority-badge">{priorityLabel(story.priority)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if workStore.pendingStories.length > 0}
          <div class="section">
            <div class="section-label">Pending</div>
            {#each workStore.pendingStories as story (story.id)}
              <div class="story-item">
                <div class="story-header">
                  <button
                    class="story-status {statusClass(story.status)}"
                    onclick={() => workStore.toggleStoryStatus(story.id, story.status, null)}
                    title="Toggle status"
                  >
                    {statusIcon(story.status)}
                  </button>
                  <span class="story-title">{story.title}</span>
                  {#if story.estimate}
                    <span class="estimate-badge" title="{story.estimate.storyPoints} points">
                      {story.estimate.size?.[0]?.toUpperCase()}{story.estimate.storyPoints}
                    </span>
                  {:else}
                    <button
                      class="estimate-btn"
                      title="Estimate"
                      disabled={estimatingStoryId === story.id}
                      onclick={() => estimateStory(story.id)}
                    >
                      {estimatingStoryId === story.id ? '...' : '⊕'}
                    </button>
                  {/if}
                  {#if priorityLabel(story.priority)}
                    <span class="priority-badge">{priorityLabel(story.priority)}</span>
                  {/if}
                  <button
                    class="delete-btn"
                    title="Delete"
                    onclick={() => workStore.deleteStandaloneStory(story.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if workStore.completedStories.length > 0}
          <div class="section">
            <div class="section-label">Completed</div>
            {#each workStore.completedStories as story (story.id)}
              <div class="story-item">
                <div class="story-header">
                  <button
                    class="story-status {statusClass(story.status)}"
                    onclick={() => workStore.toggleStoryStatus(story.id, story.status, null)}
                    title="Toggle status"
                  >
                    {statusIcon(story.status)}
                  </button>
                  <span class="story-title completed-title">{story.title}</span>
                  {#if story.estimate}
                    <span class="estimate-badge" title="{story.estimate.storyPoints} points">
                      {story.estimate.size?.[0]?.toUpperCase()}{story.estimate.storyPoints}
                    </span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if workStore.standaloneStories.length === 0}
          <div class="empty-stories">
            <p class="empty-hint">
              No standalone stories yet. Add one above or import from an external tool.
            </p>
          </div>
        {/if}
      </div>

      <!-- Loop controls for standalone -->
      {#if workStore.standaloneStories.some((s) => s.status === 'pending' || s.status === 'in_progress')}
        <div class="loop-controls">
          {#if loopStore.isActive && !loopStore.activeLoop?.prdId}
            <div class="loop-progress">
              <div class="progress-bar">
                <div class="progress-fill" style="width: {loopStore.progress}%"></div>
              </div>
              <span class="progress-text"
                >{loopStore.completedStories}/{loopStore.totalStories}</span
              >
            </div>
            <div class="loop-actions">
              {#if loopStore.isRunning}
                <button class="btn-sm" onclick={() => loopStore.pauseLoop()}>Pause</button>
              {:else if loopStore.isPaused}
                <button class="btn-sm btn-primary" onclick={() => loopStore.resumeLoop()}
                  >Resume</button
                >
              {/if}
              <button class="btn-sm btn-ghost" onclick={() => loopStore.cancelLoop()}>Cancel</button
              >
            </div>
          {:else if !loopStore.isActive}
            <button class="btn-sm btn-primary" onclick={startStandaloneLoop}><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg> Loop </button>
          {/if}
        </div>
      {/if}
    </div>
  {:else if workStore.activeFilter === 'all'}
    <!-- All Stories Overview -->
    <div class="all-stories-section">
      {#if workStore.standaloneStories.length > 0}
        <div class="group">
          <div class="group-label">Standalone</div>
          {#each workStore.standaloneStories as story (story.id)}
            <div class="story-item">
              <div class="story-header">
                <span class="story-status {statusClass(story.status)}"
                  >{statusIcon(story.status)}</span
                >
                <span class="story-title">{story.title}</span>
                {#if story.estimate}
                  <span class="estimate-badge"
                    >{story.estimate.size?.[0]?.toUpperCase()}{story.estimate.storyPoints}</span
                  >
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#each loopStore.prds as prd}
        {#if prd.stories?.length > 0}
          <div class="group">
            <div class="group-label">{prd.name}</div>
            {#each prd.stories as story (story.id)}
              <div class="story-item">
                <div class="story-header">
                  <span class="story-status {statusClass(story.status)}"
                    >{statusIcon(story.status)}</span
                  >
                  <span class="story-title">{story.title}</span>
                  {#if story.estimate}
                    <span class="estimate-badge"
                      >{story.estimate.size?.[0]?.toUpperCase()}{story.estimate.storyPoints}</span
                    >
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/each}

      {#if workStore.standaloneStories.length === 0 && loopStore.prds.every((p) => !p.stories?.length)}
        <div class="empty-stories">
          <p class="empty-hint">No stories yet. Switch to Standalone or a PRD to add work items.</p>
        </div>
      {/if}
    </div>
  {:else}
    <!-- PRD View — delegate to existing LoopPanel -->
    <LoopPanel />
  {/if}
</div>

<style>
  .work-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
  }
  .section-header h3 {
    font-size: 13px;
    font-weight: 600;
  }

  .loop-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
  }
  .loop-badge.running {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    animation: pulse 2s infinite;
  }
  .loop-badge.paused {
    background: var(--accent-warning, #e6a817);
    color: #000;
  }

  /* Filter Bar */
  .filter-bar {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    padding: 0 4px;
  }
  .filter-btn {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all var(--transition);
  }
  .filter-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .filter-btn.active {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }
  .filter-count {
    font-size: 9px;
    padding: 0 4px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.2);
    min-width: 14px;
    text-align: center;
  }
  .filter-btn:not(.active) .filter-count {
    background: var(--bg-hover);
  }

  /* Standalone Section */
  .standalone-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    overflow: hidden;
  }

  .add-story {
    padding: 0 4px;
  }
  .add-story input {
    width: 100%;
    font-size: 12px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  .story-sections {
    flex: 1;
    overflow-y: auto;
  }

  .section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 6px 4px 4px;
  }

  .story-item {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    margin-bottom: 2px;
    background: var(--bg-tertiary);
    transition: background var(--transition);
  }
  .story-item:hover {
    background: var(--bg-hover);
  }
  .story-item.active {
    background: var(--bg-active);
    border-left: 2px solid var(--accent-primary);
  }

  .story-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .story-status {
    font-size: 12px;
    flex-shrink: 0;
    width: 14px;
    text-align: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  .status-completed {
    color: var(--accent-secondary);
  }
  .status-in-progress {
    color: var(--accent-primary);
  }
  .status-failed {
    color: var(--accent-error);
  }
  .status-pending {
    color: var(--text-tertiary);
  }

  .story-title {
    font-size: 11px;
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .completed-title {
    text-decoration: line-through;
    color: var(--text-tertiary);
  }

  .estimate-badge {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-weight: 600;
    white-space: nowrap;
  }

  .priority-badge {
    font-size: 9px;
    color: var(--accent-warning, #e6a817);
    font-weight: bold;
  }

  .estimate-btn,
  .delete-btn {
    font-size: 12px;
    padding: 0 4px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
    background: none;
    border: none;
    cursor: pointer;
  }
  .story-item:hover .estimate-btn,
  .story-item:hover .delete-btn {
    opacity: 1;
  }
  .estimate-btn:hover {
    color: var(--accent-warning, #e6a817);
  }
  .delete-btn:hover {
    color: var(--accent-error);
  }

  .empty-stories {
    padding: 16px 8px;
    text-align: center;
  }
  .empty-hint {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* Loop Controls */
  .loop-controls {
    padding: 8px 4px;
    border-top: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .loop-progress {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .progress-bar {
    flex: 1;
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent-primary);
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .progress-text {
    font-size: 10px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .loop-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  /* All Stories View */
  .all-stories-section {
    flex: 1;
    overflow-y: auto;
  }
  .group {
    margin-bottom: 8px;
  }
  .group-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 6px 4px 4px;
    font-weight: 600;
  }

  /* Shared buttons */
  .btn-sm {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    cursor: pointer;
  }
  .btn-sm:hover {
    background: var(--bg-hover);
  }
  .btn-primary {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }
  .btn-primary:hover {
    opacity: 0.9;
  }
  .btn-ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-secondary);
  }
  .btn-ghost:hover {
    color: var(--text-primary);
  }

  /* Header Actions */
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .header-btn {
    font-size: 14px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .header-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* External stories */
  .external-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
  }
  .external-badge {
    font-size: 9px;
    font-weight: 700;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .external-link {
    font-size: 12px;
    color: var(--text-tertiary);
    text-decoration: none;
    opacity: 0;
    transition: opacity var(--transition);
    flex-shrink: 0;
  }
  .story-item:hover .external-link {
    opacity: 1;
  }
  .external-link:hover {
    color: var(--accent-primary);
  }
  .external-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0 0 20px;
  }
  .external-status {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    text-transform: capitalize;
  }
  .synced-at {
    font-size: 9px;
    color: var(--text-tertiary);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
