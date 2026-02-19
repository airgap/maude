<script lang="ts">
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import type { TerminalTab } from '@e/shared';

  /** Get the display label for a tab — use CWD directory name if available */
  function getTabDisplayLabel(tab: TerminalTab): string {
    const meta = terminalStore.sessions.get(tab.focusedSessionId);
    if (meta?.cwd) {
      // Extract directory name from path (last component)
      const parts = meta.cwd.replace(/\/+$/, '').split('/');
      const dirName = parts[parts.length - 1];
      if (dirName) return dirName;
    }
    return tab.label;
  }

  let dropdownOpen = $state(false);
  let editingTabId = $state<string | null>(null);
  let editValue = $state('');

  function activateTab(tabId: string) {
    terminalStore.activateTab(tabId);
  }

  function closeTab(e: MouseEvent, tabId: string) {
    e.stopPropagation();
    terminalStore.closeTab(tabId);
  }

  function startRename(e: MouseEvent, tab: TerminalTab) {
    e.preventDefault();
    e.stopPropagation();
    editingTabId = tab.id;
    editValue = tab.label;
  }

  function commitRename() {
    if (editingTabId && editValue.trim()) {
      terminalStore.renameTab(editingTabId, editValue.trim());
    }
    editingTabId = null;
    editValue = '';
  }

  function cancelRename() {
    editingTabId = null;
    editValue = '';
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function addTab(profileId?: string) {
    terminalStore.createTab(profileId);
    dropdownOpen = false;
  }

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    dropdownOpen = !dropdownOpen;
  }

  function closeDropdown() {
    dropdownOpen = false;
  }
</script>

<svelte:window onclick={closeDropdown} />

<div class="terminal-tab-bar">
  <div class="tabs-scroll">
    {#each terminalStore.tabs as tab (tab.id)}
      {@const isActive = tab.id === terminalStore.activeTabId}
      {@const isEditing = tab.id === editingTabId}
      {@const isBroadcasting = terminalStore.isBroadcastActiveForTab(tab.id)}

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="term-tab"
        class:active={isActive}
        class:broadcasting={isBroadcasting}
        onclick={() => activateTab(tab.id)}
        ondblclick={(e) => startRename(e, tab)}
        role="tab"
        tabindex="0"
        aria-selected={isActive}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activateTab(tab.id);
          }
        }}
      >
        {#if isBroadcasting}
          <svg class="broadcast-badge" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-label="Broadcast input active">
            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
          </svg>
        {:else}
          <svg class="shell-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        {/if}

        {#if isEditing}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="tab-rename-input"
            type="text"
            bind:value={editValue}
            onblur={commitRename}
            onkeydown={onRenameKeydown}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <span class="tab-label" title={terminalStore.sessions.get(tab.focusedSessionId)?.cwd || tab.label}>{getTabDisplayLabel(tab)}</span>
        {/if}

        <button
          class="tab-close-btn"
          onclick={(e) => closeTab(e, tab.id)}
          aria-label="Close {tab.label}"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>

  <div class="add-tab-wrapper">
    <button
      class="add-tab-btn"
      onclick={toggleDropdown}
      aria-label="New terminal"
      title="New terminal"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>

    {#if dropdownOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="shell-dropdown" onclick={(e) => e.stopPropagation()}>
        <button class="shell-option" onclick={() => addTab()}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          Default Shell
        </button>
        {#each terminalStore.profiles as profile (profile.id)}
          <button class="shell-option" onclick={() => addTab(profile.id)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            {profile.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .terminal-tab-bar {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .tabs-scroll {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    flex: 1;
    min-width: 0;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  /* ── Tab ── */
  .term-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px 0 8px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    border-right: 1px solid var(--border-secondary);
    background: transparent;
    white-space: nowrap;
    transition: background var(--transition), color var(--transition);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
    min-width: 0;
    height: 100%;
  }
  .term-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .term-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-bottom: 2px solid var(--accent-primary);
    margin-bottom: -1px;
  }

  .shell-icon {
    flex-shrink: 0;
    opacity: 0.5;
  }
  .term-tab.active .shell-icon {
    opacity: 0.9;
    color: var(--accent-primary);
  }

  /* ── Broadcast indicator ── */
  .broadcast-badge {
    flex-shrink: 0;
    color: var(--accent-warning, #ffaa00);
    opacity: 0.9;
  }
  .term-tab.broadcasting {
    border-left: 2px solid var(--accent-warning, #ffaa00);
  }
  .term-tab.broadcasting.active {
    border-bottom-color: var(--accent-warning, #ffaa00);
  }

  .tab-label {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-rename-input {
    width: 80px;
    background: var(--bg-input);
    border: 1px solid var(--border-focus);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-xs);
    padding: 1px 4px;
    outline: none;
    font-family: inherit;
  }

  /* ── Close button ── */
  .tab-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition), background var(--transition), color var(--transition);
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .tab-close-btn svg {
    width: 10px;
    height: 10px;
  }
  .term-tab:hover .tab-close-btn {
    opacity: 1;
  }
  .tab-close-btn:hover {
    background: color-mix(in srgb, var(--accent-error) 18%, var(--bg-active));
    color: var(--accent-error);
  }

  /* ── Add tab button ── */
  .add-tab-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .add-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color var(--transition), background var(--transition);
    padding: 0;
  }
  .add-tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  /* ── Shell profile dropdown ── */
  .shell-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.4));
    padding: 4px;
    margin-top: 2px;
  }

  .shell-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
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
  .shell-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
