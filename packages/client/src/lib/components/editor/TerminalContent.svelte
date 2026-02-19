<script lang="ts">
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import TerminalInstance from './TerminalInstance.svelte';

  /** Collect all session IDs from a layout tree */
  function getSessionId(tab: { layout: { type: string; sessionId?: string } }): string | null {
    if (tab.layout.type === 'leaf' && tab.layout.sessionId) {
      return tab.layout.sessionId;
    }
    return null;
  }
</script>

<div class="terminal-content">
  {#each terminalStore.tabs as tab (tab.id)}
    {@const sessionId = getSessionId(tab)}
    {@const isActive = tab.id === terminalStore.activeTabId}

    {#if sessionId}
      <TerminalInstance {sessionId} active={isActive} />
    {/if}
  {/each}

  {#if terminalStore.tabs.length === 0}
    <div class="empty-state">
      <span class="empty-text">No terminal sessions</span>
    </div>
  {/if}
</div>

<style>
  .terminal-content {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
    overflow: hidden;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }

  .empty-text {
    opacity: 0.6;
  }
</style>
