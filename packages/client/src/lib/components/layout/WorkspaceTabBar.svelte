<script lang="ts">
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { projectStore } from '$lib/stores/projects.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  let dropdownOpen = $state(false);
  let browsing = $state(false);
  let browseLoading = $state(false);
  let browsedPath = $state('');
  let dirOptions = $state<{ name: string; path: string }[]>([]);
  let dropdownEl: HTMLDivElement;
  let addBtnEl: HTMLButtonElement;

  onMount(() => {
    projectStore.loadProjects();
  });

  function handleClickOutside(e: MouseEvent) {
    if (!dropdownOpen) return;
    const target = e.target as Node;
    if (addBtnEl?.contains(target)) return;
    if (dropdownEl?.contains(target)) return;
    dropdownOpen = false;
    browsing = false;
  }

  function switchTo(projectId: string) {
    workspaceStore.switchWorkspace(projectId);
  }

  function closeTab(e: MouseEvent, projectId: string) {
    e.stopPropagation();

    // Check for dirty tabs or active stream
    if (workspaceStore.hasDirtyTabs(projectId)) {
      if (!confirm('This workspace has unsaved changes. Close anyway?')) return;
    }
    if (workspaceStore.hasActiveStream(projectId)) {
      if (!confirm('A stream is running in this workspace. Close and cancel it?')) return;
    }

    workspaceStore.closeWorkspace(projectId);
  }

  function onMiddleClick(e: MouseEvent, projectId: string) {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(e, projectId);
    }
  }

  function openProject(project: { id: string; name: string; path: string }) {
    workspaceStore.openWorkspace(project);
    dropdownOpen = false;
    browsing = false;
  }

  function isAlreadyOpen(projectId: string): boolean {
    return workspaceStore.workspaces.some((w) => w.projectId === projectId);
  }

  async function browseDirectories(parentPath?: string) {
    browseLoading = true;
    try {
      const res = await api.files.directories(parentPath);
      browsedPath = res.data.parent;
      dirOptions = res.data.directories;
      browsing = true;
    } catch (err) {
      uiStore.toast(`Failed to browse directories: ${err}`, 'error');
    } finally {
      browseLoading = false;
    }
  }

  async function selectFolder(path: string) {
    const name = path.split('/').pop() || path;
    try {
      const id = await projectStore.createProject(name, path);
      if (id) {
        const project = projectStore.projects.find((p) => p.id === id);
        if (project) {
          openProject(project);
          return;
        }
      }
    } catch (e: any) {
      uiStore.toast(e.message || 'Failed to create project', 'error');
    }
    browsing = false;
    dropdownOpen = false;
  }
</script>

<svelte:window onmousedown={handleClickOutside} />

<div class="workspace-tabs">
  <div class="tab-list" role="tablist">
    {#each workspaceStore.workspaces as workspace (workspace.projectId)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab"
        class:active={workspace.projectId === workspaceStore.activeWorkspaceId}
        role="tab"
        tabindex="0"
        aria-selected={workspace.projectId === workspaceStore.activeWorkspaceId}
        onclick={() => switchTo(workspace.projectId)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') switchTo(workspace.projectId);
        }}
        onmousedown={(e) => onMiddleClick(e, workspace.projectId)}
        title={workspace.projectPath}
      >
        <span class="tab-name">{workspace.projectName}</span>
        {#if workspaceStore.hasDirtyTabs(workspace.projectId)}
          <span class="dirty-dot" title="Unsaved changes"></span>
        {/if}
        <button
          class="close-btn"
          onclick={(e) => closeTab(e, workspace.projectId)}
          title="Close workspace"
        >
          <span class="close-icon">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
          {#if workspaceStore.hasActiveStream(workspace.projectId)}
            <span class="stream-indicator" title="Stream active"></span>
          {/if}
        </button>
      </div>
    {/each}
  </div>

  <div class="add-wrapper">
    <button
      class="add-btn"
      bind:this={addBtnEl}
      onclick={() => (dropdownOpen = !dropdownOpen)}
      title="Open project in new tab"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>

    {#if dropdownOpen}
      <div class="dropdown" bind:this={dropdownEl}>
        {#if browsing}
          <div class="browse-header">
            <span class="browse-path" title={browsedPath}>{browsedPath}</span>
          </div>
          {#if browsedPath !== '/'}
            <button
              class="dropdown-item browse-item"
              onclick={() =>
                browseDirectories(browsedPath.split('/').slice(0, -1).join('/') || '/')}>..</button
            >
          {/if}
          <button class="dropdown-item browse-select" onclick={() => selectFolder(browsedPath)}>
            Open this folder
          </button>
          {#each dirOptions as dir}
            <button class="dropdown-item browse-item" onclick={() => browseDirectories(dir.path)}>
              {dir.name}/
            </button>
          {/each}
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" onclick={() => (browsing = false)}>Back</button>
        {:else}
          {#each projectStore.projects as project (project.id)}
            <button
              class="dropdown-item"
              class:already-open={isAlreadyOpen(project.id)}
              disabled={isAlreadyOpen(project.id)}
              onclick={() => openProject(project)}
            >
              <span class="item-name">{project.name}</span>
              <span class="item-path">{project.path}</span>
              {#if isAlreadyOpen(project.id)}
                <span class="item-badge">open</span>
              {/if}
            </button>
          {/each}

          {#if projectStore.projects.length > 0}
            <div class="dropdown-divider"></div>
          {/if}

          <button
            class="dropdown-item open-folder"
            disabled={browseLoading}
            onclick={() => browseDirectories()}
          >
            {browseLoading ? 'Loading...' : 'Open Folder...'}
          </button>
          <button
            class="dropdown-item new-project"
            onclick={() => {
              uiStore.openModal('project-setup');
              dropdownOpen = false;
            }}
          >
            New Project...
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .workspace-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    flex: 1;
    overflow: visible;
  }

  .tab-list {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab-list::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    white-space: nowrap;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition),
      box-shadow var(--transition);
    max-width: 160px;
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
  }
  .tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-color: var(--border-secondary);
  }
  .tab.active {
    color: var(--accent-primary);
    background: var(--bg-active);
    border-color: var(--border-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-warning);
    flex-shrink: 0;
  }

  .close-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 2px;
    color: var(--text-tertiary);
    flex-shrink: 0;
    transition:
      background 80ms ease,
      color 80ms ease;
  }

  .close-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 80ms ease;
  }

  .stream-indicator {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 80ms ease;
  }
  .stream-indicator::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: pulse 1.5s infinite;
  }

  .tab:hover .close-icon {
    opacity: 1;
  }
  .tab:hover .stream-indicator {
    opacity: 0;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
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

  .add-wrapper {
    position: relative;
    flex-shrink: 0;
  }

  .add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .add-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 260px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    z-index: 50;
    margin-top: 4px;
  }

  .dropdown-item {
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    color: var(--text-secondary);
    transition: all var(--transition);
  }
  .dropdown-item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .dropdown-item:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .dropdown-item.already-open {
    opacity: 0.5;
  }

  .item-name {
    font-weight: 600;
  }
  .item-path {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-badge {
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border-secondary);
    margin: 4px 8px;
  }

  .open-folder {
    color: var(--accent-primary);
    font-weight: 600;
  }
  .new-project {
    color: var(--text-tertiary);
  }

  .browse-header {
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-secondary);
    margin-bottom: 4px;
  }
  .browse-path {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .browse-item {
    font-family: var(--font-family);
  }
  .browse-select {
    color: var(--accent-primary);
    font-weight: 600;
  }
</style>
