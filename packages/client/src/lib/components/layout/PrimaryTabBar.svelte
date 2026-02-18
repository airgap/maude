<script lang="ts">
  import { primaryPaneStore, type PrimaryPane } from '$lib/stores/primaryPane.svelte';

  let { pane }: { pane: PrimaryPane } = $props();

  function closeTab(e: MouseEvent, tabId: string) {
    e.stopPropagation();
    primaryPaneStore.closeTab(pane.id, tabId);
  }

  function handleSplitClose() {
    primaryPaneStore.closePane(pane.id);
  }

  let isOnlyPane = $derived(primaryPaneStore.panes.length === 1);
  let canSplit = $derived(primaryPaneStore.panes.length < 10);
</script>

<div class="primary-tab-bar" class:focused={primaryPaneStore.activePaneId === pane.id}>
  <div class="tabs-scroll">
    {#each pane.tabs as tab (tab.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="primary-tab"
        class:active={tab.id === pane.activeTabId}
        role="tab"
        tabindex="0"
        aria-selected={tab.id === pane.activeTabId}
        title={tab.title}
        onclick={() => primaryPaneStore.setActiveTab(pane.id, tab.id)}
        onkeydown={(e) => e.key === 'Enter' && primaryPaneStore.setActiveTab(pane.id, tab.id)}
      >
        {#if tab.kind === 'diff'}
          <!-- Git diff icon -->
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="18" r="3" />
            <path d="M6 9v3a6 6 0 0 0 6 6h2M18 15V9" />
          </svg>
        {:else if tab.kind === 'file'}
          <!-- File icon -->
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        {:else}
          <!-- Chat icon -->
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        {/if}
        <span class="tab-title">{tab.title}</span>
        {#if pane.tabs.length > 1 || tab.kind === 'diff' || tab.kind === 'file'}
          <button
            class="tab-close"
            onclick={(e) => closeTab(e, tab.id)}
            title="Close tab"
            tabindex="-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        {/if}
      </div>
    {/each}

    <!-- New tab button -->
    <button
      class="new-tab-btn"
      title="New conversation"
      onclick={() => primaryPaneStore.openConversation(null, 'New chat', pane.id)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  </div>

  <div class="tab-bar-actions">
    <!-- Close pane button (all panes except when it's the only one) -->
    {#if !isOnlyPane}
      <button class="action-btn" onclick={handleSplitClose} title="Close pane">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    {/if}
    <!-- Split button (visible when under the 10-pane limit) -->
    {#if canSplit}
      <button
        class="action-btn"
        title="Split pane"
        onclick={() => primaryPaneStore.splitOpen(null)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 3v18" />
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .primary-tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    height: 34px;
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .primary-tab-bar.focused {
    border-bottom-color: var(--accent-primary);
  }

  .tabs-scroll {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    flex: 1;
    align-items: stretch;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  /* ── Tab ── */
  .primary-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 8px;
    font-size: 13px;
    color: var(--text-secondary);
    border-right: 1px solid var(--border-secondary);
    background: transparent;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--transition),
      color var(--transition);
    position: relative;
    flex-shrink: 0;
    user-select: none;
  }

  .primary-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .primary-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-bottom: 2px solid var(--accent-primary);
    margin-bottom: -1px;
  }

  .tab-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    opacity: 0.6;
  }

  .primary-tab.active .tab-icon {
    opacity: 1;
  }

  .tab-title {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }

  /* ── Close button ── */
  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    color: var(--text-tertiary);
    opacity: 0;
    transition:
      opacity var(--transition),
      background var(--transition);
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }

  .tab-close svg {
    width: 9px;
    height: 9px;
  }

  .primary-tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: var(--bg-active);
    color: var(--text-primary);
    opacity: 1;
  }

  /* ── New tab button ── */
  .new-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    border-right: 1px solid var(--border-secondary);
  }

  .new-tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .new-tab-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ── Actions ── */
  .tab-bar-actions {
    display: flex;
    align-items: center;
    padding: 0 4px;
    gap: 2px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
  }

  .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .action-btn svg {
    width: 14px;
    height: 14px;
  }
</style>
