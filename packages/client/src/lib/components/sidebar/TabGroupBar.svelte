<script lang="ts">
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import type { TabGroup } from '$lib/stores/sidebarLayout.svelte';
  import { SIDEBAR_TABS } from '$lib/config/sidebarTabs';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { panelDragStore } from '$lib/stores/panelDrag.svelte';

  interface Props {
    group: TabGroup;
    column: 'left' | 'right';
    groupIndex: number;
  }

  let { group, column, groupIndex }: Props = $props();

  let showMenu = $state(false);
  let contextMenu = $state<{ tabId: SidebarTab; x: number; y: number } | null>(null);

  // --- Drag-to-reorder state ---
  const DRAG_THRESHOLD = 5;
  const TEAROFF_THRESHOLD = 40;

  interface DragState {
    tabId: SidebarTab;
    startIndex: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isDragging: boolean;
    /** True when this tab has entered cross-component drag mode */
    crossDrag: boolean;
    tabWidths: number[];
    tabOffsets: number[];
    order: SidebarTab[];
  }

  let drag = $state<DragState | null>(null);
  let tabBtnEls: HTMLButtonElement[] = [];

  function handleDragStart(tabId: SidebarTab, index: number, e: MouseEvent) {
    if (e.button !== 0) return;
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
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      isDragging: false,
      crossDrag: false,
      tabWidths: widths,
      tabOffsets: offsets,
      order: [...group.tabs],
    };
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(e: MouseEvent) {
    if (!drag || drag.crossDrag) return;
    const deltaX = e.clientX - drag.startX;
    const deltaY = e.clientY - drag.startY;

    if (!drag.isDragging) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD && Math.abs(deltaY) < DRAG_THRESHOLD) return;
      drag.isDragging = true;
      e.preventDefault();
    }

    drag.currentX = e.clientX;
    drag.currentY = e.clientY;

    // Tear-off: vertical drag enters cross-component drag mode
    if (Math.abs(deltaY) > TEAROFF_THRESHOLD) {
      drag.crossDrag = true;
      const tabId = drag.tabId;

      // Start shared drag — this makes drop zones appear everywhere
      panelDragStore.startDrag(
        tabId,
        { type: 'tab-bar', column, groupIndex },
        e.clientX,
        e.clientY,
      );

      // Now the global handlers take over
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.addEventListener('mousemove', handleCrossDragMove);
      document.addEventListener('mouseup', handleCrossDragEnd);
      return;
    }

    // Horizontal reorder
    const draggedOriginalIndex = drag.startIndex;
    const draggedWidth = drag.tabWidths[draggedOriginalIndex];
    const draggedCenter = drag.tabOffsets[draggedOriginalIndex] + draggedWidth / 2 + deltaX;

    let newOrder = [...drag.order];
    let swapped = true;
    while (swapped) {
      swapped = false;
      const idx = newOrder.indexOf(drag.tabId);
      if (idx < newOrder.length - 1) {
        const rightOrigIndex = group.tabs.indexOf(newOrder[idx + 1]);
        if (rightOrigIndex >= 0 && rightOrigIndex < drag.tabOffsets.length) {
          const rightMid = drag.tabOffsets[rightOrigIndex] + drag.tabWidths[rightOrigIndex] / 2;
          if (draggedCenter > rightMid) {
            [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
            swapped = true;
            continue;
          }
        }
      }
      if (idx > 0) {
        const leftOrigIndex = group.tabs.indexOf(newOrder[idx - 1]);
        if (leftOrigIndex >= 0 && leftOrigIndex < drag.tabOffsets.length) {
          const leftMid = drag.tabOffsets[leftOrigIndex] + drag.tabWidths[leftOrigIndex] / 2;
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
    if (drag.isDragging && !drag.crossDrag) {
      sidebarLayoutStore.reorderTabsInGroup(column, groupIndex, drag.order);
    } else if (!drag.isDragging) {
      handleTabClick(drag.tabId);
    }
    drag = null;
  }

  // --- Cross-component drag (after tear-off) ---

  function handleCrossDragMove(e: MouseEvent) {
    panelDragStore.updatePosition(e.clientX, e.clientY);
  }

  function handleCrossDragEnd(_e: MouseEvent) {
    document.removeEventListener('mousemove', handleCrossDragMove);
    document.removeEventListener('mouseup', handleCrossDragEnd);

    const result = panelDragStore.endDrag();
    if (!result) {
      drag = null;
      return;
    }

    const { tabId, target } = result;

    if (!target) {
      // No drop target — pop out as floating panel
      sidebarLayoutStore.popOutTab(tabId, {
        x: Math.max(0, _e.clientX - 160),
        y: Math.max(0, _e.clientY - 14),
      });
    } else if (target.type === 'tab-bar') {
      sidebarLayoutStore.moveTabToGroup(
        tabId,
        target.column,
        target.groupIndex,
        target.insertIndex,
      );
    } else if (target.type === 'split') {
      sidebarLayoutStore.createSplit(tabId, target.column, target.insertGroupAtIndex);
    } else if (target.type === 'column') {
      sidebarLayoutStore.addTabToColumn(tabId, target.column);
    }

    drag = null;
  }

  // --- Drop target: this tab bar itself accepts drops ---

  function handleBarMouseEnter() {
    if (!panelDragStore.isDragging) return;
    // Set this tab bar as the drop target
    panelDragStore.setDropTarget({
      type: 'tab-bar',
      column,
      groupIndex,
      insertIndex: group.tabs.length, // default: append at end
    });
  }

  function handleBarMouseLeave() {
    if (!panelDragStore.isDragging) return;
    const dt = panelDragStore.dropTarget;
    if (dt && dt.type === 'tab-bar' && dt.column === column && dt.groupIndex === groupIndex) {
      panelDragStore.setDropTarget(null);
    }
  }

  function handleTabSlotEnter(insertIndex: number) {
    if (!panelDragStore.isDragging) return;
    // Refine the insertion point within this tab bar
    panelDragStore.setDropTarget({
      type: 'tab-bar',
      column,
      groupIndex,
      insertIndex,
    });
  }

  // --- Visual helpers ---

  function getDragTransform(tabId: SidebarTab): string {
    if (!drag || !drag.isDragging || drag.crossDrag) return '';
    if (tabId === drag.tabId) {
      const dx = drag.currentX - drag.startX;
      const dy = drag.currentY - drag.startY;
      return `translate(${dx}px, ${dy}px)`;
    }
    const originalIndex = group.tabs.indexOf(tabId);
    const newIndex = drag.order.indexOf(tabId);
    if (originalIndex === newIndex) return '';
    const draggedWidth = drag.tabWidths[drag.startIndex];
    const direction = newIndex > originalIndex ? 1 : -1;
    const gap = 1;
    const shift = direction * (draggedWidth + gap);
    return `translateX(${shift}px)`;
  }

  function getDragStyle(tabId: SidebarTab): string {
    const transform = getDragTransform(tabId);
    if (!transform) return '';
    if (drag && tabId === drag.tabId) {
      return `transform: ${transform}; opacity: 0.7; z-index: 10;`;
    }
    return `transform: ${transform}; transition: transform 150ms ease;`;
  }

  /** Whether the dragged tab came from this bar and is now in cross-drag */
  const tabHidden = $derived.by(() => {
    if (!drag?.crossDrag) return null;
    return drag.tabId;
  });

  /** Is an external drag hovering over this bar? */
  const isDropTarget = $derived.by(() => {
    const dt = panelDragStore.dropTarget;
    return (
      panelDragStore.isDragging &&
      dt !== null &&
      dt.type === 'tab-bar' &&
      dt.column === column &&
      dt.groupIndex === groupIndex
    );
  });

  /** Where in this bar would the tab be inserted? */
  const dropInsertIndex = $derived.by(() => {
    const dt = panelDragStore.dropTarget;
    if (!isDropTarget || !dt || dt.type !== 'tab-bar') return -1;
    return dt.insertIndex;
  });

  // --- Actions ---

  function handleTabClick(tabId: SidebarTab) {
    sidebarLayoutStore.setActiveTabInGroup(column, groupIndex, tabId);
  }

  function toggleMenu() {
    showMenu = !showMenu;
  }

  function closeMenu() {
    showMenu = false;
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function handleContextMenu(tabId: SidebarTab, e: MouseEvent) {
    e.preventDefault();
    contextMenu = { tabId, x: e.clientX, y: e.clientY };
  }

  function handlePopOut(tabId: SidebarTab) {
    sidebarLayoutStore.popOutTab(tabId);
    closeMenu();
    closeContextMenu();
  }

  function handleMoveToColumn(tabId: SidebarTab, targetColumn: 'left' | 'right') {
    sidebarLayoutStore.addTabToColumn(tabId, targetColumn);
    closeMenu();
    closeContextMenu();
  }

  function handleRemoveFromGroup(tabId: SidebarTab) {
    sidebarLayoutStore.removeTab(tabId);
    closeContextMenu();
  }

  function handleAddTab(tabId: SidebarTab) {
    sidebarLayoutStore.moveTabToGroup(tabId, column, groupIndex);
    closeMenu();
  }

  const otherColumn = $derived(column === 'left' ? 'right' : 'left');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<nav
  class="tab-group-bar"
  class:dragging={drag?.isDragging && !drag.crossDrag}
  class:drop-target={isDropTarget}
  onmouseenter={handleBarMouseEnter}
  onmouseleave={handleBarMouseLeave}
>
  {#each group.tabs as tab, i (tab)}
    {@const tabDef = SIDEBAR_TABS.find((t) => t.id === tab)}
    {#if tabDef}
      <!-- Drop insertion indicator before this tab -->
      {#if isDropTarget && dropInsertIndex === i}
        <div class="drop-insert-marker"></div>
      {/if}
      <button
        bind:this={tabBtnEls[i]}
        class="tab-btn"
        class:active={group.activeTab === tab}
        class:drag-source={drag?.isDragging && !drag.crossDrag && drag.tabId === tab}
        class:hidden-tab={tabHidden === tab}
        onmousedown={(e) => handleDragStart(tab, i, e)}
        onmouseenter={() => handleTabSlotEnter(i)}
        oncontextmenu={(e) => handleContextMenu(tab, e)}
        style={getDragStyle(tab)}
        title={tabDef.label}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d={tabDef.icon} />
        </svg>
      </button>
    {/if}
  {/each}

  <!-- Drop insertion indicator after last tab -->
  {#if isDropTarget && dropInsertIndex >= group.tabs.length}
    <div class="drop-insert-marker"></div>
  {/if}

  <div class="hamburger-wrap">
    <button
      class="tab-btn hamburger-btn"
      class:active={showMenu}
      onclick={toggleMenu}
      title="Add tab"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>

    {#if showMenu}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="menu-backdrop" onclick={closeMenu}></div>
      <div class="dropdown-menu" role="menu">
        {#each sidebarLayoutStore.unplacedTabs as tab (tab.id)}
          <button class="menu-item" role="menuitem" onclick={() => handleAddTab(tab.id)}>
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
            <span class="menu-item-label">{tab.label}</span>
          </button>
        {/each}
        {#if sidebarLayoutStore.unplacedTabs.length === 0}
          <div class="menu-empty">All tabs placed</div>
        {/if}
      </div>
    {/if}
  </div>
</nav>

{#if contextMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="context-backdrop" onclick={closeContextMenu}></div>
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    <button class="menu-item" onclick={() => handleMoveToColumn(contextMenu!.tabId, otherColumn)}>
      <svg
        class="menu-item-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        {#if otherColumn === 'right'}
          <path d="M5 12h14M12 5l7 7-7 7" />
        {:else}
          <path d="M19 12H5M12 19l-7-7 7-7" />
        {/if}
      </svg>
      Move to {otherColumn}
    </button>
    <button class="menu-item" onclick={() => handlePopOut(contextMenu!.tabId)}>
      <svg
        class="menu-item-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
      </svg>
      Pop out
    </button>
    {#if group.tabs.length > 1}
      <button class="menu-item" onclick={() => handleRemoveFromGroup(contextMenu!.tabId)}>
        <svg
          class="menu-item-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
        Remove
      </button>
    {/if}
  </div>
{/if}

<style>
  .tab-group-bar {
    display: flex;
    border-bottom: 1px solid var(--border-primary);
    padding: 3px 4px;
    gap: 1px;
    flex-shrink: 0;
    background: var(--bg-elevated);
    transition: background 150ms ease;
  }

  .tab-group-bar.drop-target {
    background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-elevated));
  }

  .tab-btn {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 3px;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    position: relative;
    border: 1px solid transparent;
    min-width: 24px;
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
    box-shadow: var(--shadow-glow-sm);
  }

  .tab-btn.hidden-tab {
    opacity: 0.3;
    pointer-events: none;
  }

  .tab-group-bar.dragging {
    user-select: none;
    cursor: grabbing;
  }
  .tab-btn.drag-source {
    opacity: 0.7;
    z-index: 10;
  }

  /* Drop insertion marker — thin accent line between tabs */
  .drop-insert-marker {
    width: 2px;
    align-self: stretch;
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    border-radius: 1px;
    flex-shrink: 0;
    margin: 2px 0;
  }

  .hamburger-wrap {
    position: relative;
    margin-left: auto;
  }
  .hamburger-btn {
    flex: 0 0 auto;
  }

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
    min-width: 160px;
    margin-top: 4px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
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
  .menu-item:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .menu-item-icon {
    flex-shrink: 0;
  }
  .menu-item-label {
    flex: 1;
  }

  .menu-empty {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-tertiary);
    font-style: italic;
  }

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
    box-shadow: var(--shadow);
  }
</style>
