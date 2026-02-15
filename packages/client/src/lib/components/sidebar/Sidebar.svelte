<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { getTabDef } from '$lib/config/sidebarTabs';
  import SidebarTabBar from './SidebarTabBar.svelte';
  import SidebarTabContent from './SidebarTabContent.svelte';

  const isFloating = $derived(
    sidebarLayoutStore.floatingPanels.some((p) => p.tabId === uiStore.sidebarTab),
  );

  const activeTabLabel = $derived(getTabDef(uiStore.sidebarTab).label);
</script>

<div class="sidebar-container">
  <SidebarTabBar />

  <div class="sidebar-content">
    {#if isFloating}
      <div class="floating-placeholder">
        <span class="floating-placeholder-text">{activeTabLabel} is in a floating panel</span>
      </div>
    {:else}
      <SidebarTabContent tabId={uiStore.sidebarTab} />
    {/if}
  </div>
</div>

<style>
  .sidebar-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .floating-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
  }

  .floating-placeholder-text {
    color: var(--text-tertiary);
    font-size: 12px;
    font-style: italic;
    text-align: center;
  }
</style>
