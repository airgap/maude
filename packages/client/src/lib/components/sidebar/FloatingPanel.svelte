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

  interface Props {
    tabId: SidebarTab;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let { tabId, x, y, width, height }: Props = $props();

  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 200;
  const BASE_Z_INDEX = 800;

  const tabDef = $derived(getTabDef(tabId));

  // --- Click-to-focus z-index management ---
  let zIndex = $state(BASE_Z_INDEX);

  function bringToFront() {
    zIndex = BASE_Z_INDEX + nextZIndex();
  }

  // --- Drag state ---
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanelX = 0;
  let dragStartPanelY = 0;

  function handleDragStart(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    bringToFront();

    dragging = true;
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
  }

  function handleDragEnd() {
    dragging = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    sidebarLayoutStore.updatePanelPosition(tabId, x, y);
  }

  // --- Resize state ---
  type ResizeDirection = 'e' | 's' | 'se';
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

  // --- Dock button ---
  function handleDock() {
    sidebarLayoutStore.dockTab(tabId);
    uiStore.setSidebarTab(tabId);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="floating-panel"
  class:dragging
  class:resizing
  style="left: {x}px; top: {y}px; width: {width}px; height: {height}px; z-index: {zIndex};"
  onmousedown={handlePanelMouseDown}
>
  <!-- Title bar -->
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
      class="dock-btn"
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

  <!-- Content area -->
  <div class="panel-content">
    <SidebarTabContent {tabId} />
  </div>

  <!-- Resize handles -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle resize-e" onmousedown={(e) => handleResizeStart('e', e)}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle resize-s" onmousedown={(e) => handleResizeStart('s', e)}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle resize-se" onmousedown={(e) => handleResizeStart('se', e)}></div>
</div>

<style>
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

  /* Title bar */
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
  }

  .floating-panel.dragging .title-bar {
    cursor: grabbing;
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

  .dock-btn {
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

  .dock-btn:hover {
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
</style>
