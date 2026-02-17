import { uuid } from '$lib/utils/uuid';

export interface PrimaryTab {
  id: string;
  conversationId: string | null; // null = new/draft
  title: string;
}

export interface PrimaryPane {
  id: string;
  tabs: PrimaryTab[];
  activeTabId: string | null;
}

const STORAGE_KEY = 'e-primary-pane';

function load(): { panes: PrimaryPane[]; activePaneId: string | null; splitRatio: number } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function makePane(conversationId: string | null = null, title = 'New chat'): PrimaryPane {
  const tabId = uuid();
  return {
    id: uuid(),
    tabs: [{ id: tabId, conversationId, title }],
    activeTabId: tabId,
  };
}

function createPrimaryPaneStore() {
  // Deep reactive state — nested objects/arrays are also reactive,
  // so we can mutate individual tab fields without replacing the whole panes array.
  let panes = $state<PrimaryPane[]>([makePane()]);
  let activePaneId = $state<string>(panes[0].id);
  let splitRatio = $state(0.5);
  let isSplit = $derived(panes.length === 2);

  function persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          panes: $state.snapshot(panes),
          activePaneId,
          splitRatio,
        }),
      );
    } catch {}
  }

  function getPane(paneId: string): PrimaryPane | undefined {
    return panes.find((p) => p.id === paneId);
  }

  function activePane(): PrimaryPane {
    return panes.find((p) => p.id === activePaneId) ?? panes[0];
  }

  function activeTab(paneId?: string): PrimaryTab | null {
    const pane = paneId ? getPane(paneId) : activePane();
    if (!pane) return null;
    return pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0] ?? null;
  }

  return {
    get panes() {
      return panes;
    },
    get activePaneId() {
      return activePaneId;
    },
    get splitRatio() {
      return splitRatio;
    },
    get isSplit() {
      return isSplit;
    },
    activePane,
    activeTab,

    /** Open or focus a conversation tab in the given (or active) pane. */
    openConversation(conversationId: string | null, title: string, paneId?: string) {
      const targetId = paneId ?? activePaneId;
      const pane = panes.find((p) => p.id === targetId);
      if (!pane) return;

      const existing = pane.tabs.find((t) => t.conversationId === conversationId);
      if (existing) {
        pane.activeTabId = existing.id;
      } else {
        const tab: PrimaryTab = { id: uuid(), conversationId, title };
        pane.tabs.push(tab);
        pane.activeTabId = tab.id;
      }
      activePaneId = targetId;
      persist();
    },

    /**
     * Update only the title of a tab — does NOT replace the pane array,
     * so it won't trigger effects that depend on pane identity/structure.
     */
    updateTabTitle(conversationId: string, title: string) {
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.conversationId === conversationId && tab.title !== title) {
            tab.title = title; // in-place mutation — fine-grained reactivity
          }
        }
      }
      persist();
    },

    setActiveTab(paneId: string, tabId: string) {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane || !pane.tabs.some((t) => t.id === tabId)) return;
      pane.activeTabId = tabId;
      activePaneId = paneId;
      persist();
    },

    closeTab(paneId: string, tabId: string) {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane) return;

      const idx = pane.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;

      if (pane.tabs.length === 1) {
        // Replace with blank tab
        const blank: PrimaryTab = { id: uuid(), conversationId: null, title: 'New chat' };
        pane.tabs.splice(0, 1, blank);
        pane.activeTabId = blank.id;
      } else {
        pane.tabs.splice(idx, 1);
        if (pane.activeTabId === tabId) {
          pane.activeTabId = pane.tabs[Math.max(0, idx - 1)]?.id ?? pane.tabs[0]?.id ?? null;
        }
      }
      persist();
    },

    setFocusedPane(paneId: string) {
      activePaneId = paneId;
    },

    // ── Split ──

    splitOpen(conversationId: string | null, title = 'New chat') {
      if (panes.length >= 2) {
        // Already split — just open in the other pane
        const otherId = panes.find((p) => p.id !== activePaneId)?.id;
        if (otherId) this.openConversation(conversationId, title, otherId);
        return;
      }
      const newPane = makePane(conversationId, title);
      panes.push(newPane);
      activePaneId = newPane.id;
      persist();
    },

    closeSplit() {
      if (panes.length < 2) return;
      const keep = panes.find((p) => p.id === activePaneId) ?? panes[0];
      panes.splice(0, panes.length, keep);
      activePaneId = keep.id;
      persist();
    },

    setSplitRatio(ratio: number) {
      splitRatio = Math.max(0.2, Math.min(0.8, ratio));
      persist();
    },

    // ── Persistence ──

    init() {
      const saved = load();
      if (!saved || !Array.isArray(saved.panes) || saved.panes.length === 0) return;
      // Replace contents in-place to preserve reactivity
      panes.splice(0, panes.length, ...saved.panes);
      activePaneId = saved.activePaneId ?? panes[0].id;
      splitRatio = saved.splitRatio ?? 0.5;
    },
  };
}

export const primaryPaneStore = createPrimaryPaneStore();
