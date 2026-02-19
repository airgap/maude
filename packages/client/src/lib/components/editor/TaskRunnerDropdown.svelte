<script lang="ts">
  import { onMount } from 'svelte';
  import { taskRunnerStore } from '$lib/stores/task-runner.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import type { WorkspaceTask } from '@e/shared';

  let dropdownOpen = $state(false);

  /** Load tasks when workspace changes */
  $effect(() => {
    const ws = workspaceStore.activeWorkspace;
    if (ws?.workspacePath) {
      taskRunnerStore.loadTasks(ws.workspacePath);
    }
  });

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    dropdownOpen = !dropdownOpen;

    // Refresh tasks when opening
    if (dropdownOpen && workspaceStore.activeWorkspace?.workspacePath) {
      taskRunnerStore.loadTasks(workspaceStore.activeWorkspace.workspacePath);
    }
  }

  function closeDropdown() {
    dropdownOpen = false;
  }

  async function runTask(task: WorkspaceTask) {
    dropdownOpen = false;

    // Record this task as recently run
    taskRunnerStore.recordRecentTask(task.id);

    // Open terminal panel
    terminalStore.open();

    // Create a new tab with a descriptive label
    const tabId = terminalStore.createTab();

    // Find the tab to get its session ID
    const tab = terminalStore.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const sessionId = tab.focusedSessionId;

    // Rename the tab to show the task being run
    terminalStore.renameTab(tabId, task.execution);

    // Get workspace path for the CWD
    const cwd = workspaceStore.activeWorkspace?.workspacePath;

    // Create the actual terminal session
    try {
      await terminalConnectionManager.createSession({
        cwd: cwd || undefined,
      });
    } catch {
      // Session creation is handled by the terminal instance component
      // The tab already has a placeholder session ID that will get replaced
    }

    // Wait a tick for the terminal to connect, then write the command
    // The terminal instance handles session creation in its onMount
    // We need to send the command after the session is attached
    scheduleCommandWrite(sessionId, task.execution);
  }

  /**
   * Schedule writing a command to the terminal. Retries briefly if the session
   * isn't ready yet (the terminal instance creates the actual session on mount).
   */
  function scheduleCommandWrite(sessionId: string, command: string) {
    let attempts = 0;
    const maxAttempts = 20;
    const interval = setInterval(() => {
      attempts++;
      const meta = terminalStore.sessions.get(sessionId);
      if (meta?.attached) {
        clearInterval(interval);
        // Write the command + Enter to execute it
        terminalConnectionManager.write(sessionId, command + '\n');
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        // Fallback: just try writing anyway
        terminalConnectionManager.write(sessionId, command + '\n');
      }
    }, 100);
  }

  async function refreshTasks(e: MouseEvent) {
    e.stopPropagation();
    await taskRunnerStore.refreshTasks();
  }

  // Group tasks by source for display
  const groupedTasks = $derived(() => {
    const sorted = taskRunnerStore.sortedTasks;
    const hasRecent = sorted.some((t) => taskRunnerStore.isRecent(t.id));
    const recent: WorkspaceTask[] = [];
    const pkgTasks: WorkspaceTask[] = [];
    const makeTasks: WorkspaceTask[] = [];

    for (const task of sorted) {
      if (hasRecent && taskRunnerStore.isRecent(task.id)) {
        recent.push(task);
      } else if (task.source === 'package.json') {
        pkgTasks.push(task);
      } else if (task.source === 'Makefile') {
        makeTasks.push(task);
      }
    }

    return { recent, pkgTasks, makeTasks };
  });
</script>

<svelte:window onclick={closeDropdown} />

<div class="task-runner-wrapper">
  <button
    class="action-btn"
    class:active={dropdownOpen}
    onclick={toggleDropdown}
    title="Run task"
    aria-label="Run task"
    aria-haspopup="true"
    aria-expanded={dropdownOpen}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  </button>

  {#if dropdownOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="task-dropdown" onclick={(e) => e.stopPropagation()}>
      <div class="dropdown-header">
        <span class="dropdown-title">Tasks</span>
        <button
          class="refresh-btn"
          onclick={refreshTasks}
          title="Refresh task list"
          aria-label="Refresh task list"
          disabled={taskRunnerStore.loading}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class:spinning={taskRunnerStore.loading}
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      {#if taskRunnerStore.loading && taskRunnerStore.tasks.length === 0}
        <div class="dropdown-empty">Loading tasks...</div>
      {:else if !taskRunnerStore.hasTasks}
        <div class="dropdown-empty">No tasks found</div>
        <div class="dropdown-hint">Add scripts to package.json or targets to a Makefile</div>
      {:else}
        {@const groups = groupedTasks()}

        {#if groups.recent.length > 0}
          <div class="task-group-label">Recent</div>
          {#each groups.recent as task (task.id)}
            <button class="task-option" onclick={() => runTask(task)}>
              <svg class="task-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span class="task-name">{task.name}</span>
              <span class="task-source">{task.source === 'package.json' ? taskRunnerStore.packageManager ?? 'npm' : 'make'}</span>
            </button>
          {/each}
          <div class="task-separator"></div>
        {/if}

        {#if groups.pkgTasks.length > 0}
          <div class="task-group-label">
            {taskRunnerStore.packageManager ?? 'npm'} scripts
          </div>
          {#each groups.pkgTasks as task (task.id)}
            <button class="task-option" onclick={() => runTask(task)}>
              <svg class="task-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span class="task-name">{task.name}</span>
              <span class="task-command" title={task.command}>{task.command}</span>
            </button>
          {/each}
        {/if}

        {#if groups.makeTasks.length > 0}
          {#if groups.pkgTasks.length > 0}
            <div class="task-separator"></div>
          {/if}
          <div class="task-group-label">Makefile targets</div>
          {#each groups.makeTasks as task (task.id)}
            <button class="task-option" onclick={() => runTask(task)}>
              <svg class="task-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span class="task-name">{task.name}</span>
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .task-runner-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color var(--transition), background var(--transition);
    padding: 0;
  }
  .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .action-btn.active {
    color: var(--accent-primary);
    background: var(--bg-active);
  }
  .action-btn svg {
    width: 14px;
    height: 14px;
  }

  .task-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 240px;
    max-width: 360px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.4));
    padding: 4px;
    margin-top: 2px;
  }

  .dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-secondary);
    margin-bottom: 4px;
  }

  .dropdown-title {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color var(--transition), background var(--transition);
    padding: 0;
  }
  .refresh-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .dropdown-empty {
    padding: 12px 10px 4px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    text-align: center;
  }

  .dropdown-hint {
    padding: 2px 10px 12px;
    font-size: 10px;
    color: var(--text-quaternary, var(--text-tertiary));
    text-align: center;
    opacity: 0.7;
  }

  .task-group-label {
    padding: 6px 10px 2px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .task-separator {
    height: 1px;
    background: var(--border-secondary);
    margin: 4px 6px;
  }

  .task-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition), color var(--transition);
    white-space: nowrap;
  }
  .task-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .task-icon {
    flex-shrink: 0;
    opacity: 0.5;
  }
  .task-option:hover .task-icon {
    opacity: 0.8;
    color: var(--accent-secondary);
  }

  .task-name {
    font-weight: 500;
    flex-shrink: 0;
  }

  .task-command {
    color: var(--text-tertiary);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .task-source {
    color: var(--text-tertiary);
    font-size: 10px;
    opacity: 0.7;
    flex-shrink: 0;
  }
</style>
