<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { SIDEBAR_TABS } from '$lib/config/sidebarTabs';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import type { SidebarTab } from '$lib/stores/ui.svelte';

  let showMenu = $state(false);
  let contextMenu = $state<{ tabId: SidebarTab; x: number; y: number } | null>(null);

  // --- Drag-to-reorder state ---
  const DRAG_THRESHOLD = 5; // pixels before drag activates (distinguishes click from drag)

  interface DragState {
    tabId: SidebarTab;
    startIndex: number;
    startX: number;
    currentX: number;
    isDragging: boolean; // true once threshold exceeded
    tabWidths: number[]; // cached widths of each pinned tab button
    tabOffsets: number[]; // cached left offsets relative to container
    order: SidebarTab[]; // working copy of tab order during drag
  }

  let drag = $state<DragState | null>(null);
  let tabBtnEls: HTMLButtonElement[] = [];

  function handleDragStart(tabId: SidebarTab, index: number, e: MouseEvent) {
    // Only left mouse button
    if (e.button !== 0) return;

    // Cache tab button geometries
    const widths: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < tabBtnEls.length; i++) {
      const el = tabBtnEls[i];
      if (el) {
        const rect = el.getBoundingClientRect();
        widths.push(rect.width);
        offsets.push(rect.left);
      }
    }

    drag = {
      tabId,
      startIndex: index,
      startX: e.clientX,
      currentX: e.clientX,
      isDragging: false,
      tabWidths: widths,
      tabOffsets: offsets,
      order: [...sidebarLayoutStore.pinnedTabIds],
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(e: MouseEvent) {
    if (!drag) return;

    const deltaX = e.clientX - drag.startX;

    // Check threshold before activating drag
    if (!drag.isDragging) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD) return;
      drag.isDragging = true;
      e.preventDefault();
    }

    drag.currentX = e.clientX;

    // Determine where the dragged tab's center currently is
    const draggedOriginalIndex = drag.startIndex;
    const draggedWidth = drag.tabWidths[draggedOriginalIndex];
    const draggedCenter =
      drag.tabOffsets[draggedOriginalIndex] + draggedWidth / 2 + deltaX;

    // Find current position of dragged tab in the working order
    const currentDragIndex = drag.order.indexOf(drag.tabId);

    // Check if we should swap with adjacent tabs
    let newOrder = [...drag.order];
    let swapped = true;
    while (swapped) {
      swapped = false;
      const idx = newOrder.indexOf(drag.tabId);

      // Check swap with right neighbor
      if (idx < newOrder.length - 1) {
        const rightOrigIndex = sidebarLayoutStore.pinnedTabIds.indexOf(newOrder[idx + 1]);
        if (rightOrigIndex >= 0 && rightOrigIndex < drag.tabOffsets.length) {
          const rightMid =
            drag.tabOffsets[rightOrigIndex] + drag.tabWidths[rightOrigIndex] / 2;
          if (draggedCenter > rightMid) {
            // Swap
            [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
            swapped = true;
            continue;
          }
        }
      }

      // Check swap with left neighbor
      if (idx > 0) {
        const leftOrigIndex = sidebarLayoutStore.pinnedTabIds.indexOf(newOrder[idx - 1]);
        if (leftOrigIndex >= 0 && leftOrigIndex < drag.tabOffsets.length) {
          const leftMid =
            drag.tabOffsets[leftOrigIndex] + drag.tabWidths[leftOrigIndex] / 2;
          if (draggedCenter < leftMid) {
            [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
            swapped = true;
            continue;
          }
        }
      }
    }

    drag.order = newOrder;
  }

  function handleDragEnd() {
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);

    if (!drag) return;

    if (drag.isDragging) {
      // Commit the reorder
      sidebarLayoutStore.reorderPinnedTabs(drag.order);
    } else {
      // Was a click, not a drag — switch tabs
      handleTabClick(drag.tabId);
    }

    drag = null;
  }

  /**
   * Compute the CSS translateX for a tab during drag.
   * - The dragged tab follows the mouse.
   * - Other tabs shift to fill the gap left by the dragged tab.
   */
  function getDragTransform(tabId: SidebarTab, index: number): string {
    if (!drag || !drag.isDragging) return '';

    if (tabId === drag.tabId) {
      // Dragged tab follows mouse
      return `translateX(${drag.currentX - drag.startX}px)`;
    }

    // For non-dragged tabs: compute shift based on position change in working order
    const originalIndex = sidebarLayoutStore.pinnedTabIds.indexOf(tabId);
    const newIndex = drag.order.indexOf(tabId);
    if (originalIndex === newIndex) return '';

    // This tab has shifted. Calculate the pixel offset it needs to move.
    // If the dragged tab was originally at startIndex and is now at a different
    // position, other tabs shift by the dragged tab's width in the appropriate direction.
    const draggedWidth = drag.tabWidths[drag.startIndex];
    const direction = newIndex > originalIndex ? 1 : -1;
    // Each shifted tab moves by the dragged tab's width (including gap)
    const gap = 1; // matches CSS gap: 1px
    const shift = direction * (draggedWidth + gap);
    return `translateX(${shift}px)`;
  }

  function getDragStyle(tabId: SidebarTab, index: number): string {
    const transform = getDragTransform(tabId, index);
    if (!transform) return '';

    if (drag && tabId === drag.tabId) {
      return `transform: ${transform}; opacity: 0.7; z-index: 10;`;
    }

    // Non-dragged tabs get smooth transition
    return `transform: ${transform}; transition: transform 150ms ease;`;
  }

  // --- End drag-to-reorder ---

  function toggleMenu() {
    showMenu = !showMenu;
  }

  function closeMenu() {
    showMenu = false;
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function handleTabClick(tabId: SidebarTab) {
    uiStore.setSidebarTab(tabId);
  }

  function handleDropdownTabClick(tabId: SidebarTab) {
    uiStore.setSidebarTab(tabId);
    closeMenu();
  }

  function handleTogglePin(tabId: SidebarTab, e: MouseEvent) {
    e.stopPropagation();
    if (sidebarLayoutStore.pinnedTabIds.includes(tabId)) {
      sidebarLayoutStore.unpinTab(tabId);
    } else {
      sidebarLayoutStore.pinTab(tabId);
    }
  }

  function handlePopOut(tabId: SidebarTab, e: MouseEvent) {
    e.stopPropagation();
    sidebarLayoutStore.popOutTab(tabId);
    closeMenu();
    closeContextMenu();
  }

  function handleContextMenu(tabId: SidebarTab, e: MouseEvent) {
    e.preventDefault();
    contextMenu = { tabId, x: e.clientX, y: e.clientY };
  }

  function handleContextUnpin(tabId: SidebarTab) {
    sidebarLayoutStore.unpinTab(tabId);
    closeContextMenu();
  }

  function handleContextPopOut(tabId: SidebarTab) {
    sidebarLayoutStore.popOutTab(tabId);
    closeContextMenu();
  }

  function isFloating(tabId: SidebarTab): boolean {
    return sidebarLayoutStore.floatingPanels.some((p) => p.tabId === tabId);
  }
</script>

<nav class="sidebar-tabs" class:dragging={drag?.isDragging}>
  {#each sidebarLayoutStore.pinnedTabs as tab, i (tab.id)}
    <button
      bind:this={tabBtnEls[i]}
      class="tab-btn"
      class:active={uiStore.sidebarTab === tab.id}
      class:floating={isFloating(tab.id)}
      class:drag-source={drag?.isDragging && drag.tabId === tab.id}
      onmousedown={(e) => handleDragStart(tab.id, i, e)}
      oncontextmenu={(e) => handleContextMenu(tab.id, e)}
      style={getDragStyle(tab.id, i)}
      title={tab.label}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d={tab.icon} />
      </svg>
      {#if isFloating(tab.id)}
        <span class="floating-dot"></span>
      {/if}
    </button>
  {/each}

  <div class="hamburger-wrap">
    <button
      class="tab-btn hamburger-btn"
      class:active={showMenu}
      onclick={toggleMenu}
      title="All tabs"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>

    {#if showMenu}
      <div class="menu-backdrop" onclick={closeMenu}></div>
      <div class="dropdown-menu" role="menu">
        {#each SIDEBAR_TABS as tab (tab.id)}
          {@const isPinned = sidebarLayoutStore.pinnedTabIds.includes(tab.id)}
          {@const isActive = uiStore.sidebarTab === tab.id}
          {@const tabIsFloating = isFloating(tab.id)}
          <div class="menu-row" class:menu-item-active={isActive}>
            <button
              class="menu-item"
              role="menuitem"
              onclick={() => handleDropdownTabClick(tab.id)}
            >
              <svg
                class="menu-item-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d={tab.icon} />
              </svg>
              <span class="menu-item-label">
                {tab.label}
                {#if tabIsFloating}
                  <span class="floating-indicator" title="Floating">●</span>
                {/if}
              </span>
            </button>
            <button
              class="menu-action pin-toggle"
              class:pinned={isPinned}
              title={isPinned ? 'Unpin from tab bar' : 'Pin to tab bar'}
              onclick={(e) => handleTogglePin(tab.id, e)}
            >
              {#if isPinned}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
                  <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
                </svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
                </svg>
              {/if}
            </button>
            <button
              class="menu-action popout-btn"
              title="Pop out"
              onclick={(e) => handlePopOut(tab.id, e)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</nav>

{#if contextMenu}
  <div class="context-backdrop" onclick={closeContextMenu}></div>
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
  >
    <button class="menu-item" onclick={() => handleContextUnpin(contextMenu!.tabId)}>
      <svg class="menu-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
      </svg>
      Unpin
    </button>
    <button class="menu-item" onclick={() => handleContextPopOut(contextMenu!.tabId)}>
      <svg class="menu-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
      </svg>
      Pop out
    </button>
  </div>
{/if}

<style>
  .sidebar-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-primary);
    padding: 4px 6px;
    gap: 1px;
    flex-shrink: 0;
  }

  .tab-btn {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 4px;
    color: var(--text-tertiary);
    border-radius: 0;
    transition: all var(--transition);
    position: relative;
    border: 1px solid transparent;
    min-width: 28px;
    background: none;
    cursor: pointer;
  }
  .tab-btn:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .tab-btn.active {
    color: var(--accent-primary);
    background: var(--bg-active);
    border-color: var(--border-primary);
    border-bottom-color: transparent;
  }
  .tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 20%;
    right: 20%;
    height: 1px;
    background: var(--accent-primary);
    box-shadow: 0 0 6px rgba(0, 180, 255, 0.4);
  }
  .tab-btn.floating {
    color: var(--text-secondary);
  }

  /* Drag-to-reorder styles */
  .sidebar-tabs.dragging {
    user-select: none;
    cursor: grabbing;
  }
  .tab-btn.drag-source {
    opacity: 0.7;
    z-index: 10;
  }

  .floating-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent-primary);
    opacity: 0.7;
  }

  /* Hamburger */
  .hamburger-wrap {
    position: relative;
    margin-left: auto;
  }
  .hamburger-btn {
    flex: 0 0 auto;
  }

  /* Dropdown */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 200px;
    margin-top: 4px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }

  .menu-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 6px;
  }
  .menu-row:hover {
    background: var(--bg-hover);
  }
  .menu-row.menu-item-active {
    color: var(--accent-primary);
  }
  .menu-row.menu-item-active .menu-item {
    color: var(--accent-primary);
    font-weight: 600;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .menu-row:hover .menu-item {
    color: var(--text-primary);
  }
  .menu-row.menu-item-active:hover .menu-item {
    color: var(--accent-primary);
  }

  .menu-item-icon {
    flex-shrink: 0;
  }
  .menu-item-label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .floating-indicator {
    font-size: 6px;
    color: var(--accent-primary);
    opacity: 0.7;
    vertical-align: middle;
  }

  .menu-action {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    opacity: 0.5;
    transition: all var(--transition);
    flex-shrink: 0;
  }
  .menu-action:hover {
    opacity: 1;
    color: var(--accent-primary);
    background: var(--bg-active);
  }
  .pin-toggle.pinned {
    opacity: 0.8;
    color: var(--accent-primary);
  }

  .popout-btn:hover {
    color: var(--accent-primary);
  }

  /* Context menu */
  .context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 140px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
</style>
