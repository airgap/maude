<script lang="ts">
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import FloatingPanel from './FloatingPanel.svelte';
</script>

{#each sidebarLayoutStore.rightDockedPanels as panel (panel.tabId)}
  <div class="right-dock-resize-handle"></div>
  <FloatingPanel
    tabId={panel.tabId}
    x={panel.x}
    y={panel.y}
    width={panel.width}
    height={panel.height}
    docked={panel.docked}
  />
{/each}

<style>
  .right-dock-resize-handle {
    width: 2px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    transition: background var(--transition);
    position: relative;
  }
  .right-dock-resize-handle:hover {
    background: var(--accent-primary);
    box-shadow: 0 0 8px rgba(0, 180, 255, 0.4);
  }
</style>
