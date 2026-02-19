<script lang="ts">
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';

  function toggleSearch() {
    terminalStore.toggleSearch();
  }

  function splitHorizontal() {
    terminalStore.open();
    terminalStore.splitActive('horizontal');
  }

  function splitVertical() {
    terminalStore.open();
    terminalStore.splitActive('vertical');
  }

  function killSession() {
    const sid = terminalStore.activeSessionId;
    if (sid) {
      terminalConnectionManager.destroySession(sid);
      terminalStore.unregisterSession(sid);
      // Close the split pane (or tab if last pane)
      terminalStore.closeSplit(sid);
    }
  }

  function toggleMaximize() {
    terminalStore.toggleMaximize();
  }

  function closePanel() {
    terminalStore.close();
  }
</script>

<div class="terminal-actions">
  <button
    class="action-btn"
    class:active={terminalStore.searchOpen}
    onclick={toggleSearch}
    title="Toggle search"
    aria-label="Toggle search"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </button>

  <button
    class="action-btn"
    onclick={splitHorizontal}
    title="Split horizontal (side by side)"
    aria-label="Split horizontal"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  </button>

  <button
    class="action-btn"
    onclick={splitVertical}
    title="Split vertical (top/bottom)"
    aria-label="Split vertical"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  </button>

  <button
    class="action-btn"
    onclick={killSession}
    title="Kill terminal"
    aria-label="Kill terminal"
    disabled={!terminalStore.activeSessionId}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  </button>

  <button
    class="action-btn"
    class:active={terminalStore.maximized}
    onclick={toggleMaximize}
    title={terminalStore.maximized ? 'Restore' : 'Maximize'}
    aria-label={terminalStore.maximized ? 'Restore terminal' : 'Maximize terminal'}
  >
    {#if terminalStore.maximized}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
      </svg>
    {:else}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    {/if}
  </button>

  <div class="action-separator"></div>

  <button
    class="action-btn close-btn"
    onclick={closePanel}
    title="Close terminal panel"
    aria-label="Close terminal panel"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>
</div>

<style>
  .terminal-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    flex-shrink: 0;
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
  .action-btn:disabled {
    opacity: 0.3;
    cursor: default;
    pointer-events: none;
  }
  .action-btn svg {
    width: 14px;
    height: 14px;
  }

  .action-separator {
    width: 1px;
    height: 16px;
    background: var(--border-secondary);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: var(--accent-error);
  }
</style>
