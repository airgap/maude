import type { SidebarTab } from './ui.svelte';
import { SIDEBAR_TABS, type TabDefinition } from '$lib/config/sidebarTabs';

const STORAGE_KEY = 'maude-sidebar-layout';

const DEFAULT_PINNED: SidebarTab[] = ['conversations', 'files', 'search', 'tasks'];

export interface FloatingPanelState {
  tabId: SidebarTab;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PersistedState {
  pinnedTabIds: SidebarTab[];
  floatingPanels: FloatingPanelState[];
}

function loadFromStorage(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveToStorage(state: PersistedState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/** All known tab IDs from the shared config */
function allTabIds(): SidebarTab[] {
  return SIDEBAR_TABS.map((t) => t.id);
}

function createSidebarLayoutStore() {
  let pinnedTabIds = $state<SidebarTab[]>([...DEFAULT_PINNED]);
  let floatingPanels = $state<FloatingPanelState[]>([]);

  const pinnedTabs = $derived<TabDefinition[]>(
    pinnedTabIds
      .map((id) => SIDEBAR_TABS.find((t) => t.id === id))
      .filter((t): t is TabDefinition => t !== undefined),
  );

  const menuTabs = $derived<TabDefinition[]>(
    SIDEBAR_TABS.filter((t) => !pinnedTabIds.includes(t.id)),
  );

  function persist() {
    saveToStorage({ pinnedTabIds, floatingPanels });
  }

  return {
    // --- Getters ---
    get pinnedTabs() {
      return pinnedTabs;
    },
    get pinnedTabIds() {
      return pinnedTabIds;
    },
    get menuTabs() {
      return menuTabs;
    },
    get floatingPanels() {
      return floatingPanels;
    },

    // --- Pinning ---
    pinTab(tabId: SidebarTab) {
      if (pinnedTabIds.includes(tabId)) return;
      // Validate the tab exists in the config
      if (!SIDEBAR_TABS.some((t) => t.id === tabId)) return;
      pinnedTabIds = [...pinnedTabIds, tabId];
      persist();
    },

    unpinTab(tabId: SidebarTab) {
      // Enforce minimum 1 pinned tab
      if (pinnedTabIds.length <= 1) return;
      if (!pinnedTabIds.includes(tabId)) return;
      pinnedTabIds = pinnedTabIds.filter((id) => id !== tabId);
      persist();
    },

    reorderPinnedTabs(newOrder: SidebarTab[]) {
      // Validate: newOrder must contain exactly the current pinned tabs
      const current = new Set(pinnedTabIds);
      const incoming = new Set(newOrder);
      if (current.size !== incoming.size) return;
      for (const id of incoming) {
        if (!current.has(id)) return;
      }
      pinnedTabIds = [...newOrder];
      persist();
    },

    // --- Floating panels (stubs for future implementation) ---
    popOutTab(tabId: SidebarTab, position?: { x: number; y: number }) {
      // Don't allow duplicate floating panels for the same tab
      if (floatingPanels.some((p) => p.tabId === tabId)) return;
      const panel: FloatingPanelState = {
        tabId,
        x: position?.x ?? 100,
        y: position?.y ?? 100,
        width: 320,
        height: 400,
      };
      floatingPanels = [...floatingPanels, panel];
      persist();
    },

    dockTab(tabId: SidebarTab) {
      floatingPanels = floatingPanels.filter((p) => p.tabId !== tabId);
      persist();
    },

    updatePanelPosition(tabId: SidebarTab, x: number, y: number) {
      floatingPanels = floatingPanels.map((p) => (p.tabId === tabId ? { ...p, x, y } : p));
      persist();
    },

    updatePanelSize(tabId: SidebarTab, width: number, height: number) {
      floatingPanels = floatingPanels.map((p) =>
        p.tabId === tabId ? { ...p, width, height } : p,
      );
      persist();
    },

    // --- Persistence ---
    init() {
      const saved = loadFromStorage();
      if (saved) {
        // Validate saved pinned tabs against current config
        const valid = allTabIds();
        const restored = saved.pinnedTabIds.filter((id) => valid.includes(id));
        pinnedTabIds = restored.length > 0 ? restored : [...DEFAULT_PINNED];
        floatingPanels = (saved.floatingPanels ?? []).filter((p) =>
          valid.includes(p.tabId),
        );
      }
    },

    persist,

    // --- Workspace integration ---
    captureState(): PersistedState {
      return {
        pinnedTabIds: [...pinnedTabIds],
        floatingPanels: floatingPanels.map((p) => ({ ...p })),
      };
    },

    restoreState(state: PersistedState) {
      const valid = allTabIds();
      const restored = state.pinnedTabIds.filter((id) => valid.includes(id));
      pinnedTabIds = restored.length > 0 ? restored : [...DEFAULT_PINNED];
      floatingPanels = (state.floatingPanels ?? []).filter((p) =>
        valid.includes(p.tabId),
      );
    },
  };
}

export const sidebarLayoutStore = createSidebarLayoutStore();
