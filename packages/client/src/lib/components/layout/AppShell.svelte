<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import MainContent from './MainContent.svelte';
  import Sidebar from '../sidebar/Sidebar.svelte';
  import SettingsModal from '../settings/SettingsModal.svelte';
  import SnapshotModal from '../settings/SnapshotModal.svelte';
  import LoopConfigModal from '../settings/LoopConfigModal.svelte';
  import StoryGenerateModal from '../settings/StoryGenerateModal.svelte';
  import StoryRefineModal from '../settings/StoryRefineModal.svelte';
  import CriteriaValidationModal from '../settings/CriteriaValidationModal.svelte';
  import StoryEstimateModal from '../settings/StoryEstimateModal.svelte';
  import SprintPlanModal from '../settings/SprintPlanModal.svelte';
  import CommandPalette from '../common/CommandPalette.svelte';
  import ToastContainer from '../common/ToastContainer.svelte';
  import QuickOpen from '../editor/QuickOpen.svelte';
  import ProjectSetup from '../common/ProjectSetup.svelte';
  import { waitForServer } from '$lib/api/client';
  import { reconnectActiveStream } from '$lib/api/sse';
  import { onMount } from 'svelte';

  let { children: appChildren } = $props<{ children: any }>();

  onMount(() => {
    waitForServer().then(async () => {
      workspaceStore.init();

      // Check for in-flight streaming sessions and reconnect if found.
      // This handles page reloads during active Claude responses.
      try {
        await reconnectActiveStream();
      } catch {
        // Non-critical — user can manually reload
      }
    });
  });

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
    // Ctrl+Shift+F: Search across files
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      uiStore.setSidebarTab('search');
    }
    // Ctrl+P: Quick open file
    if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
      e.preventDefault();
      uiStore.openModal('quick-open');
    }
    // Ctrl+/: Toggle sidebar
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      uiStore.toggleSidebar();
    }
    // Ctrl+\: Toggle split pane
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      if (editorStore.layoutMode === 'chat-only') {
        editorStore.setLayoutMode('split-horizontal');
      } else if (editorStore.layoutMode === 'split-horizontal') {
        editorStore.setLayoutMode('chat-only');
      } else if (editorStore.layoutMode === 'editor-only') {
        editorStore.setLayoutMode('split-horizontal');
      } else {
        editorStore.setLayoutMode('chat-only');
      }
    }
    // Ctrl+W: Close active tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      if (editorStore.activeTabId && uiStore.focusedPane === 'editor') {
        e.preventDefault();
        editorStore.closeTab(editorStore.activeTabId);
      }
    }
    // Ctrl+Tab / Ctrl+Shift+Tab: Cycle tabs
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      if (editorStore.hasOpenTabs) {
        e.preventDefault();
        editorStore.cycleTab(e.shiftKey ? -1 : 1);
      }
    }
    // Ctrl+1..9: Switch to nth tab
    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (idx < editorStore.tabs.length) {
        e.preventDefault();
        editorStore.activateTabByIndex(idx);
      }
    }
    // Ctrl+`: Toggle terminal
    if ((e.ctrlKey || e.metaKey) && e.key === '`') {
      e.preventDefault();
      terminalStore.toggle();
    }
    // Ctrl+Alt+Left: Previous workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      const ws = workspaceStore.workspaces;
      if (ws.length > 1 && workspaceStore.activeWorkspaceId) {
        const idx = ws.findIndex((w) => w.projectId === workspaceStore.activeWorkspaceId);
        const prev = (idx - 1 + ws.length) % ws.length;
        workspaceStore.switchWorkspace(ws[prev].projectId);
      }
    }
    // Ctrl+Alt+Right: Next workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      const ws = workspaceStore.workspaces;
      if (ws.length > 1 && workspaceStore.activeWorkspaceId) {
        const idx = ws.findIndex((w) => w.projectId === workspaceStore.activeWorkspaceId);
        const next = (idx + 1) % ws.length;
        workspaceStore.switchWorkspace(ws[next].projectId);
      }
    }
    // Ctrl+Alt+W: Close active workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'w') {
      e.preventDefault();
      if (workspaceStore.activeWorkspaceId) {
        workspaceStore.closeWorkspace(workspaceStore.activeWorkspaceId);
      }
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
      <MainContent>
        {#snippet children()}
          {@render appChildren()}
        {/snippet}
      </MainContent>
    </main>
  </div>

  <StatusBar />

  {#if uiStore.activeModal === 'settings'}
    <SettingsModal />
  {/if}

  {#if uiStore.activeModal === 'snapshots'}
    <SnapshotModal />
  {/if}

  {#if uiStore.activeModal === 'loop-config'}
    <LoopConfigModal />
  {/if}

  {#if uiStore.activeModal === 'story-generate'}
    <StoryGenerateModal />
  {/if}

  {#if uiStore.activeModal === 'story-refine'}
    <StoryRefineModal />
  {/if}

  {#if uiStore.activeModal === 'criteria-validation'}
    <CriteriaValidationModal />
  {/if}

  {#if uiStore.activeModal === 'story-estimate'}
    <StoryEstimateModal />
  {/if}

  {#if uiStore.activeModal === 'sprint-plan'}
    <SprintPlanModal />
  {/if}

  {#if uiStore.activeModal === 'command-palette'}
    <CommandPalette />
  {/if}

  <QuickOpen />
  <ProjectSetup />

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
