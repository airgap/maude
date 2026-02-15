<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import SidebarTabBar from './SidebarTabBar.svelte';
  import SidebarTabContent from './SidebarTabContent.svelte';
</script>

<div class="sidebar-container">
  <SidebarTabBar />

  <div class="sidebar-content">
    <SidebarTabContent tabId={uiStore.sidebarTab} />
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
</style>
