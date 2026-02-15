<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { SIDEBAR_TABS } from '$lib/config/sidebarTabs';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import type { SidebarTab } from '$lib/stores/ui.svelte';

  let showMenu = $state(false);
  let contextMenu = $state<{ tabId: SidebarTab; x: number; y: number } | null>(null);

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

<nav class="sidebar-tabs">
  {#each sidebarLayoutStore.pinnedTabs as tab (tab.id)}
    <button
      class="tab-btn"
      class:active={uiStore.sidebarTab === tab.id}
      class:floating={isFloating(tab.id)}
      onclick={() => handleTabClick(tab.id)}
      oncontextmenu={(e) => handleContextMenu(tab.id, e)}
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
