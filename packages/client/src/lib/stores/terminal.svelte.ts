import type {
  ShellProfile,
  TerminalTab,
  TerminalLayout,
  TerminalBranch,
  TerminalLeaf,
  TerminalPreferences,
  SplitDirection,
} from '@e/shared';
import { DEFAULT_TERMINAL_PREFERENCES } from '@e/shared';

// ── localStorage keys ──
const PREFS_KEY = 'e-terminal-preferences';
const TABS_KEY = 'e-terminal-tabs';

// ── Session metadata tracked on the client side ──
export interface SessionMeta {
  id: string;
  shell: string;
  pid: number;
  cwd: string;
  exitCode: number | null;
  attached: boolean;
}

// ── Persisted tab shape (no live session references) ──
export interface PersistedTerminalTab {
  id: string;
  label: string;
  layout: TerminalLayout;
  focusedSessionId: string;
}

// ── Navigation direction for split pane focus ──
export type SplitNavigationDirection = 'up' | 'down' | 'left' | 'right';

// ── Helpers ──

let nextId = 1;
function uid(): string {
  return `term-${Date.now()}-${nextId++}`;
}

function loadPreferences(): TerminalPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_TERMINAL_PREFERENCES };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_TERMINAL_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_TERMINAL_PREFERENCES };
}

function savePreferences(prefs: TerminalPreferences) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function loadPersistedTabs(): { tabs: PersistedTerminalTab[]; activeTabId: string | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

function saveTabState(tabs: TerminalTab[], activeTabId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const persisted: PersistedTerminalTab[] = tabs.map((t) => ({
      id: t.id,
      label: t.label,
      layout: t.layout,
      focusedSessionId: t.focusedSessionId,
    }));
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: persisted, activeTabId }));
  } catch {
    // ignore
  }
}

/** Collect all session IDs referenced in a layout tree */
function collectSessionIds(layout: TerminalLayout): string[] {
  if (layout.type === 'leaf') return [layout.sessionId];
  return [...collectSessionIds(layout.first), ...collectSessionIds(layout.second)];
}

/** Create a default leaf layout for a new session */
function makeLeaf(sessionId: string): TerminalLayout {
  return { type: 'leaf', sessionId };
}

// ── Layout tree manipulation helpers ──

/**
 * Split a leaf node identified by sessionId into a branch with the original
 * leaf and a new leaf. Returns the new layout tree (immutable) and the new sessionId.
 */
function splitLeafInLayout(
  layout: TerminalLayout,
  targetSessionId: string,
  direction: SplitDirection,
): { layout: TerminalLayout; newSessionId: string | null } {
  if (layout.type === 'leaf') {
    if (layout.sessionId === targetSessionId) {
      const newSessionId = uid();
      const branch: TerminalBranch = {
        type: 'split',
        direction,
        ratio: 0.5,
        first: { type: 'leaf', sessionId: targetSessionId },
        second: { type: 'leaf', sessionId: newSessionId },
      };
      return { layout: branch, newSessionId };
    }
    return { layout, newSessionId: null };
  }

  // Recurse into branch children
  const firstResult = splitLeafInLayout(layout.first, targetSessionId, direction);
  if (firstResult.newSessionId !== null) {
    return {
      layout: { ...layout, first: firstResult.layout },
      newSessionId: firstResult.newSessionId,
    };
  }

  const secondResult = splitLeafInLayout(layout.second, targetSessionId, direction);
  if (secondResult.newSessionId !== null) {
    return {
      layout: { ...layout, second: secondResult.layout },
      newSessionId: secondResult.newSessionId,
    };
  }

  return { layout, newSessionId: null };
}

/**
 * Remove a leaf node from the layout tree. Returns the sibling's subtree
 * (promoting it up), or null if the root leaf was removed.
 */
function removeLeafFromLayout(
  layout: TerminalLayout,
  targetSessionId: string,
): TerminalLayout | null {
  if (layout.type === 'leaf') {
    // If this is the target, return null to signal removal
    return layout.sessionId === targetSessionId ? null : layout;
  }

  // Check if either direct child is the target leaf
  if (layout.first.type === 'leaf' && layout.first.sessionId === targetSessionId) {
    return layout.second; // Promote sibling
  }
  if (layout.second.type === 'leaf' && layout.second.sessionId === targetSessionId) {
    return layout.first; // Promote sibling
  }

  // Recurse deeper
  const firstResult = removeLeafFromLayout(layout.first, targetSessionId);
  if (firstResult !== null && firstResult !== layout.first) {
    return { ...layout, first: firstResult };
  }

  const secondResult = removeLeafFromLayout(layout.second, targetSessionId);
  if (secondResult !== null && secondResult !== layout.second) {
    return { ...layout, second: secondResult };
  }

  return layout;
}

/**
 * Update the ratio of a branch that is the direct parent of a given session.
 * We use a path approach: find the branch containing the target sessionId as a leaf descendant.
 */
function setRatioInLayout(
  layout: TerminalLayout,
  parentFirst: string,
  parentSecond: string,
  ratio: number,
): TerminalLayout {
  if (layout.type === 'leaf') return layout;

  // Check if this branch's children match
  const firstIds = collectSessionIds(layout.first);
  const secondIds = collectSessionIds(layout.second);
  if (firstIds.includes(parentFirst) && secondIds.includes(parentSecond)) {
    return { ...layout, ratio };
  }

  // Recurse
  return {
    ...layout,
    first: setRatioInLayout(layout.first, parentFirst, parentSecond, ratio),
    second: setRatioInLayout(layout.second, parentFirst, parentSecond, ratio),
  };
}

/**
 * Update ratio at a specific branch node. The branch is identified by matching
 * its direct first/second child session sets.
 */
function setBranchRatio(
  layout: TerminalLayout,
  branchFirstSessionId: string,
  branchSecondSessionId: string,
  ratio: number,
): TerminalLayout {
  return setRatioInLayout(layout, branchFirstSessionId, branchSecondSessionId, ratio);
}

/** Collect all leaf nodes in order (left-to-right, top-to-bottom depth-first) */
function collectLeaves(layout: TerminalLayout): TerminalLeaf[] {
  if (layout.type === 'leaf') return [layout];
  return [...collectLeaves(layout.first), ...collectLeaves(layout.second)];
}

/**
 * For navigation: get the position context of a leaf in the tree.
 * Returns geometric regions for each leaf to determine adjacency.
 */
interface LeafRegion {
  sessionId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeLeafRegions(
  layout: TerminalLayout,
  x = 0,
  y = 0,
  w = 1,
  h = 1,
): LeafRegion[] {
  if (layout.type === 'leaf') {
    return [{ sessionId: layout.sessionId, x, y, w, h }];
  }

  if (layout.direction === 'horizontal') {
    const firstW = w * layout.ratio;
    const secondW = w - firstW;
    return [
      ...computeLeafRegions(layout.first, x, y, firstW, h),
      ...computeLeafRegions(layout.second, x + firstW, y, secondW, h),
    ];
  } else {
    const firstH = h * layout.ratio;
    const secondH = h - firstH;
    return [
      ...computeLeafRegions(layout.first, x, y, w, firstH),
      ...computeLeafRegions(layout.second, x, y + firstH, w, secondH),
    ];
  }
}

/**
 * Find the best adjacent leaf in a given direction from the focused leaf.
 * Uses geometric regions to determine which leaf is the best neighbor.
 */
function findAdjacentLeaf(
  regions: LeafRegion[],
  focusedId: string,
  direction: SplitNavigationDirection,
): string | null {
  const focused = regions.find((r) => r.sessionId === focusedId);
  if (!focused) return null;

  const focusCenterX = focused.x + focused.w / 2;
  const focusCenterY = focused.y + focused.h / 2;

  let candidates: LeafRegion[] = [];

  switch (direction) {
    case 'left':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.x + r.w <= focused.x + 0.001,
      );
      break;
    case 'right':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.x >= focused.x + focused.w - 0.001,
      );
      break;
    case 'up':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.y + r.h <= focused.y + 0.001,
      );
      break;
    case 'down':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.y >= focused.y + focused.h - 0.001,
      );
      break;
  }

  if (candidates.length === 0) return null;

  // Pick the candidate closest to the center of the focused pane
  let best = candidates[0];
  let bestDist = Infinity;

  for (const c of candidates) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const dist = Math.abs(cx - focusCenterX) + Math.abs(cy - focusCenterY);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  return best.sessionId;
}

// ── Store ──

function createTerminalStore() {
  // --- Panel state ---
  let isOpen = $state(false);
  let panelHeight = $state(250);
  let maximized = $state(false);

  // --- Tabs ---
  let tabs = $state<TerminalTab[]>([]);
  let activeTabId = $state<string | null>(null);

  // --- Sessions (live, not persisted) ---
  let sessions = $state<Map<string, SessionMeta>>(new Map());

  // --- Shell profiles (populated by server) ---
  let profiles = $state<ShellProfile[]>([]);

  // --- Preferences ---
  let preferences = $state<TerminalPreferences>(loadPreferences());

  // --- UI toggles ---
  let searchOpen = $state(false);
  let broadcastInput = $state(false);

  // --- Derived state ---
  const activeTab = $derived(tabs.find((t) => t.id === activeTabId) ?? null);
  const activeSessionId = $derived(activeTab?.focusedSessionId ?? null);
  const tabCount = $derived(tabs.length);
  const connected = $derived(sessions.size > 0);

  // --- Internal helpers ---
  function persistTabs() {
    saveTabState(tabs, activeTabId);
  }

  function persistPrefs() {
    savePreferences(preferences);
  }

  /** Find the tab containing a given session ID */
  function findTabBySession(sessionId: string): TerminalTab | null {
    for (const tab of tabs) {
      const ids = collectSessionIds(tab.layout);
      if (ids.includes(sessionId)) return tab;
    }
    return null;
  }

  return {
    // ── Getters ──
    get isOpen() {
      return isOpen;
    },
    get panelHeight() {
      return panelHeight;
    },
    get maximized() {
      return maximized;
    },
    get tabs() {
      return tabs;
    },
    get activeTabId() {
      return activeTabId;
    },
    get activeTab() {
      return activeTab;
    },
    get activeSessionId() {
      return activeSessionId;
    },
    get tabCount() {
      return tabCount;
    },
    get sessions() {
      return sessions;
    },
    get profiles() {
      return profiles;
    },
    get preferences() {
      return preferences;
    },
    get searchOpen() {
      return searchOpen;
    },
    get broadcastInput() {
      return broadcastInput;
    },
    get connected() {
      return connected;
    },

    // ── Panel lifecycle ──

    toggle() {
      isOpen = !isOpen;
      if (isOpen && tabs.length === 0) {
        this.createTab();
      }
    },

    open() {
      isOpen = true;
      if (tabs.length === 0) {
        this.createTab();
      }
    },

    close() {
      isOpen = false;
      maximized = false;
    },

    toggleMaximize() {
      maximized = !maximized;
    },

    setMaximized(v: boolean) {
      maximized = v;
    },

    setPanelHeight(h: number) {
      panelHeight = Math.max(100, Math.min(600, h));
    },

    // ── Tab management ──

    createTab(profileId?: string): string {
      const sessionId = uid();
      const tabId = uid();
      const tabIndex = tabs.length + 1;
      const label = profileId
        ? `${profileId} ${tabIndex}`
        : `Terminal ${tabIndex}`;

      const tab: TerminalTab = {
        id: tabId,
        label,
        layout: makeLeaf(sessionId),
        focusedSessionId: sessionId,
      };

      tabs = [...tabs, tab];
      activeTabId = tabId;
      persistTabs();
      return tabId;
    },

    closeTab(tabId: string) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return;

      const tab = tabs[idx];
      // Destroy all sessions belonging to this tab
      const sessionIds = collectSessionIds(tab.layout);
      const newSessions = new Map(sessions);
      for (const sid of sessionIds) {
        newSessions.delete(sid);
      }
      sessions = newSessions;

      tabs = tabs.filter((t) => t.id !== tabId);

      // If we closed the active tab, pick an adjacent one
      if (activeTabId === tabId) {
        if (tabs.length > 0) {
          const nextIdx = Math.min(idx, tabs.length - 1);
          activeTabId = tabs[nextIdx].id;
        } else {
          activeTabId = null;
        }
      }

      persistTabs();
    },

    activateTab(tabId: string) {
      if (tabs.some((t) => t.id === tabId)) {
        activeTabId = tabId;
        persistTabs();
      }
    },

    renameTab(tabId: string, label: string) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        tab.label = label;
        tabs = [...tabs]; // trigger reactivity
        persistTabs();
      }
    },

    cycleTab(direction: 1 | -1 = 1) {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) return;
      const next = (idx + direction + tabs.length) % tabs.length;
      activeTabId = tabs[next].id;
      persistTabs();
    },

    // ── Split pane management ──

    /**
     * Split the currently focused pane in the active tab.
     * Creates a new session in the new split.
     */
    splitActive(direction: SplitDirection): string | null {
      const tab = activeTab;
      if (!tab) return null;

      const result = splitLeafInLayout(tab.layout, tab.focusedSessionId, direction);
      if (!result.newSessionId) return null;

      // Update the tab with new layout and focus the new pane
      tab.layout = result.layout;
      tab.focusedSessionId = result.newSessionId;
      tabs = [...tabs]; // trigger reactivity
      persistTabs();

      return result.newSessionId;
    },

    /**
     * Close a specific split pane by session ID. Removes the leaf from the
     * layout tree and promotes the sibling. If this was the last pane in
     * the tab, closes the tab entirely.
     */
    closeSplit(sessionId: string) {
      const tab = findTabBySession(sessionId);
      if (!tab) return;

      // Remove session from live session tracking
      const newSessions = new Map(sessions);
      newSessions.delete(sessionId);
      sessions = newSessions;

      const newLayout = removeLeafFromLayout(tab.layout, sessionId);

      if (newLayout === null) {
        // This was the last pane — close the tab (AC #10)
        this.closeTab(tab.id);
        return;
      }

      tab.layout = newLayout;

      // If the focused session was the one we closed, focus the first remaining leaf
      if (tab.focusedSessionId === sessionId) {
        const leaves = collectLeaves(newLayout);
        tab.focusedSessionId = leaves.length > 0 ? leaves[0].sessionId : '';
      }

      tabs = [...tabs]; // trigger reactivity
      persistTabs();
    },

    /**
     * Focus a specific split pane by session ID.
     */
    focusSplit(sessionId: string) {
      const tab = findTabBySession(sessionId);
      if (!tab) return;

      tab.focusedSessionId = sessionId;

      // Also activate this tab if it's not the current one
      if (activeTabId !== tab.id) {
        activeTabId = tab.id;
      }

      tabs = [...tabs]; // trigger reactivity
      persistTabs();
    },

    /**
     * Navigate focus between split panes using directional movement.
     * Uses geometric regions to find the best adjacent pane.
     */
    navigateSplit(direction: SplitNavigationDirection) {
      const tab = activeTab;
      if (!tab) return;

      const regions = computeLeafRegions(tab.layout);
      if (regions.length < 2) return; // No splits to navigate

      const nextId = findAdjacentLeaf(regions, tab.focusedSessionId, direction);
      if (nextId) {
        tab.focusedSessionId = nextId;
        tabs = [...tabs]; // trigger reactivity
        persistTabs();
      }
    },

    /**
     * Update the split ratio of a branch in the active tab's layout tree.
     * The branch is identified by a session ID from its first child subtree
     * and a session ID from its second child subtree.
     */
    setSplitRatio(firstChildSessionId: string, secondChildSessionId: string, ratio: number) {
      const tab = activeTab;
      if (!tab) return;

      const clamped = Math.max(0.15, Math.min(0.85, ratio));
      tab.layout = setBranchRatio(tab.layout, firstChildSessionId, secondChildSessionId, clamped);
      tabs = [...tabs]; // trigger reactivity
      persistTabs();
    },

    /**
     * Check if the active tab has any splits (more than one leaf).
     */
    get hasSplits(): boolean {
      if (!activeTab) return false;
      return activeTab.layout.type === 'split';
    },

    // ── Session tracking ──

    registerSession(meta: SessionMeta) {
      const newSessions = new Map(sessions);
      newSessions.set(meta.id, meta);
      sessions = newSessions;
    },

    unregisterSession(sessionId: string) {
      const newSessions = new Map(sessions);
      newSessions.delete(sessionId);
      sessions = newSessions;
    },

    setCwd(sessionId: string, cwd: string) {
      const meta = sessions.get(sessionId);
      if (meta) {
        const newSessions = new Map(sessions);
        newSessions.set(sessionId, { ...meta, cwd });
        sessions = newSessions;
      }
    },

    setExitCode(sessionId: string, exitCode: number) {
      const meta = sessions.get(sessionId);
      if (meta) {
        const newSessions = new Map(sessions);
        newSessions.set(sessionId, { ...meta, exitCode });
        sessions = newSessions;
      }
    },

    /** @deprecated use registerSession/unregisterSession instead */
    setConnected(v: boolean) {
      // Legacy compatibility: if called with false, clear all sessions
      // If called with true, it's a no-op (sessions are tracked individually now)
      if (!v) {
        sessions = new Map();
      }
    },

    // ── Profiles ──

    setProfiles(p: ShellProfile[]) {
      profiles = p;
    },

    // ── Preferences ──

    updatePreferences(partial: Partial<TerminalPreferences>) {
      preferences = { ...preferences, ...partial };
      persistPrefs();
    },

    resetPreferences() {
      preferences = { ...DEFAULT_TERMINAL_PREFERENCES };
      persistPrefs();
    },

    // ── Search & broadcast toggles ──

    toggleSearch() {
      searchOpen = !searchOpen;
    },

    setSearchOpen(v: boolean) {
      searchOpen = v;
    },

    toggleBroadcast() {
      broadcastInput = !broadcastInput;
    },

    setBroadcast(v: boolean) {
      broadcastInput = v;
    },

    // ── State capture / restore (for workspace snapshots) ──

    captureState() {
      return {
        isOpen,
        panelHeight,
        maximized,
        tabs: tabs.map((t) => ({
          id: t.id,
          label: t.label,
          layout: t.layout,
          focusedSessionId: t.focusedSessionId,
        })),
        activeTabId,
        preferences: { ...preferences },
      };
    },

    restoreState(state: {
      isOpen: boolean;
      panelHeight: number;
      maximized?: boolean;
      tabs?: PersistedTerminalTab[];
      activeTabId?: string | null;
      preferences?: TerminalPreferences;
    }) {
      isOpen = state.isOpen;
      panelHeight = state.panelHeight;
      maximized = state.maximized ?? false;

      if (state.tabs && state.tabs.length > 0) {
        tabs = state.tabs.map((t) => ({
          id: t.id,
          label: t.label,
          layout: t.layout,
          focusedSessionId: t.focusedSessionId,
        }));
        activeTabId = state.activeTabId ?? state.tabs[0].id;
      } else {
        tabs = [];
        activeTabId = null;
      }

      if (state.preferences) {
        preferences = { ...DEFAULT_TERMINAL_PREFERENCES, ...state.preferences };
        persistPrefs();
      }

      // Clear live session state — sessions will be re-registered by terminal components
      sessions = new Map();
      searchOpen = false;
      broadcastInput = false;

      persistTabs();
    },

    /** Initialize from localStorage on first load */
    init() {
      const savedPrefs = loadPreferences();
      preferences = savedPrefs;

      const savedTabs = loadPersistedTabs();
      if (savedTabs && savedTabs.tabs.length > 0) {
        tabs = savedTabs.tabs.map((t) => ({
          id: t.id,
          label: t.label,
          layout: t.layout,
          focusedSessionId: t.focusedSessionId,
        }));
        activeTabId = savedTabs.activeTabId ?? savedTabs.tabs[0].id;
      }
    },
  };
}

export const terminalStore = createTerminalStore();
