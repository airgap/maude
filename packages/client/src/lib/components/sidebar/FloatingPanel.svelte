<script lang="ts" module>
  // Shared z-index counter across all FloatingPanel instances.
  // Incrementing this on click ensures the clicked panel appears on top.
  let zCounter = 0;
  export function nextZIndex(): number {
    return ++zCounter;
  }
</script>

<script lang="ts">
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { getTabDef } from '$lib/config/sidebarTabs';
  import SidebarTabContent from './SidebarTabContent.svelte';

  import type { PanelDockMode } from '$lib/stores/sidebarLayout.svelte';

  interface Props {
    tabId: SidebarTab;
    x: number;
    y: number;
    width: number;
    height: number;
    docked: PanelDockMode;
  }

  let { tabId, x, y, width, height, docked }: Props = $props();

  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 200;
  const BASE_Z_INDEX = 800;
  const SNAP_THRESHOLD = 40; // px from right edge to trigger snap hint

  const tabDef = $derived(getTabDef(tabId));

  // --- Click-to-focus z-index management ---
  let zIndex = $state(BASE_Z_INDEX);

  function bringToFront() {
    zIndex = BASE_Z_INDEX + nextZIndex();
  }

  // --- Drag state ---
  let dragging = $state(false);
  let snapEdge = $state<'left' | 'right' | null>(null);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanelX = 0;
  let dragStartPanelY = 0;

  function handleDragStart(e: MouseEvent) {
    if (e.button !== 0) return;
    if (docked === 'left' || docked === 'right') return; // edge-docked panels aren't draggable
    e.preventDefault();
    bringToFront();

    dragging = true;
    snapEdge = null;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanelX = x;
    dragStartPanelY = y;

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(e: MouseEvent) {
    if (!dragging) return;

    let newX = dragStartPanelX + (e.clientX - dragStartX);
    let newY = dragStartPanelY + (e.clientY - dragStartY);

    // Clamp to viewport bounds
    newX = Math.max(0, Math.min(window.innerWidth - width, newX));
    newY = Math.max(0, Math.min(window.innerHeight - height, newY));

    x = newX;
    y = newY;

    // Detect snap-to-edge hints
    if (newX <= SNAP_THRESHOLD) {
      snapEdge = 'left';
    } else if (newX + width >= window.innerWidth - SNAP_THRESHOLD) {
      snapEdge = 'right';
    } else {
      snapEdge = null;
    }
  }

  function handleDragEnd() {
    dragging = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);

    // If released near an edge, dock there
    if (snapEdge) {
      const edge = snapEdge;
      snapEdge = null;
      sidebarLayoutStore.dockToEdge(tabId, edge);
    } else {
      sidebarLayoutStore.updatePanelPosition(tabId, x, y);
    }
  }

  // --- Resize state ---
  type ResizeDirection = 'e' | 's' | 'se' | 'w';
  let resizing = $state(false);
  let resizeDir: ResizeDirection = 'se';
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;

  function handleResizeStart(dir: ResizeDirection, e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    bringToFront();

    resizing = true;
    resizeDir = dir;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartWidth = width;
    resizeStartHeight = height;

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }

  function handleResizeMove(e: MouseEvent) {
    if (!resizing) return;

    const deltaX = e.clientX - resizeStartX;
    const deltaY = e.clientY - resizeStartY;

    if (resizeDir === 'e' || resizeDir === 'se') {
      width = Math.max(MIN_WIDTH, resizeStartWidth + deltaX);
    }
    if (resizeDir === 'w') {
      // Left-edge resize for right-docked panels: dragging left = wider
      width = Math.max(MIN_WIDTH, resizeStartWidth - deltaX);
    }
    if (resizeDir === 's' || resizeDir === 'se') {
      height = Math.max(MIN_HEIGHT, resizeStartHeight + deltaY);
    }
  }

  function handleResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    sidebarLayoutStore.updatePanelSize(tabId, width, height);
  }

  // --- Panel click (bring to front) ---
  function handlePanelMouseDown() {
    bringToFront();
  }

  // --- Dock button: returns panel to sidebar ---
  function handleDock() {
    sidebarLayoutStore.dockTab(tabId);
    uiStore.setSidebarTab(tabId);
  }

  // --- Edge-docking toggles ---
  function handleUndock() {
    sidebarLayoutStore.undockFromEdge(tabId);
  }

  function handleDockRight() {
    sidebarLayoutStore.dockToRight(tabId);
  }

  function handleDockLeft() {
    sidebarLayoutStore.dockToLeft(tabId);
  }
</script>

{#if docked === 'left' || docked === 'right'}
  <!-- Edge-docked panel: rendered as a sidebar column -->
  <div
    class="docked-panel"
    class:docked-left={docked === 'left'}
    class:docked-right={docked === 'right'}
    style="width: {width}px;"
    onmousedown={handlePanelMouseDown}
  >
    <div class="title-bar">
      <svg
        class="title-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d={tabDef.icon} />
      </svg>
      <span class="title-label">{tabDef.label}</span>
      <button class="title-action" title="Undock from edge" onclick={handleUndock}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
        </svg>
      </button>
      <button class="title-action" title="Dock panel back to sidebar" onclick={handleDock}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>
    </div>
    <div class="panel-content">
      <SidebarTabContent {tabId} />
    </div>
    <!-- Inward resize handle: right edge for left-docked, left edge for right-docked -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#if docked === 'left'}
      <div class="resize-handle resize-e-dock" onmousedown={(e) => handleResizeStart('e', e)}></div>
    {:else}
      <div class="resize-handle resize-w" onmousedown={(e) => handleResizeStart('w', e)}></div>
    {/if}
  </div>
{:else}
  <!-- Free-floating panel -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="floating-panel"
    class:dragging
    class:resizing
    class:snap-left={snapEdge === 'left'}
    class:snap-right={snapEdge === 'right'}
    style="left: {x}px; top: {y}px; width: {width}px; height: {height}px; z-index: {zIndex};"
    onmousedown={handlePanelMouseDown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="title-bar" onmousedown={handleDragStart}>
      <svg
        class="title-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d={tabDef.icon} />
      </svg>
      <span class="title-label">{tabDef.label}</span>
      <button
        class="title-action"
        title="Dock to left edge"
        onclick={handleDockLeft}
        onmousedown={(e) => e.stopPropagation()}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M3 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3M11 3h10v18H11z" />
        </svg>
      </button>
      <button
        class="title-action"
        title="Dock to right edge"
        onclick={handleDockRight}
        onmousedown={(e) => e.stopPropagation()}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M3 3h12v18H3z" />
        </svg>
      </button>
      <button
        class="title-action"
        title="Dock panel back to sidebar"
        onclick={handleDock}
        onmousedown={(e) => e.stopPropagation()}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>
    </div>

    <div class="panel-content">
      <SidebarTabContent {tabId} />
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle resize-e" onmousedown={(e) => handleResizeStart('e', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle resize-s" onmousedown={(e) => handleResizeStart('s', e)}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle resize-se" onmousedown={(e) => handleResizeStart('se', e)}></div>
  </div>
{/if}

<style>
  /* --- Free-floating panel --- */
  .floating-panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    box-shadow: var(--shadow-lg);
    border-radius: 0;
    overflow: hidden;
  }

  .floating-panel.dragging,
  .floating-panel.resizing {
    user-select: none;
  }

  .floating-panel.snap-left {
    border-left: 2px solid var(--accent-primary);
    box-shadow:
      var(--shadow-lg),
      0 0 12px rgba(0, 180, 255, 0.3);
  }

  .floating-panel.snap-right {
    border-right: 2px solid var(--accent-primary);
    box-shadow:
      var(--shadow-lg),
      0 0 12px rgba(0, 180, 255, 0.3);
  }

  .floating-panel.dragging .title-bar {
    cursor: grabbing;
  }

  /* --- Edge-docked panel (left or right) --- */
  .docked-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    flex-shrink: 0;
    background: var(--bg-secondary);
    overflow: hidden;
    position: relative;
  }

  .docked-panel.docked-left {
    border-right: 1px solid var(--border-primary);
  }

  .docked-panel.docked-right {
    border-left: 1px solid var(--border-primary);
  }

  /* --- Shared title bar --- */
  .title-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-elevated);
    cursor: grab;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-primary);
    min-height: 28px;
    user-select: none;
  }

  .docked-panel .title-bar {
    cursor: default;
  }

  .title-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  .title-label {
    flex: 1;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title-action {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--transition);
  }

  .title-action:hover {
    color: var(--accent-primary);
  }

  /* Content area */
  .panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  /* Resize handles */
  .resize-handle {
    position: absolute;
  }

  .resize-e {
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: ew-resize;
  }

  .resize-s {
    bottom: -3px;
    left: 0;
    width: 100%;
    height: 6px;
    cursor: ns-resize;
  }

  .resize-se {
    bottom: -3px;
    right: -3px;
    width: 12px;
    height: 12px;
    cursor: nwse-resize;
  }

  /* Left-edge resize for right-docked panels */
  .resize-w {
    top: 0;
    left: -3px;
    width: 6px;
    height: 100%;
    cursor: ew-resize;
  }
  .resize-w:hover {
    background: var(--accent-primary);
    box-shadow: 0 0 8px rgba(0, 180, 255, 0.4);
  }

  /* Right-edge resize for left-docked panels */
  .resize-e-dock {
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: ew-resize;
  }
  .resize-e-dock:hover {
    background: var(--accent-primary);
    box-shadow: 0 0 8px rgba(0, 180, 255, 0.4);
  }
</style>
