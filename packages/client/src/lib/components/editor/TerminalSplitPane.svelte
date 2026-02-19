<script lang="ts">
  import type { TerminalLayout } from '@e/shared';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import SplitPane from '../layout/SplitPane.svelte';
  import TerminalInstance from './TerminalInstance.svelte';
  import TerminalSearchBar from './TerminalSearchBar.svelte';

  let {
    layout,
    focusedSessionId,
    active = true,
  } = $props<{
    layout: TerminalLayout;
    focusedSessionId: string;
    active?: boolean;
  }>();

  /** Collect all session IDs from a layout subtree (for ratio identification) */
  function collectSessionIds(node: TerminalLayout): string[] {
    if (node.type === 'leaf') return [node.sessionId];
    return [...collectSessionIds(node.first), ...collectSessionIds(node.second)];
  }

  /** Handle clicking on a pane to focus it */
  function handlePaneClick(sessionId: string) {
    if (focusedSessionId !== sessionId) {
      terminalStore.focusSplit(sessionId);
    }
  }

  /** Handle focus event from terminal (clicking inside xterm) */
  function handlePaneFocus(sessionId: string) {
    if (focusedSessionId !== sessionId) {
      terminalStore.focusSplit(sessionId);
    }
  }
</script>

{#if layout.type === 'leaf'}
  <!-- Leaf node: render a TerminalInstance with focus indicator -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="split-leaf"
    class:focused={focusedSessionId === layout.sessionId}
    onmousedown={() => handlePaneClick(layout.sessionId)}
    onfocusin={() => handlePaneFocus(layout.sessionId)}
  >
    {#if terminalStore.isSearchOpen(layout.sessionId)}
      <TerminalSearchBar sessionId={layout.sessionId} />
    {/if}
    <TerminalInstance sessionId={layout.sessionId} {active} />
  </div>
{:else}
  <!-- Branch node: render SplitPane with two recursive children -->
  {@const firstIds = collectSessionIds(layout.first)}
  {@const secondIds = collectSessionIds(layout.second)}
  <SplitPane
    ratio={layout.ratio}
    direction={layout.direction}
    onRatioChange={(newRatio) => {
      terminalStore.setSplitRatio(firstIds[0], secondIds[0], newRatio);
    }}
  >
    {#snippet first()}
      <svelte:self layout={layout.first} {focusedSessionId} {active} />
    {/snippet}
    {#snippet second()}
      <svelte:self layout={layout.second} {focusedSessionId} {active} />
    {/snippet}
  </SplitPane>
{/if}

<style>
  .split-leaf {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    border: 1px solid transparent;
    transition: border-color var(--transition), box-shadow var(--transition);
  }

  .split-leaf.focused {
    border-color: color-mix(in srgb, var(--accent-primary) 50%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }
</style>
