<script lang="ts">
  import type { UserStory } from '@e/shared';
  import { workStore } from '$lib/stores/work.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import LoopPanel from './LoopPanel.svelte';

  let resettingStoryId = $state<string | null>(null);
  let resettingAllFailed = $state(false);

  let workspacePath = $derived(settingsStore.workspacePath || '');
  let newStoryTitle = $state('');
  let estimatingStoryId = $state<string | null>(null);

  // --- Drag-and-drop state ---
  let draggedStoryId = $state<string | null>(null);
  let dragOverStoryId = $state<string | null>(null);
  let dragOverPosition = $state<'above' | 'below' | null>(null);

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
      case 'archived':
        return '▣';
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
      case 'archived':
        return 'status-archived';
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

  // --- Drag-and-drop handlers for pending stories ---

  function handleDragStart(e: DragEvent, storyId: string) {
    draggedStoryId = storyId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', storyId);
    }
  }

  function handleDragOver(e: DragEvent, storyId: string) {
    if (!draggedStoryId || draggedStoryId === storyId) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    dragOverStoryId = storyId;

    // Determine if we're above or below the midpoint
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    dragOverPosition = e.clientY < midY ? 'above' : 'below';
  }

  function handleDragLeave() {
    dragOverStoryId = null;
    dragOverPosition = null;
  }

  function handleDrop(e: DragEvent, _targetStoryId: string) {
    e.preventDefault();
    if (!draggedStoryId) return;

    const pending = [...workStore.pendingStories];
    const fromIdx = pending.findIndex((s) => s.id === draggedStoryId);
    const toIdx = pending.findIndex((s) => s.id === _targetStoryId);

    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) {
      resetDragState();
      return;
    }

    // Remove dragged item
    const [dragged] = pending.splice(fromIdx, 1);

    // Insert at new position, adjusting for above/below
    let insertIdx = toIdx;
    if (dragOverPosition === 'below') {
      insertIdx = fromIdx < toIdx ? toIdx : toIdx + 1;
    } else {
      insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
    }
    // Clamp
    insertIdx = Math.max(0, Math.min(insertIdx, pending.length));
    pending.splice(insertIdx, 0, dragged);

    // Persist the new order
    workStore.reorderPendingStories(pending);
    resetDragState();
  }

  function handleDragEnd() {
    resetDragState();
  }

  function resetDragState() {
    draggedStoryId = null;
    dragOverStoryId = null;
    dragOverPosition = null;
  }

  // --- Move up/down with keyboard for accessibility ---

  async function handleResetStory(storyId: string) {
    resettingStoryId = storyId;
    try {
      const result = await loopStore.resetStory(storyId);
      if (result.ok) {
        await workStore.loadStandaloneStories(workspacePath);
        uiStore.toast('Story reset to pending', 'success');
      } else {
        uiStore.toast(result.error || 'Failed to reset story', 'error');
      }
    } finally {
      resettingStoryId = null;
    }
  }

  async function handleResetAllFailed() {
    if (!workspacePath) return;
    resettingAllFailed = true;
    try {
      const result = await loopStore.resetFailedAndRestart(null, workspacePath);
      if (result.ok) {
        await workStore.loadStandaloneStories(workspacePath);
        uiStore.toast(`Reset ${result.resetCount ?? 0} failed stories`, 'success');
      } else {
        uiStore.toast(result.error || 'Failed to reset stories', 'error');
      }
    } finally {
      resettingAllFailed = false;
    }
  }

  async function moveStory(storyId: string, direction: 'up' | 'down') {
    const pending = [...workStore.pendingStories];
    const idx = pending.findIndex((s) => s.id === storyId);
    if (idx === -1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= pending.length) return;

    // Swap
    [pending[idx], pending[newIdx]] = [pending[newIdx], pending[idx]];
    await workStore.reorderPendingStories(pending);
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

  <!-- Filter Dropdown -->
  <div class="filter-bar">
    <select
      class="filter-select"
      value={workStore.activeFilter}
      onchange={(e) => {
        const val = (e.target as HTMLSelectElement).value;
        workStore.setFilter(val);
        if (val !== 'standalone' && val !== 'external' && val !== 'all') {
          loopStore.loadPrd(val);
        }
      }}
    >
      <option value="standalone">
        Standalone{workStore.standaloneCount > 0 ? ` (${workStore.standaloneCount})` : ''}
      </option>
      {#each loopStore.prds as prd}
        {@const incompleteCount = (prd.stories || []).filter(
          (s) => s.status !== 'completed' && s.status !== 'skipped' && s.status !== 'archived',
        ).length}
        <option value={prd.id}>
          {prd.name}{incompleteCount > 0 ? ` (${incompleteCount})` : ''}
        </option>
      {/each}
      {#if workStore.hasExternalStories}
        <option value="external">
          External ({workStore.externalCount})
        </option>
      {/if}
      <option value="all">All</option>
    </select>
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
          {#if !loopStore.isActive && loopStore.activeLoopChecked}
            <button class="btn-sm btn-primary" onclick={startStandaloneLoop}
              ><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"
                ><polygon points="5 3 19 12 5 21 5 3" /></svg
              > Activate Golem
            </button>
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
                  {#if story.researchOnly}
                    <span class="research-badge" title="Research only">
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      </svg>
                    </span>
                  {/if}
                  <span class="story-title" class:research-title={story.researchOnly}
                    >{story.title}</span
                  >
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

        {#if workStore.failedStories.length > 0}
          <div class="section">
            <div class="section-label-row">
              <span class="section-label">Failed ({workStore.failedStories.length})</span>
              <button
                class="reset-all-btn"
                title="Reset all failed stories to pending"
                disabled={resettingAllFailed}
                onclick={handleResetAllFailed}
              >
                {#if resettingAllFailed}
                  <span class="spinner-sm"></span>
                {:else}
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
                    <path d="M9 14 4 9l5-5" /><path
                      d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"
                    />
                  </svg>
                  Reset all
                {/if}
              </button>
            </div>
            {#each workStore.failedStories as story (story.id)}
              <div class="story-item failed">
                <div class="story-header">
                  <span class="story-status status-failed">
                    {statusIcon(story.status)}
                  </span>
                  <span class="story-title">{story.title}</span>
                  {#if story.attempts > 0}
                    <span class="attempts-badge">{story.attempts}/{story.maxAttempts}</span>
                  {/if}
                  <button
                    class="reset-badge-btn"
                    title="Reset attempts and set back to pending"
                    disabled={resettingStoryId === story.id}
                    onclick={() => handleResetStory(story.id)}
                  >
                    {#if resettingStoryId === story.id}
                      <span class="spinner-sm"></span>
                    {:else}
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M9 14 4 9l5-5" /><path
                          d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"
                        />
                      </svg>
                      Reset
                    {/if}
                  </button>
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

        {#if workStore.pendingStories.length > 0}
          <div class="section">
            <div class="section-label-row">
              <span class="section-label">Pending</span>
              <div class="sort-controls">
                {#if workStore.manualOrderOverride}
                  <button
                    class="sort-btn"
                    title="Auto-sort by priority"
                    onclick={() => workStore.sortByPriority()}
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
                      <path d="M11 5h10" /><path d="M11 9h7" /><path d="M11 13h4" /><path
                        d="M3 17l3 3 3-3"
                      /><path d="M6 18V4" />
                    </svg>
                  </button>
                {:else}
                  <span
                    class="sort-indicator"
                    title="Sorted by priority (drag to reorder manually)"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M11 5h10" /><path d="M11 9h7" /><path d="M11 13h4" /><path
                        d="M3 17l3 3 3-3"
                      /><path d="M6 18V4" />
                    </svg>
                  </span>
                {/if}
              </div>
            </div>
            {#each workStore.pendingStories as story, idx (story.id)}
              <div
                class="story-item draggable"
                class:drag-over-above={dragOverStoryId === story.id && dragOverPosition === 'above'}
                class:drag-over-below={dragOverStoryId === story.id && dragOverPosition === 'below'}
                class:dragging={draggedStoryId === story.id}
                draggable="true"
                role="listitem"
                ondragstart={(e) => handleDragStart(e, story.id)}
                ondragover={(e) => handleDragOver(e, story.id)}
                ondragleave={handleDragLeave}
                ondrop={(e) => handleDrop(e, story.id)}
                ondragend={handleDragEnd}
              >
                <div class="story-header">
                  <span class="drag-handle" title="Drag to reorder">
                    <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                      <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                      <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
                      <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
                    </svg>
                  </span>
                  <button
                    class="story-status {statusClass(story.status)}"
                    onclick={() => workStore.toggleStoryStatus(story.id, story.status, null)}
                    title="Toggle status"
                  >
                    {statusIcon(story.status)}
                  </button>
                  {#if story.researchOnly}
                    <span
                      class="research-badge"
                      title="Research only — excluded from implementation loops"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      </svg>
                    </span>
                  {/if}
                  <span class="story-title" class:research-title={story.researchOnly}
                    >{story.title}</span
                  >
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
                  <div class="story-actions">
                    <button
                      class="research-toggle-btn"
                      title={story.researchOnly
                        ? 'Mark as implementation work'
                        : 'Mark as research only'}
                      onclick={() => workStore.toggleResearchOnly(story.id, story.researchOnly)}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill={story.researchOnly ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      </svg>
                    </button>
                    <button
                      class="move-btn"
                      title="Move up"
                      disabled={idx === 0}
                      onclick={() => moveStory(story.id, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      class="move-btn"
                      title="Move down"
                      disabled={idx === workStore.pendingStories.length - 1}
                      onclick={() => moveStory(story.id, 'down')}
                    >
                      ↓
                    </button>
                    <button
                      class="delete-btn"
                      title="Delete"
                      onclick={() => workStore.deleteStandaloneStory(story.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if workStore.completedStories.length > 0}
          <div class="section">
            <div class="section-label-row">
              <span class="section-label">Completed</span>
              <button
                class="archive-all-btn"
                title="Archive all completed"
                onclick={() => workStore.archiveAllCompleted(workspacePath)}
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
                  <polyline points="21 8 21 21 3 21 3 8" /><rect
                    x="1"
                    y="3"
                    width="22"
                    height="5"
                  /><line x1="10" y1="12" x2="14" y2="12" />
                </svg>
              </button>
            </div>
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
                  {#if story.researchOnly}
                    <span class="research-badge" title="Research only">
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      </svg>
                    </span>
                  {/if}
                  <span class="story-title completed-title">{story.title}</span>
                  {#if story.estimate}
                    <span class="estimate-badge" title="{story.estimate.storyPoints} points">
                      {story.estimate.size?.[0]?.toUpperCase()}{story.estimate.storyPoints}
                    </span>
                  {/if}
                  <button
                    class="archive-btn"
                    title="Archive"
                    onclick={() => workStore.archiveStory(story.id, story.prdId)}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="21 8 21 21 3 21 3 8" /><rect
                        x="1"
                        y="3"
                        width="22"
                        height="5"
                      /><line x1="10" y1="12" x2="14" y2="12" />
                    </svg>
                  </button>
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
          {:else if !loopStore.isActive && loopStore.activeLoopChecked}
            <button class="btn-sm btn-primary" onclick={startStandaloneLoop}
              ><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"
                ><polygon points="5 3 19 12 5 21 5 3" /></svg
              > Activate Golem
            </button>
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
    font-size: var(--fs-base);
    font-weight: 600;
  }

  .loop-badge {
    font-size: var(--fs-xxs);
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
    padding: 0 4px;
  }
  .filter-select {
    width: 100%;
    font-size: var(--fs-sm);
    padding: 5px 8px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: var(--font-family);
  }
  .filter-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .filter-select:hover {
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
    font-size: var(--fs-sm);
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
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 6px 4px 4px;
  }

  /* Section label row with sort controls */
  .section-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-right: 4px;
  }

  .sort-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sort-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: all var(--transition);
  }
  .sort-btn:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .sort-indicator {
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    padding: 2px 4px;
    opacity: 0.6;
  }

  .story-item {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    margin-bottom: 2px;
    background: var(--bg-tertiary);
    transition:
      background var(--transition),
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .story-item:hover {
    background: var(--bg-hover);
  }
  .story-item.active {
    background: var(--bg-active);
    border-left: 2px solid var(--accent-primary);
  }

  /* Drag-and-drop styles */
  .story-item.draggable {
    cursor: grab;
    position: relative;
  }
  .story-item.draggable:active {
    cursor: grabbing;
  }
  .story-item.dragging {
    opacity: 0.4;
  }
  .story-item.drag-over-above {
    border-top: 2px solid var(--accent-primary);
    margin-top: -2px;
  }
  .story-item.drag-over-below {
    border-bottom: 2px solid var(--accent-primary);
    margin-bottom: 0;
  }

  .drag-handle {
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
    cursor: grab;
    display: flex;
    align-items: center;
    padding: 0 2px;
  }
  .story-item.draggable:hover .drag-handle {
    opacity: 0.6;
  }
  .drag-handle:hover {
    opacity: 1 !important;
    color: var(--text-secondary);
  }

  .story-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .story-status {
    font-size: var(--fs-sm);
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
  .status-archived {
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  .story-title {
    font-size: var(--fs-xs);
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

  /* Research-only styling */
  .research-badge {
    flex-shrink: 0;
    color: var(--accent-info, #6cb4ee);
    display: flex;
    align-items: center;
  }
  .research-title {
    font-style: italic;
    opacity: 0.85;
  }
  .research-toggle-btn {
    font-size: var(--fs-sm);
    padding: 0 3px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    line-height: 1;
    display: flex;
    align-items: center;
  }
  .research-toggle-btn:hover {
    color: var(--accent-info, #6cb4ee);
  }

  .estimate-badge {
    font-size: var(--fs-xxs);
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-weight: 600;
    white-space: nowrap;
  }

  .priority-badge {
    font-size: var(--fs-xxs);
    color: var(--accent-warning, #e6a817);
    font-weight: bold;
  }

  .story-actions {
    display: flex;
    align-items: center;
    gap: 0;
    opacity: 0;
    transition: opacity var(--transition);
    flex-shrink: 0;
  }
  .story-item:hover .story-actions {
    opacity: 1;
  }

  .move-btn {
    font-size: var(--fs-xs);
    padding: 0 3px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    line-height: 1;
  }
  .move-btn:hover:not(:disabled) {
    color: var(--accent-primary);
  }
  .move-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .estimate-btn,
  .delete-btn,
  .archive-btn {
    font-size: var(--fs-sm);
    padding: 0 4px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
  }
  .story-item:hover .estimate-btn,
  .story-item:hover .delete-btn,
  .story-item:hover .archive-btn {
    opacity: 1;
  }
  .estimate-btn:hover {
    color: var(--accent-warning, #e6a817);
  }
  .delete-btn:hover {
    color: var(--accent-error);
  }
  .archive-btn:hover {
    color: var(--accent-primary);
  }

  .archive-all-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    transition: all var(--transition);
  }
  .archive-all-btn:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .story-item.failed {
    border-left: 2px solid var(--accent-error);
  }

  .reset-badge-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(239, 68, 68, 0.12);
    color: var(--accent-error);
    border: none;
    cursor: pointer;
    font-weight: 600;
    transition: all var(--transition);
  }
  .reset-badge-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
  }
  .reset-badge-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .reset-all-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xxs);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .reset-all-btn:hover:not(:disabled) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .reset-all-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .attempts-badge {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    padding: 0 3px;
    border-radius: 2px;
    background: var(--bg-hover);
    font-weight: 600;
    flex-shrink: 0;
  }

  .spinner-sm {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid transparent;
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .empty-stories {
    padding: 16px 8px;
    text-align: center;
  }
  .empty-hint {
    font-size: var(--fs-xs);
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
    font-size: var(--fs-xxs);
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
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 6px 4px 4px;
    font-weight: 600;
  }

  /* Shared buttons */
  .btn-sm {
    font-size: var(--fs-xs);
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
    font-size: var(--fs-md);
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
    font-size: var(--fs-xxs);
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
    font-size: var(--fs-sm);
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
    font-size: var(--fs-xxs);
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    text-transform: capitalize;
  }
  .synced-at {
    font-size: var(--fs-xxs);
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
