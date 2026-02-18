import { uuid } from '$lib/utils/uuid';

export type PrimaryTabKind = 'chat' | 'diff' | 'file';

export interface PrimaryTab {
  id: string;
  conversationId: string | null; // null = new/draft
  title: string;
  kind?: PrimaryTabKind; // defaults to 'chat'
  /** For kind='diff': raw unified diff string */
  diffContent?: string;
  /** For kind='diff' | 'file': the file path */
  filePath?: string;
  /** For kind='diff': whether this is a staged diff */
  staged?: boolean;
  /** For kind='file': raw file content */
  fileContent?: string;
  /** For kind='file': detected language */
  language?: string;
}

export interface PrimaryPane {
  id: string;
  tabs: PrimaryTab[];
  activeTabId: string | null;
}

const STORAGE_KEY = 'e-primary-pane';
const MAX_PANES = 10;

function load(): {
  panes: PrimaryPane[];
  activePaneId: string | null;
  sizes: number[];
} | null {
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
    tabs: [{ id: tabId, conversationId, title, kind: 'chat' }],
    activeTabId: tabId,
  };
}

/** Distribute 100% evenly across n panes. */
function evenSizes(n: number): number[] {
  if (n <= 0) return [];
  const each = 100 / n;
  return Array.from({ length: n }, () => each);
}

function createPrimaryPaneStore() {
  let panes = $state<PrimaryPane[]>([makePane()]);
  let activePaneId = $state<string>(panes[0].id);
  /** Flex sizes (percentage, sum = 100), one entry per pane. */
  let sizes = $state<number[]>([100]);

  let isSplit = $derived(panes.length > 1);

  // Legacy compat: single splitRatio for the two-pane case
  let splitRatio = $derived(panes.length === 2 ? sizes[0] / 100 : 0.5);

  function persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          panes: $state.snapshot(panes),
          activePaneId,
          sizes: $state.snapshot(sizes),
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
    get sizes() {
      return sizes;
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

      const existing = pane.tabs.find(
        (t) => t.kind !== 'diff' && t.kind !== 'file' && t.conversationId === conversationId,
      );
      if (existing) {
        pane.activeTabId = existing.id;
      } else {
        const tab: PrimaryTab = { id: uuid(), conversationId, title, kind: 'chat' };
        pane.tabs.push(tab);
        pane.activeTabId = tab.id;
      }
      activePaneId = targetId;
      persist();
    },

    updateTabTitle(conversationId: string, title: string) {
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.conversationId === conversationId && tab.title !== title) {
            tab.title = title;
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
        // Keep at least one tab — replace with a blank chat tab
        const blank: PrimaryTab = {
          id: uuid(),
          conversationId: null,
          title: 'New chat',
          kind: 'chat',
        };
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

    // ── Content tabs (diff / file) ──

    /**
     * Open a git diff in a new tab in the active pane (or reuse an existing
     * tab for the same file+staged combo).
     */
    openDiffTab(filePath: string, diffContent: string, staged: boolean) {
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      const label = `${filePath.split('/').pop() ?? filePath} (${staged ? 'staged' : 'unstaged'})`;

      // Reuse existing tab for same file+staged combo
      const existing = pane.tabs.find(
        (t) => t.kind === 'diff' && t.filePath === filePath && t.staged === staged,
      );
      if (existing) {
        existing.diffContent = diffContent;
        pane.activeTabId = existing.id;
        activePaneId = pane.id;
        persist();
        return;
      }

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title: label,
        kind: 'diff',
        filePath,
        diffContent,
        staged,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Open a file in a new tab in the active pane (or reuse an existing tab
     * for the same file path).
     */
    openFileTab(filePath: string, fileContent: string, language: string) {
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      const fileName = filePath.split('/').pop() ?? filePath;

      // Reuse existing tab for same file
      const existing = pane.tabs.find((t) => t.kind === 'file' && t.filePath === filePath);
      if (existing) {
        existing.fileContent = fileContent;
        pane.activeTabId = existing.id;
        activePaneId = pane.id;
        persist();
        return;
      }

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title: fileName,
        kind: 'file',
        filePath,
        fileContent,
        language,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    // ── Split ──

    /**
     * Add a new split pane to the right of the active pane (or at the end).
     * The active pane donates half its size to the new pane.
     */
    splitOpen(conversationId: string | null, title = 'New chat') {
      if (panes.length >= MAX_PANES) return;

      const activeIdx = panes.findIndex((p) => p.id === activePaneId);
      const insertAt = activeIdx === -1 ? panes.length : activeIdx + 1;

      const newPane = makePane(conversationId, title);

      // Steal half from the pane to the left of the insertion point
      const donorIdx = insertAt > 0 ? insertAt - 1 : 0;
      const donorSize = sizes[donorIdx] ?? 100 / panes.length;
      const half = donorSize / 2;

      sizes[donorIdx] = half;
      sizes.splice(insertAt, 0, half);
      panes.splice(insertAt, 0, newPane);

      activePaneId = newPane.id;
      persist();
    },

    /**
     * Close the pane with the given id (or the active pane).
     * Its size is donated back to the adjacent pane.
     */
    closePane(paneId?: string) {
      const id = paneId ?? activePaneId;
      const idx = panes.findIndex((p) => p.id === id);
      if (idx === -1 || panes.length <= 1) return;

      const removedSize = sizes[idx];
      // Give size to the left neighbour, or the right if we're at index 0
      const donorIdx = idx > 0 ? idx - 1 : 1;
      sizes[donorIdx] += removedSize;

      panes.splice(idx, 1);
      sizes.splice(idx, 1);

      // Re-focus: prefer left neighbour
      const newActive = panes[Math.max(0, idx - 1)];
      activePaneId = newActive.id;
      persist();
    },

    /** Legacy alias used by PrimaryTabBar close-split button. */
    closeSplit() {
      this.closePane();
    },

    /**
     * Resize the divider between pane[dividerIdx] and pane[dividerIdx+1].
     * delta is in percentage points (positive = grow left pane).
     */
    resizeDivider(dividerIdx: number, delta: number) {
      if (dividerIdx < 0 || dividerIdx >= panes.length - 1) return;
      const minSize = 10; // minimum 10% per pane
      const left = sizes[dividerIdx];
      const right = sizes[dividerIdx + 1];
      const newLeft = Math.max(minSize, Math.min(left + right - minSize, left + delta));
      const newRight = left + right - newLeft;
      sizes[dividerIdx] = newLeft;
      sizes[dividerIdx + 1] = newRight;
      persist();
    },

    /** Legacy: called by editorStore with a 0-1 ratio for the 2-pane case. */
    setSplitRatio(ratio: number) {
      if (panes.length === 2) {
        const clamped = Math.max(0.15, Math.min(0.85, ratio));
        sizes[0] = clamped * 100;
        sizes[1] = (1 - clamped) * 100;
        persist();
      }
    },

    // ── Persistence ──

    init() {
      const saved = load();
      if (!saved || !Array.isArray(saved.panes) || saved.panes.length === 0) return;
      panes.splice(0, panes.length, ...saved.panes);
      activePaneId = saved.activePaneId ?? panes[0].id;
      // Handle old format (splitRatio) or new format (sizes)
      if (Array.isArray(saved.sizes) && saved.sizes.length === saved.panes.length) {
        sizes.splice(0, sizes.length, ...saved.sizes);
      } else {
        sizes.splice(0, sizes.length, ...evenSizes(panes.length));
      }
    },
  };
}

export const primaryPaneStore = createPrimaryPaneStore();
