<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { profilesStore } from '$lib/stores/profiles.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { panelDragStore } from '$lib/stores/panelDrag.svelte';
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import MainContent from './MainContent.svelte';
  import PanelColumn from '../sidebar/PanelColumn.svelte';
  import FloatingPanelContainer from '../sidebar/FloatingPanelContainer.svelte';
  import DragOverlay from '../sidebar/DragOverlay.svelte';
  import SettingsModal from '../settings/SettingsModal.svelte';
  import SnapshotModal from '../settings/SnapshotModal.svelte';
  import LoopConfigModal from '../settings/LoopConfigModal.svelte';
  import StoryGenerateModal from '../settings/StoryGenerateModal.svelte';
  import StoryRefineModal from '../settings/StoryRefineModal.svelte';
  import CriteriaValidationModal from '../settings/CriteriaValidationModal.svelte';
  import StoryEstimateModal from '../settings/StoryEstimateModal.svelte';
  import SprintPlanModal from '../settings/SprintPlanModal.svelte';
  import PrdCompletenessModal from '../settings/PrdCompletenessModal.svelte';
  import TemplateLibraryModal from '../settings/TemplateLibraryModal.svelte';
  import PriorityRecommendationModal from '../settings/PriorityRecommendationModal.svelte';
  import EffortValueMatrixModal from '../settings/EffortValueMatrixModal.svelte';
  import ExternalProviderConfigModal from '../settings/ExternalProviderConfigModal.svelte';
  import CommandPalette from '../common/CommandPalette.svelte';
  import ToastContainer from '../common/ToastContainer.svelte';
  import QuickOpen from '../editor/QuickOpen.svelte';
  import ProjectSetup from '../common/ProjectSetup.svelte';
  import AmbientBackground from './AmbientBackground.svelte';
  import InteractiveTutorial from '../common/InteractiveTutorial.svelte';
  import { waitForServer } from '$lib/api/client';
  import { reconnectActiveStream } from '$lib/api/sse';
  import { deviceStore } from '$lib/stores/device.svelte';
  import { tutorialStore } from '$lib/stores/tutorial.svelte';
  import { onMount } from 'svelte';

  let { children: appChildren } = $props<{ children: any }>();

  onMount(() => {
    deviceStore.init();

    waitForServer().then(async () => {
      workspaceStore.init();
      sidebarLayoutStore.init();
      primaryPaneStore.init();
      profilesStore.load();

      // On mobile, start with sidebar closed
      if (deviceStore.isMobileUI) {
        // sidebarLayoutStore.init() may open it — close after init
        setTimeout(() => {
          if (deviceStore.isMobileUI && uiStore.sidebarOpen) {
            uiStore.toggleSidebar();
          }
        }, 0);
      }

      // Check for in-flight streaming sessions and reconnect if found.
      // This handles page reloads during active Claude responses.
      try {
        await reconnectActiveStream();
      } catch {
        // Non-critical — user can manually reload
      }

      // Auto-launch tutorial for first-time users
      if (tutorialStore.isFirstTime) {
        tutorialStore.start();
      }
    });
  });

  let resizing = $state(false);
  let resizeSide = $state<'left' | 'right'>('left');
  let startX = 0;
  let startWidth = 0;

  function onColumnResizeStart(side: 'left' | 'right', e: MouseEvent) {
    resizing = true;
    resizeSide = side;
    startX = e.clientX;
    const col = side === 'left' ? sidebarLayoutStore.leftColumn : sidebarLayoutStore.rightColumn;
    startWidth = col?.width ?? 280;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizing) return;
    const delta = resizeSide === 'left' ? e.clientX - startX : startX - e.clientX;
    sidebarLayoutStore.setColumnWidth(resizeSide, startWidth + delta);
  }

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }

  // Touch equivalents for column resize
  function onColumnTouchResizeStart(side: 'left' | 'right', e: TouchEvent) {
    e.preventDefault();
    resizing = true;
    resizeSide = side;
    startX = e.touches[0]?.clientX ?? 0;
    const col = side === 'left' ? sidebarLayoutStore.leftColumn : sidebarLayoutStore.rightColumn;
    startWidth = col?.width ?? 280;
  }

  function onColumnTouchResizeMove(e: TouchEvent) {
    if (!resizing || !e.touches[0]) return;
    const x = e.touches[0].clientX;
    const delta = resizeSide === 'left' ? x - startX : startX - x;
    sidebarLayoutStore.setColumnWidth(resizeSide, startWidth + delta);
  }

  function onColumnTouchResizeEnd() {
    resizing = false;
  }

  // Derived from device store — true when touch-primary and no hardware keyboard
  const isMobileUI = $derived(deviceStore.isMobileUI);

  function onMainContentClick() {
    if (isMobileUI && uiStore.sidebarOpen) {
      uiStore.toggleSidebar();
    }
  }

  // --- Edge drop zones for creating columns ---
  const isDragging = $derived(panelDragStore.isDragging);

  function isEdgeDropTarget(side: 'left' | 'right'): boolean {
    const dt = panelDragStore.dropTarget;
    return dt !== null && dt.type === 'column' && dt.column === side;
  }

  function handleEdgeEnter(side: 'left' | 'right') {
    if (!panelDragStore.isDragging) return;
    panelDragStore.setDropTarget({ type: 'column', column: side });
  }

  function handleEdgeLeave(side: 'left' | 'right') {
    if (!panelDragStore.isDragging) return;
    const dt = panelDragStore.dropTarget;
    if (dt && dt.type === 'column' && dt.column === side) {
      panelDragStore.setDropTarget(null);
    }
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
        const idx = ws.findIndex((w) => w.workspaceId === workspaceStore.activeWorkspaceId);
        const prev = (idx - 1 + ws.length) % ws.length;
        workspaceStore.switchWorkspace(ws[prev].workspaceId);
      }
    }
    // Ctrl+Alt+Right: Next workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      const ws = workspaceStore.workspaces;
      if (ws.length > 1 && workspaceStore.activeWorkspaceId) {
        const idx = ws.findIndex((w) => w.workspaceId === workspaceStore.activeWorkspaceId);
        const next = (idx + 1) % ws.length;
        workspaceStore.switchWorkspace(ws[next].workspaceId);
      }
    }
    // Ctrl+Alt+W: Close active workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'w') {
      e.preventDefault();
      if (workspaceStore.activeWorkspaceId) {
        workspaceStore.closeWorkspace(workspaceStore.activeWorkspaceId);
      }
    }
    // Ctrl+Shift+,: Cycle through agent profiles
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ',') {
      e.preventDefault();
      profilesStore.cycleProfile();
      const profile = profilesStore.activeProfile;
      if (profile) {
        uiStore.toast(`Profile: ${profile.name}`, 'success');
      }
    }
    // Escape: Close modal
    if (e.key === 'Escape' && uiStore.activeModal) {
      e.preventDefault();
      uiStore.closeModal();
    }
    // ?: Open help panel (when not typing in an input)
    if (
      e.key === '?' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      uiStore.setSidebarTab('help');
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app-shell" class:resizing>
  <AmbientBackground />
  <TopBar />

  <div class="app-body">
    <!-- Left edge drop zone (when no left column exists) -->
    {#if isDragging && !(uiStore.sidebarOpen && sidebarLayoutStore.leftColumn)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="edge-drop-zone edge-left"
        class:active={isEdgeDropTarget('left')}
        onmouseenter={() => handleEdgeEnter('left')}
        onmouseleave={() => handleEdgeLeave('left')}
      >
        <div class="edge-drop-indicator"></div>
      </div>
    {/if}

    {#if uiStore.sidebarOpen && sidebarLayoutStore.leftColumn}
      <PanelColumn column={sidebarLayoutStore.leftColumn} side="left" />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        onmousedown={(e) => onColumnResizeStart('left', e)}
        ontouchstart={(e) => onColumnTouchResizeStart('left', e)}
        ontouchmove={onColumnTouchResizeMove}
        ontouchend={onColumnTouchResizeEnd}
      ></div>
    {/if}

    <main class="main-content" onclick={onMainContentClick}>
      <!-- Mobile sidebar overlay backdrop -->
      {#if isMobileUI && uiStore.sidebarOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="mobile-sidebar-backdrop" onclick={onMainContentClick}></div>
      {/if}
      <MainContent>
        {#snippet children()}
          {@render appChildren()}
        {/snippet}
      </MainContent>
    </main>

    {#if sidebarLayoutStore.rightColumn}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        onmousedown={(e) => onColumnResizeStart('right', e)}
        ontouchstart={(e) => onColumnTouchResizeStart('right', e)}
        ontouchmove={onColumnTouchResizeMove}
        ontouchend={onColumnTouchResizeEnd}
      ></div>
      <PanelColumn column={sidebarLayoutStore.rightColumn} side="right" />
    {/if}

    <!-- Right edge drop zone (when no right column exists) -->
    {#if isDragging && !sidebarLayoutStore.rightColumn}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="edge-drop-zone edge-right"
        class:active={isEdgeDropTarget('right')}
        onmouseenter={() => handleEdgeEnter('right')}
        onmouseleave={() => handleEdgeLeave('right')}
      >
        <div class="edge-drop-indicator"></div>
      </div>
    {/if}
  </div>

  <StatusBar />

  <FloatingPanelContainer />
  <DragOverlay />

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

  {#if uiStore.activeModal === 'prd-completeness'}
    <PrdCompletenessModal />
  {/if}

  {#if uiStore.activeModal === 'template-library'}
    <TemplateLibraryModal />
  {/if}

  {#if uiStore.activeModal === 'priority-recommendation'}
    <PriorityRecommendationModal />
  {/if}

  {#if uiStore.activeModal === 'effort-value-matrix'}
    <EffortValueMatrixModal />
  {/if}

  {#if uiStore.activeModal === 'external-provider-config'}
    <ExternalProviderConfigModal />
  {/if}

  {#if uiStore.activeModal === 'command-palette'}
    <CommandPalette />
  {/if}

  <QuickOpen />
  <ProjectSetup />

  <InteractiveTutorial />

  <ToastContainer />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    position: relative;
    /* Safe area insets for notch / Dynamic Island / home bar */
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  /* Ambient overlay — varies per hypertheme */
  .app-shell::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    /* Tech default: faint grid */
    background:
      linear-gradient(var(--border-secondary) 1px, transparent 1px),
      linear-gradient(90deg, var(--border-secondary) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  /* ── Hypertheme overlay variants ── */

  /* Canvas-based hyperthemes: hide CSS overlay, canvas handles it */
  :global([data-hypertheme='arcane']) .app-shell::before,
  :global([data-hypertheme='ethereal']) .app-shell::before,
  :global([data-hypertheme='study']) .app-shell::before,
  :global([data-hypertheme='astral']) .app-shell::before,
  :global([data-hypertheme='astral-midnight']) .app-shell::before {
    display: none;
  }

  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    z-index: 1;
  }

  .resize-handle {
    width: 6px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    transition: background var(--transition);
    position: relative;
    touch-action: none;
  }
  .resize-handle:hover,
  .resizing .resize-handle {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }
  @media (pointer: coarse) {
    .resize-handle {
      width: 44px;
      margin: 0 -19px;
      z-index: 10;
    }
  }

  /* Mobile sidebar overlay backdrop */
  .mobile-sidebar-backdrop {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.5);
  }

  /* --- Edge drop zones for creating columns --- */
  .edge-drop-zone {
    width: 24px;
    flex-shrink: 0;
    position: relative;
    z-index: 5;
    transition:
      width 100ms ease,
      background 100ms ease;
  }

  .edge-drop-zone:hover,
  .edge-drop-zone.active {
    width: 48px;
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .edge-drop-indicator {
    position: absolute;
    top: 8px;
    bottom: 8px;
    width: 2px;
    background: transparent;
    border-radius: 1px;
    transition:
      background 100ms ease,
      box-shadow 100ms ease;
  }

  .edge-left .edge-drop-indicator {
    left: 4px;
  }

  .edge-right .edge-drop-indicator {
    right: 4px;
  }

  .edge-drop-zone:hover .edge-drop-indicator,
  .edge-drop-zone.active .edge-drop-indicator {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
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

  /* ── Mobile layout (data-mobile set by deviceStore when touch + no HW keyboard) ── */
  :global([data-mobile]) .app-body {
    position: relative;
  }
  /* Sidebar columns slide in as overlays */
  :global([data-mobile] .panel-column.column-left),
  :global([data-mobile] .panel-column.column-right) {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 100;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
  }
  :global([data-mobile] .panel-column.column-left) {
    left: 0;
  }
  :global([data-mobile] .panel-column.column-right) {
    right: 0;
  }
  /* Hide column resize handles on mobile (tap backdrop to close) */
  :global([data-mobile]) .resize-handle {
    display: none;
  }
  /* Edge drop zones not needed on mobile */
  :global([data-mobile]) .edge-drop-zone {
    display: none;
  }
  /* Let canvas effects bleed through in magic hyperthemes */
  :global([data-hypertheme='arcane']) .main-content,
  :global([data-hypertheme='ethereal']) .main-content,
  :global([data-hypertheme='astral']) .main-content,
  :global([data-hypertheme='astral-midnight']) .main-content {
    background: var(--bg-glass, rgba(14, 10, 8, 0.85));
  }
  :global([data-hypertheme='study']) .main-content {
    background: transparent;
  }
</style>
