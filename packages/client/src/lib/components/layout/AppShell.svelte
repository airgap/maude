<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import Sidebar from '../sidebar/Sidebar.svelte';
  import SettingsModal from '../settings/SettingsModal.svelte';
  import CommandPalette from '../common/CommandPalette.svelte';
  import ToastContainer from '../common/ToastContainer.svelte';

  let { children } = $props<{ children: any }>();

  let resizing = $state(false);
  let startX = 0;
  let startWidth = 0;

  function onResizeStart(e: MouseEvent) {
    resizing = true;
    startX = e.clientX;
    startWidth = uiStore.sidebarWidth;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizing) return;
    const delta = e.clientX - startX;
    uiStore.setSidebarWidth(startWidth + delta);
  }

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }

  function onKeydown(e: KeyboardEvent) {
    // Ctrl+K or Ctrl+Shift+P: Command palette
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      uiStore.openModal('command-palette');
    }
    // Ctrl+/: Toggle sidebar
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      uiStore.toggleSidebar();
    }
    // Escape: Close modal
    if (e.key === 'Escape' && uiStore.activeModal) {
      e.preventDefault();
      uiStore.closeModal();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app-shell" class:resizing>
  <TopBar />

  <div class="app-body">
    {#if uiStore.sidebarOpen}
      <aside class="sidebar" style:width="{uiStore.sidebarWidth}px">
        <Sidebar />
      </aside>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-handle" onmousedown={onResizeStart}></div>
    {/if}

    <main class="main-content">
      {@render children()}
    </main>
  </div>

  <StatusBar />

  {#if uiStore.activeModal === 'settings'}
    <SettingsModal />
  {/if}

  {#if uiStore.activeModal === 'command-palette'}
    <CommandPalette />
  {/if}

  <ToastContainer />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    position: relative;
  }
  /* Faint grid overlay across entire app */
  .app-shell::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(rgba(0, 180, 255, 0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0, 180, 255, 0.02) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 0;
  }

  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    z-index: 1;
  }

  .sidebar {
    flex-shrink: 0;
    border-right: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .resize-handle {
    width: 2px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    transition: background var(--transition);
    position: relative;
  }
  .resize-handle:hover,
  .resizing .resize-handle {
    background: var(--accent-primary);
    box-shadow: 0 0 8px rgba(0, 180, 255, 0.4);
  }

  .main-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-primary);
    position: relative;
    z-index: 1;
  }
</style>
