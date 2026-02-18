<script lang="ts">
  import { loopStore } from '$lib/stores/loop.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { sendAndStream } from '$lib/api/sse';
  import { onMount } from 'svelte';
  import type { PlanMode } from '@e/shared';
  import DependencyView from '$lib/components/planning/DependencyView.svelte';

  let workspacePath = $derived(settingsStore.workspacePath || '');
  let importJson = $state('');
  let showImport = $state(false);
  let showCreate = $state(false);
  let showAddStory = $state(false);
  let newPrdName = $state('');
  let newPrdDesc = $state('');
  let newStoryTitle = $state('');
  let newStoryDesc = $state('');
  let newStoryCriteria = $state('');
  let logEl = $state<HTMLDivElement>();

  onMount(() => {
    if (workspacePath) {
      loopStore.loadPrds(workspacePath);
    }
    loopStore.loadActiveLoop();
  });

  // Auto-scroll log to top (newest entries are first)
  $effect(() => {
    if (logEl && loopStore.log.length) {
      logEl.scrollTop = 0;
    }
  });

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

  function statusColor(status: string): string {
    switch (status) {
      case 'completed':
        return 'var(--accent-secondary)';
      case 'in_progress':
        return 'var(--accent-primary)';
      case 'failed':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function priorityLabel(p: string): string {
    return p === 'critical' ? '!!!' : p === 'high' ? '!!' : p === 'medium' ? '!' : '';
  }

  async function handleCreate() {
    if (!newPrdName.trim() || !workspacePath) return;
    try {
      const res = await api.prds.create({
        workspacePath: workspacePath,
        name: newPrdName.trim(),
        description: newPrdDesc.trim(),
        stories: [],
      });
      if (res.ok) {
        loopStore.setSelectedPrdId(res.data.id);
        await loopStore.loadPrds(workspacePath);
        await loopStore.loadPrd(res.data.id);
        showCreate = false;
        newPrdName = '';
        newPrdDesc = '';
        uiStore.toast(`Created PRD: ${newPrdName}`, 'success');
      }
    } catch (err) {
      uiStore.toast(`Create failed: ${err}`, 'error');
    }
  }

  async function handleImport() {
    if (!importJson.trim() || !workspacePath) return;
    try {
      const parsed = JSON.parse(importJson);
      const res = await api.prds.import(workspacePath, parsed);
      if (res.ok) {
        loopStore.setSelectedPrdId(res.data.id);
        await loopStore.loadPrds(workspacePath);
        await loopStore.loadPrd(res.data.id);
        showImport = false;
        importJson = '';
        uiStore.toast(`Imported ${res.data.imported} stories`, 'success');
      }
    } catch (err) {
      uiStore.toast(`Import failed: ${err}`, 'error');
    }
  }

  async function handleAddStory() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || !newStoryTitle.trim()) return;
    try {
      const criteria = newStoryCriteria.split('\n').filter((l) => l.trim());
      await api.prds.addStory(prdId, {
        title: newStoryTitle,
        description: newStoryDesc,
        acceptanceCriteria: criteria,
        priority: 'medium',
      });
      await loopStore.loadPrd(prdId);
      newStoryTitle = '';
      newStoryDesc = '';
      newStoryCriteria = '';
      showAddStory = false;
    } catch (err) {
      uiStore.toast(`Failed to add story: ${err}`, 'error');
    }
  }

  async function handleDeleteStory(storyId: string) {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;
    await api.prds.deleteStory(prdId, storyId);
    await loopStore.loadPrd(prdId);
  }

  async function handleDeletePrd() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;
    if (!confirm('Delete this PRD and all its stories?')) return;
    await api.prds.delete(prdId);
    loopStore.setSelectedPrdId(null);
    await loopStore.loadPrds(workspacePath);
  }

  function openLoopConfig() {
    uiStore.openModal('loop-config');
  }

  function actionLabel(action: string): string {
    const map: Record<string, string> = {
      started: '▶',
      passed: '✓',
      failed: '✗',
      committed: '⟨⟩',
      quality_check: '⚙',
      learning: '※',
      skipped: '⊘',
    };
    return map[action] || action;
  }

  function actionColor(action: string): string {
    switch (action) {
      case 'passed':
      case 'committed':
        return 'var(--accent-secondary)';
      case 'failed':
        return 'var(--accent-error)';
      case 'started':
        return 'var(--accent-primary)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  let planning = $state(false);
  let showDependencies = $state(false);

  // Auto-validate sprint when PRD is selected/changed
  $effect(() => {
    const prdId = loopStore.selectedPrdId;
    if (prdId && loopStore.selectedPrd?.stories?.length) {
      loopStore.validateSprint(prdId);
    }
  });

  function openGenerateModal() {
    uiStore.openModal('story-generate');
  }

  function openRefineModal(storyId: string) {
    loopStore.clearRefinement();
    loopStore.setRefiningStoryId(storyId);
    uiStore.openModal('story-refine');
  }

  function openValidateModal(storyId: string) {
    loopStore.clearCriteriaValidation();
    loopStore.setValidatingCriteriaStoryId(storyId);
    uiStore.openModal('criteria-validation');
  }

  function openEstimateModal(storyId: string) {
    loopStore.clearEstimation();
    loopStore.setEstimatingStoryId(storyId);
    uiStore.openModal('story-estimate');
  }

  function openSprintPlanModal() {
    loopStore.clearSprintPlan();
    uiStore.openModal('sprint-plan');
  }

  function openCompletenessModal() {
    loopStore.clearCompleteness();
    uiStore.openModal('prd-completeness');
  }

  function openTemplateLibrary() {
    loopStore.clearTemplates();
    uiStore.openModal('template-library');
  }

  function openPriorityModal(storyId: string) {
    loopStore.clearPriorityRecommendation();
    loopStore.setRecommendingPriorityStoryId(storyId);
    uiStore.openModal('priority-recommendation');
  }

  function openEffortValueMatrix() {
    loopStore.clearEffortValueMatrix();
    uiStore.openModal('effort-value-matrix');
  }

  let estimatingAll = $state(false);
  let recommendingAllPriorities = $state(false);
  let showStoriesMenu = $state(false);

  function closeStoriesMenu() {
    showStoriesMenu = false;
  }

  function toggleStoriesMenu() {
    showStoriesMenu = !showStoriesMenu;
  }

  async function recommendAllPriorities() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || recommendingAllPriorities) return;
    recommendingAllPriorities = true;
    try {
      const result = await loopStore.recommendAllPriorities(prdId);
      if (result.ok) {
        const summary = loopStore.bulkPriorityResult?.summary;
        if (summary) {
          uiStore.toast(
            `Priority recommendations: ${summary.changedCount} changes suggested (${summary.criticalCount}C/${summary.highCount}H/${summary.mediumCount}M/${summary.lowCount}L)`,
            'success',
          );
        } else {
          uiStore.toast('All priorities analyzed', 'success');
        }
      } else {
        uiStore.toast(result.error || 'Priority recommendation failed', 'error');
      }
    } finally {
      recommendingAllPriorities = false;
    }
  }

  async function estimateAllStories() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || estimatingAll) return;
    estimatingAll = true;
    try {
      const result = await loopStore.estimateAllStories(prdId);
      if (result.ok) {
        const summary = loopStore.prdEstimationResult?.summary;
        if (summary) {
          uiStore.toast(
            `Estimated ${summary.smallCount + summary.mediumCount + summary.largeCount} stories (${summary.totalPoints} total points)`,
            'success',
          );
        } else {
          uiStore.toast('All stories estimated', 'success');
        }
      } else {
        uiStore.toast(result.error || 'Estimation failed', 'error');
      }
    } finally {
      estimatingAll = false;
    }
  }

  function estimateSizeColor(size: string): string {
    switch (size) {
      case 'small':
        return 'var(--accent-secondary)';
      case 'medium':
        return 'var(--accent-warning, #e6a817)';
      case 'large':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function estimateSizeLabel(size: string): string {
    return size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L';
  }

  let totalStoryPoints = $derived(
    (loopStore.selectedPrd?.stories || []).reduce(
      (sum, s) => sum + (s.estimate?.storyPoints || 0),
      0,
    ),
  );

  let estimatedCount = $derived(
    (loopStore.selectedPrd?.stories || []).filter((s) => s.estimate).length,
  );

  async function startPlanning(mode: PlanMode) {
    if (!loopStore.selectedPrdId || planning) return;

    // For 'generate' mode, open the dedicated modal instead
    if (mode === 'generate') {
      openGenerateModal();
      return;
    }

    planning = true;
    try {
      const result = await loopStore.startPlanning(loopStore.selectedPrdId, workspacePath, mode);
      if (!result) {
        uiStore.toast('Failed to start planning session', 'error');
        return;
      }

      // Load the conversation into the main chat pane
      const convRes = await api.conversations.get(result.conversationId);
      conversationStore.setActive(convRes.data);
      streamStore.reset();

      // For chat-generate mode, send the first message immediately
      if (mode === 'chat-generate') {
        await sendAndStream(
          result.conversationId,
          "Let's plan this sprint. Review the PRD description and any existing stories, then suggest what we should build. Ask me clarifying questions if needed.",
        );
      }

      uiStore.toast(`Planning session started`, 'success');
    } catch (err) {
      uiStore.toast(`Planning failed: ${err}`, 'error');
    } finally {
      planning = false;
    }
  }
</script>

<div class="loop-panel">
  <!-- Header -->
  <div class="section-header">
    <h3>Autonomous Loop</h3>
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

  <!-- PRD Selection -->
  <div class="prd-section">
    <div class="prd-select-row">
      <select
        value={loopStore.selectedPrdId || ''}
        onchange={(e) => {
          const val = (e.target as HTMLSelectElement).value;
          loopStore.setSelectedPrdId(val || null);
          if (val) loopStore.loadPrd(val);
        }}
      >
        <option value="">Select a PRD...</option>
        {#each loopStore.prds as prd}
          <option value={prd.id}>{prd.name}</option>
        {/each}
      </select>
      <button
        class="icon-btn"
        title="New PRD"
        onclick={() => {
          showCreate = !showCreate;
          showImport = false;
        }}
      >
        +
      </button>
      <button
        class="icon-btn"
        title="Import prd.json"
        onclick={() => {
          showImport = !showImport;
          showCreate = false;
        }}
      >
        ↓
      </button>
    </div>

    {#if showCreate}
      <div class="create-form">
        <input bind:value={newPrdName} placeholder="PRD name" />
        <textarea bind:value={newPrdDesc} placeholder="Description (optional)" rows="2"></textarea>
        <div class="import-actions">
          <button class="btn-sm btn-primary" onclick={handleCreate}>Create</button>
          <button
            class="btn-sm btn-ghost"
            onclick={() => {
              showCreate = false;
              newPrdName = '';
              newPrdDesc = '';
            }}>Cancel</button
          >
        </div>
      </div>
    {/if}

    {#if showImport}
      <div class="import-area">
        <textarea bind:value={importJson} placeholder="Paste prd.json content here..." rows="5"
        ></textarea>
        <div class="import-actions">
          <button class="btn-sm" onclick={handleImport}>Import</button>
          <button
            class="btn-sm btn-ghost"
            onclick={() => {
              showImport = false;
              importJson = '';
            }}>Cancel</button
          >
        </div>
      </div>
    {/if}
  </div>

  <!-- Sprint Planning -->
  {#if loopStore.selectedPrdId && !loopStore.isActive}
    <div class="plan-section">
      <div class="plan-row">
        <button
          class="btn-sm btn-plan"
          onclick={() => startPlanning('chat')}
          disabled={planning}
          title="Open a planning conversation with Claude"
        >
          Plan
        </button>
        <button
          class="btn-sm btn-plan"
          onclick={() => startPlanning('generate')}
          disabled={planning}
          title="AI-generate stories from PRD description with review"
        >
          Generate
        </button>
        <button
          class="btn-sm btn-plan"
          onclick={() => startPlanning('chat-generate')}
          disabled={planning}
          title="Chat to refine scope, then generate stories"
        >
          Plan + Gen
        </button>
      </div>
      <button
        class="edit-lock"
        onclick={() => {
          const next =
            loopStore.editMode === 'locked'
              ? 'propose'
              : loopStore.editMode === 'propose'
                ? 'unlocked'
                : 'locked';
          loopStore.setEditMode(next);
        }}
        title={loopStore.editMode === 'locked'
          ? 'Claude will discuss stories in plain text only'
          : loopStore.editMode === 'propose'
            ? 'Claude will propose structured edits for your approval'
            : 'Claude will apply edits automatically'}
      >
        <span class="lock-icon"
          >{loopStore.editMode === 'locked'
            ? '▣'
            : loopStore.editMode === 'propose'
              ? '▥'
              : '▢'}</span
        >
        <span class="lock-label"
          >{loopStore.editMode === 'locked'
            ? 'Locked'
            : loopStore.editMode === 'propose'
              ? 'Propose'
              : 'Unlocked'}</span
        >
      </button>
    </div>
  {/if}

  <!-- Stories List -->
  {#if loopStore.selectedPrd}
    <div class="stories-section">
      <div class="section-header">
        <h4>
          Stories ({loopStore.selectedPrd.stories?.length || 0}){#if totalStoryPoints > 0}<span
              class="total-points"
              title="{estimatedCount} of {loopStore.selectedPrd.stories?.length || 0} estimated"
            >
              · {totalStoryPoints}pts</span
            >{/if}
        </h4>
        <div class="header-actions">
          <button class="icon-btn" title="Add story" onclick={() => (showAddStory = !showAddStory)}
            >+</button
          >
          <div class="stories-menu-wrap">
            <button
              class="icon-btn"
              class:active-btn={showStoriesMenu}
              title="Actions"
              onclick={toggleStoriesMenu}>⋯</button
            >
            {#if showStoriesMenu}
              <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
              <div class="stories-menu-backdrop" onclick={closeStoriesMenu}></div>
              <div class="stories-menu">
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    estimateAllStories();
                  }}
                  disabled={estimatingAll}
                >
                  {#if estimatingAll}<span class="spinner-sm"></span>{:else}Estimate all{/if}
                </button>
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    recommendAllPriorities();
                  }}
                  disabled={recommendingAllPriorities}
                >
                  {#if recommendingAllPriorities}<span class="spinner-sm"></span>{:else}Prioritize
                    all{/if}
                </button>
                <div class="menu-divider"></div>
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openSprintPlanModal();
                  }}>Sprint plan</button
                >
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openEffortValueMatrix();
                  }}>Effort / Value matrix</button
                >
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openCompletenessModal();
                  }}>PRD completeness</button
                >
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openTemplateLibrary();
                  }}>Story templates</button
                >
                <button
                  class="menu-item"
                  class:active-btn={showDependencies}
                  onclick={() => {
                    closeStoriesMenu();
                    showDependencies = !showDependencies;
                  }}
                >
                  {showDependencies ? 'Hide dependencies' : 'Dependencies'}
                </button>
                <div class="menu-divider"></div>
                <button
                  class="menu-item menu-item-danger"
                  onclick={() => {
                    closeStoriesMenu();
                    handleDeletePrd();
                  }}>Delete PRD</button
                >
              </div>
            {/if}
          </div>
        </div>
      </div>

      {#if showAddStory}
        <div class="add-story-form">
          <input bind:value={newStoryTitle} placeholder="Story title" />
          <textarea bind:value={newStoryDesc} placeholder="Description" rows="2"></textarea>
          <textarea
            bind:value={newStoryCriteria}
            placeholder="Acceptance criteria (one per line)"
            rows="3"
          ></textarea>
          <div class="import-actions">
            <button class="btn-sm" onclick={handleAddStory}>Add</button>
            <button class="btn-sm btn-ghost" onclick={() => (showAddStory = false)}>Cancel</button>
          </div>
        </div>
      {/if}

      <div class="story-list">
        {#if (loopStore.selectedPrd.stories || []).length === 0}
          <div class="empty-stories">
            <span class="empty-hint">No stories yet. Click + to add one.</span>
          </div>
        {:else}
          {#each loopStore.selectedPrd.stories || [] as story (story.id)}
            <div
              class="story-item"
              class:active={loopStore.activeLoop?.currentStoryId === story.id}
            >
              <div class="story-header">
                <span class="story-status" style:color={statusColor(story.status)}>
                  {statusIcon(story.status)}
                </span>
                <span class="story-title">{story.title}</span>
                {#if priorityLabel(story.priority)}
                  <span class="priority-badge">{priorityLabel(story.priority)}</span>
                {/if}
                {#if !loopStore.isActive}
                  <button
                    class="validate-btn"
                    title="Validate acceptance criteria"
                    onclick={() => openValidateModal(story.id)}>✓</button
                  >
                  <button
                    class="refine-btn"
                    title="Refine story"
                    onclick={() => openRefineModal(story.id)}>↻</button
                  >
                  <button
                    class="estimate-btn"
                    title="Estimate complexity"
                    onclick={() => openEstimateModal(story.id)}>⚖</button
                  >
                  <button
                    class="priority-btn"
                    title="Recommend priority"
                    onclick={() => openPriorityModal(story.id)}>⇅</button
                  >
                  <button class="delete-btn" onclick={() => handleDeleteStory(story.id)}>×</button>
                {/if}
              </div>
              <div class="story-badges">
                {#if story.estimate}
                  <span
                    class="estimate-badge"
                    style:background={estimateSizeColor(story.estimate.size)}
                    title="{story.estimate.size} · {story.estimate
                      .storyPoints} points · Confidence: {story.estimate.confidence}{story.estimate
                      .isManualOverride
                      ? ' (manual)'
                      : ''}"
                  >
                    {estimateSizeLabel(story.estimate.size)}{story.estimate.storyPoints}
                  </span>
                {/if}
                {#if story.priorityRecommendation && story.priorityRecommendation.suggestedPriority !== story.priority && !story.priorityRecommendation.isManualOverride}
                  <span
                    class="priority-rec-badge"
                    title="AI suggests: {story.priorityRecommendation.suggestedPriority}"
                  >
                    ⇅{story.priorityRecommendation.suggestedPriority[0].toUpperCase()}
                  </span>
                {/if}
                {#if story.dependsOn?.length > 0}
                  <span class="dep-badge" title="Depends on {story.dependsOn.length} story(ies)">
                    ↑{story.dependsOn.length}
                  </span>
                {/if}
                {#if story.attempts > 0}
                  <span class="attempts-badge">
                    {story.attempts}/{story.maxAttempts} attempts
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Dependency View (collapsible) -->
      {#if showDependencies && loopStore.selectedPrdId}
        <DependencyView prdId={loopStore.selectedPrdId} />
      {/if}
    </div>

    <!-- Sprint Validation Warnings -->
    {#if loopStore.sprintWarnings.length > 0 && !loopStore.isActive}
      <div class="sprint-warnings">
        <div class="section-header">
          <h4>⚠ Sprint Warnings ({loopStore.sprintWarnings.length})</h4>
        </div>
        <div class="warning-list">
          {#each loopStore.sprintWarnings as warning}
            <div
              class="sprint-warning-item"
              class:blocking={warning.type === 'blocked_story'}
              class:circular={warning.type === 'circular_dependency'}
            >
              <span class="warning-msg">{warning.message}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Loop Controls -->
  <div class="controls-section">
    {#if loopStore.isActive}
      <div class="progress-info">
        <div class="progress-bar-container">
          <div class="progress-bar" style:width="{loopStore.progress}%"></div>
        </div>
        <span class="progress-text">
          {loopStore.completedStories}/{loopStore.totalStories} stories • Iteration {loopStore
            .activeLoop?.currentIteration || 0}
        </span>
      </div>

      <div class="control-buttons">
        {#if loopStore.isRunning}
          <button class="btn-sm btn-warning" onclick={() => loopStore.pauseLoop()}>⏸ Pause</button>
        {:else if loopStore.isPaused}
          <button class="btn-sm btn-primary" onclick={() => loopStore.resumeLoop()}>▶ Resume</button
          >
        {/if}
        <button
          class="btn-sm btn-danger"
          onclick={() => {
            if (confirm('Cancel the autonomous loop?')) loopStore.cancelLoop();
          }}>⏹ Cancel</button
        >
      </div>
    {:else}
      <button
        class="btn-sm btn-primary full-width"
        disabled={!loopStore.selectedPrdId}
        onclick={openLoopConfig}
      >
        ▶ Start Loop
      </button>
    {/if}
  </div>

  <!-- Activity Log -->
  {#if loopStore.log.length > 0}
    <div class="log-section">
      <div class="section-header">
        <h4>Activity Log</h4>
        <span class="log-count">{loopStore.log.length}</span>
      </div>
      <div class="log-list" bind:this={logEl}>
        {#each [...loopStore.log].reverse() as entry}
          <div class="log-entry">
            <span class="log-time">{formatTime(entry.timestamp)}</span>
            <span class="log-action" style:color={actionColor(entry.action)}>
              {actionLabel(entry.action)}
            </span>
            <span class="log-detail">{entry.detail}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .loop-panel {
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
    padding: 4px 4px 4px;
  }
  .section-header h3 {
    font-size: 13px;
    font-weight: 600;
  }
  .section-header h4 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .header-actions {
    display: flex;
    gap: 4px;
  }

  .stories-menu-wrap {
    position: relative;
  }
  .stories-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .stories-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 170px;
    margin-top: 4px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .menu-item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .menu-item.active-btn {
    color: var(--accent-primary);
    font-weight: 600;
    background: none !important;
    border: none !important;
  }
  .menu-item-danger:hover:not(:disabled) {
    color: var(--accent-error);
  }
  .menu-divider {
    height: 1px;
    margin: 4px 8px;
    background: var(--border-primary);
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

  .prd-section select {
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  .prd-select-row {
    display: flex;
    gap: 4px;
  }
  .prd-select-row select {
    flex: 1;
  }

  .icon-btn {
    padding: 4px 8px;
    font-size: 14px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .create-form,
  .import-area,
  .add-story-form {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .create-form input,
  .create-form textarea,
  .import-area textarea,
  .add-story-form textarea,
  .add-story-form input {
    width: 100%;
    padding: 6px 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    resize: vertical;
  }
  .import-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .story-list {
    overflow-y: auto;
    max-height: 200px;
  }

  .empty-stories {
    padding: 16px 8px;
    text-align: center;
  }
  .empty-hint {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .story-item {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    margin-bottom: 2px;
    background: var(--bg-tertiary);
    transition: background var(--transition);
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
  }
  .story-title {
    font-size: 11px;
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .priority-badge {
    font-size: 9px;
    color: var(--accent-warning, #e6a817);
    font-weight: bold;
  }
  .validate-btn,
  .refine-btn,
  .estimate-btn,
  .priority-btn,
  .delete-btn {
    font-size: 12px;
    padding: 0 4px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
  }
  .story-item:hover .validate-btn,
  .story-item:hover .refine-btn,
  .story-item:hover .estimate-btn,
  .story-item:hover .priority-btn,
  .story-item:hover .delete-btn {
    opacity: 1;
  }
  .validate-btn:hover {
    color: var(--accent-secondary);
  }
  .refine-btn:hover {
    color: var(--accent-primary);
  }
  .estimate-btn:hover {
    color: var(--accent-warning, #e6a817);
  }
  .priority-btn:hover {
    color: var(--accent-primary);
  }
  .delete-btn:hover {
    color: var(--accent-error);
  }

  .story-badges {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 20px;
    margin-top: 2px;
  }

  .estimate-badge {
    font-size: 8px;
    padding: 0 4px;
    border-radius: 2px;
    color: #fff;
    font-weight: 700;
    flex-shrink: 0;
    letter-spacing: 0.3px;
  }

  .total-points {
    font-weight: 400;
    font-size: 11px;
    color: var(--accent-primary);
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

  .priority-rec-badge {
    font-size: 8px;
    padding: 0 3px;
    border-radius: 2px;
    background: rgba(59, 130, 246, 0.15);
    color: var(--accent-primary);
    font-weight: 700;
    flex-shrink: 0;
  }

  .dep-badge {
    font-size: 8px;
    padding: 0 3px;
    border-radius: 2px;
    background: rgba(239, 68, 68, 0.15);
    color: var(--accent-error);
    font-weight: 700;
    flex-shrink: 0;
  }

  .active-btn {
    background: var(--accent-primary) !important;
    color: var(--text-on-accent) !important;
    border-color: var(--accent-primary) !important;
  }

  .attempts-badge {
    font-size: 9px;
    color: var(--text-tertiary);
    margin-left: 20px;
  }

  .sprint-warnings {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .warning-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 100px;
    overflow-y: auto;
  }
  .sprint-warning-item {
    padding: 4px 6px;
    font-size: 10px;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    background: rgba(230, 168, 23, 0.08);
    border-left: 2px solid var(--accent-warning, #e6a817);
    line-height: 1.3;
  }
  .sprint-warning-item.blocking {
    border-left-color: var(--accent-error);
    background: rgba(239, 68, 68, 0.08);
  }
  .sprint-warning-item.circular {
    border-left-color: var(--accent-error);
    background: rgba(239, 68, 68, 0.12);
  }
  .warning-msg {
    word-break: break-word;
  }

  .controls-section {
    padding: 4px 0;
  }

  .progress-info {
    margin-bottom: 8px;
  }
  .progress-bar-container {
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }
  .progress-bar {
    height: 100%;
    background: var(--accent-primary);
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .progress-text {
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .control-buttons {
    display: flex;
    gap: 4px;
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: 11px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--accent-primary);
    color: var(--text-on-accent);
  }
  .btn-warning {
    background: var(--accent-warning, #e6a817);
    color: #000;
  }
  .btn-danger {
    background: var(--accent-error);
    color: var(--text-on-accent);
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .btn-sm:hover {
    opacity: 0.9;
  }
  .btn-sm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .full-width {
    width: 100%;
  }

  .log-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .log-count {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .log-list {
    overflow-y: auto;
    flex: 1;
    min-height: 80px;
    max-height: 200px;
  }
  .log-entry {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 4px;
    font-size: 10px;
  }
  .log-time {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }
  .log-action {
    font-weight: 700;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
  }
  .log-detail {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .plan-row {
    display: flex;
    gap: 4px;
  }
  .btn-plan {
    flex: 1;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    text-align: center;
  }
  .btn-plan:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .edit-lock {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all var(--transition);
    width: 100%;
    text-align: left;
  }
  .edit-lock:hover {
    background: var(--bg-hover);
  }
  .lock-icon {
    font-size: 12px;
    flex-shrink: 0;
  }
  .lock-label {
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: 600;
    letter-spacing: 0.3px;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
