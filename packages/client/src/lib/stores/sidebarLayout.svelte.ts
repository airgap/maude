import type { SidebarTab } from './ui.svelte';
import { SIDEBAR_TABS, type TabDefinition } from '$lib/config/sidebarTabs';

const STORAGE_KEY = 'maude-sidebar-layout';

const DEFAULT_PINNED: SidebarTab[] = ['conversations', 'files', 'search', 'tasks'];

export type PanelDockMode = 'float' | 'left' | 'right';

export interface FloatingPanelState {
  tabId: SidebarTab;
  x: number;
  y: number;
  width: number;
  height: number;
  docked: PanelDockMode;
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

  /** Panels docked to the left edge (stacked below the main sidebar) */
  const leftDockedPanels = $derived<FloatingPanelState[]>(
    floatingPanels.filter((p) => p.docked === 'left'),
  );

  /** Panels docked to the right edge (rendered as a right sidebar) */
  const rightDockedPanels = $derived<FloatingPanelState[]>(
    floatingPanels.filter((p) => p.docked === 'right'),
  );

  /** Free-floating panels (rendered as overlays) */
  const freeFloatingPanels = $derived<FloatingPanelState[]>(
    floatingPanels.filter((p) => p.docked === 'float'),
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
    get leftDockedPanels() {
      return leftDockedPanels;
    },
    get rightDockedPanels() {
      return rightDockedPanels;
    },
    get freeFloatingPanels() {
      return freeFloatingPanels;
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

    // --- Floating / docked panels ---
    popOutTab(
      tabId: SidebarTab,
      position?: { x: number; y: number },
      mode: PanelDockMode = 'float',
    ) {
      // Don't allow duplicate floating panels for the same tab
      if (floatingPanels.some((p) => p.tabId === tabId)) return;
      const panel: FloatingPanelState = {
        tabId,
        x: position?.x ?? 100,
        y: position?.y ?? 100,
        width: 320,
        height: 400,
        docked: mode,
      };
      floatingPanels = [...floatingPanels, panel];
      persist();
    },

    /** Remove panel entirely (back to sidebar only) */
    dockTab(tabId: SidebarTab) {
      floatingPanels = floatingPanels.filter((p) => p.tabId !== tabId);
      persist();
    },

    /** Snap a floating panel to the left edge (below sidebar) */
    dockToLeft(tabId: SidebarTab) {
      floatingPanels = floatingPanels.map((p) =>
        p.tabId === tabId ? { ...p, docked: 'left' as PanelDockMode } : p,
      );
      persist();
    },

    /** Snap a floating panel to the right edge */
    dockToRight(tabId: SidebarTab) {
      floatingPanels = floatingPanels.map((p) =>
        p.tabId === tabId ? { ...p, docked: 'right' as PanelDockMode } : p,
      );
      persist();
    },

    /** Dock to a specific edge */
    dockToEdge(tabId: SidebarTab, edge: 'left' | 'right') {
      floatingPanels = floatingPanels.map((p) =>
        p.tabId === tabId ? { ...p, docked: edge as PanelDockMode } : p,
      );
      persist();
    },

    /** Undock from any edge back to free-floating */
    undockFromEdge(tabId: SidebarTab) {
      floatingPanels = floatingPanels.map((p) =>
        p.tabId === tabId ? { ...p, docked: 'float' as PanelDockMode, x: 100, y: 100 } : p,
      );
      persist();
    },

    updatePanelPosition(tabId: SidebarTab, x: number, y: number) {
      floatingPanels = floatingPanels.map((p) => (p.tabId === tabId ? { ...p, x, y } : p));
      persist();
    },

    updatePanelSize(tabId: SidebarTab, width: number, height: number) {
      floatingPanels = floatingPanels.map((p) => (p.tabId === tabId ? { ...p, width, height } : p));
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
        floatingPanels = (saved.floatingPanels ?? [])
          .filter((p) => valid.includes(p.tabId))
          .map((p) => ({ ...p, docked: p.docked ?? ('float' as PanelDockMode) }));
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
      floatingPanels = (state.floatingPanels ?? [])
        .filter((p) => valid.includes(p.tabId))
        .map((p) => ({ ...p, docked: p.docked ?? ('float' as PanelDockMode) }));
    },
  };
}

export const sidebarLayoutStore = createSidebarLayoutStore();
