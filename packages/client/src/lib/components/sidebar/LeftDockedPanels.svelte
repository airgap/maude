<script lang="ts">
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import FloatingPanel from './FloatingPanel.svelte';
</script>

{#each sidebarLayoutStore.leftDockedPanels as panel (panel.tabId)}
  <FloatingPanel
    tabId={panel.tabId}
    x={panel.x}
    y={panel.y}
    width={panel.width}
    height={panel.height}
    docked={panel.docked}
  />
{/each}
