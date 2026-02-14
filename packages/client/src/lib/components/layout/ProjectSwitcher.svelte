<script lang="ts">
  import { projectStore } from '$lib/stores/projects.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  let open = $state(false);
  let browsing = $state(false);
  let browseLoading = $state(false);
  let browsedPath = $state('');
  let dirOptions = $state<{ name: string; path: string }[]>([]);
  let dropdown: HTMLDivElement;

  onMount(() => {
    projectStore.loadProjects();
  });

  function handleClickOutside(e: MouseEvent) {
    if (dropdown && !dropdown.contains(e.target as Node)) {
      open = false;
      browsing = false;
    }
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
      await projectStore.createProject(name, path);
    } catch (e: any) {
      uiStore.toast(e.message || 'Failed to create project', 'error');
    }
    browsing = false;
    open = false;
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="project-switcher" bind:this={dropdown}>
  <button class="switcher-btn" onclick={() => (open = !open)}>
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
    <span class="project-name">
      {projectStore.activeProject?.name || 'No Project'}
    </span>
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if open}
    <div class="dropdown">
      {#if browsing}
        <div class="browse-header">
          <span class="browse-path" title={browsedPath}>{browsedPath}</span>
        </div>
        {#if browsedPath !== '/'}
          <button
            class="dropdown-item browse-item"
            onclick={() => browseDirectories(browsedPath.split('/').slice(0, -1).join('/') || '/')}
            >..</button
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
        <button class="dropdown-item" onclick={() => (browsing = false)}> Back </button>
      {:else}
        {#each projectStore.projects as project (project.id)}
          <button
            class="dropdown-item"
            class:active={project.id === projectStore.activeProjectId}
            onclick={() => {
              projectStore.switchProject(project.id);
              open = false;
            }}
          >
            <span class="item-name">{project.name}</span>
            <span class="item-path">{project.path}</span>
          </button>
        {/each}

        {#if projectStore.projects.length > 0}
          <div class="dropdown-divider"></div>
        {/if}

        <button
          class="dropdown-item all-projects"
          onclick={() => {
            projectStore.clearActiveProject();
            open = false;
          }}
        >
          All Projects
        </button>

        <div class="dropdown-divider"></div>

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
            open = false;
          }}
        >
          New Project...
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .project-switcher {
    position: relative;
  }

  .switcher-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 13px;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .switcher-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .project-name {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .dropdown-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .dropdown-item.active {
    background: var(--bg-active);
    color: var(--accent-primary);
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

  .dropdown-divider {
    height: 1px;
    background: var(--border-secondary);
    margin: 4px 8px;
  }

  .all-projects {
    color: var(--text-tertiary);
    font-style: italic;
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
