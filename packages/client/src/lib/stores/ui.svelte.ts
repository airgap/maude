import { uuid } from '$lib/utils/uuid';

export type SidebarTab =
  | 'conversations'
  | 'files'
  | 'search'
  | 'tasks'
  | 'memory'
  | 'agents'
  | 'symbols'
  | 'mcp'
  | 'loop';
type ModalId =
  | 'settings'
  | 'command-palette'
  | 'mcp-manager'
  | 'keybindings'
  | 'quick-open'
  | 'project-setup'
  | 'snapshots'
  | 'loop-config'
  | 'story-generate'
  | 'story-refine'
  | 'criteria-validation'
  | 'story-estimate'
  | 'sprint-plan'
  | 'prd-completeness'
  | 'template-library'
  | 'priority-recommendation'
  | 'effort-value-matrix'
  | null;
type FocusedPane = 'chat' | 'editor';

/** Callback for sidebar layout integration (avoids circular import) */
let _onSidebarTabChange: ((tab: SidebarTab) => void) | null = null;
export function onSidebarTabChange(cb: (tab: SidebarTab) => void) {
  _onSidebarTabChange = cb;
}

function createUIStore() {
  let sidebarOpen = $state(true);
  let sidebarTab = $state<SidebarTab>('conversations');
  let sidebarWidth = $state(280);
  let activeModal = $state<ModalId>(null);
  let toasts = $state<
    Array<{
      id: string;
      message: string;
      type: 'info' | 'success' | 'error' | 'warning';
      timeout?: number;
    }>
  >([]);
  let commandPaletteQuery = $state('');
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);
  let focusedPane = $state<FocusedPane>('chat');

  return {
    get sidebarOpen() {
      return sidebarOpen;
    },
    get sidebarTab() {
      return sidebarTab;
    },
    get sidebarWidth() {
      return sidebarWidth;
    },
    get activeModal() {
      return activeModal;
    },
    get toasts() {
      return toasts;
    },
    get commandPaletteQuery() {
      return commandPaletteQuery;
    },
    get focusedPane() {
      return focusedPane;
    },

    toggleSidebar() {
      sidebarOpen = !sidebarOpen;
    },
    setSidebarOpen(v: boolean) {
      sidebarOpen = v;
    },
    setSidebarTab(tab: SidebarTab) {
      sidebarTab = tab;
      sidebarOpen = true;
      // Notify the layout store to focus the tab wherever it lives.
      // Uses a callback to avoid circular import (sidebarLayout imports SidebarTab type from here).
      _onSidebarTabChange?.(tab);
    },
    setSidebarWidth(w: number) {
      sidebarWidth = Math.max(200, Math.min(500, w));
    },

    openModal(id: ModalId) {
      activeModal = id;
    },
    closeModal() {
      activeModal = null;
    },
    openSettings() {
      activeModal = 'settings';
    },
    openMcpManager() {
      activeModal = 'mcp-manager';
    },

    toast(
      message: string,
      type: 'info' | 'success' | 'error' | 'warning' = 'info',
      timeout = 4000,
    ) {
      const id = uuid();
      toasts = [...toasts, { id, message, type, timeout }];
      if (timeout > 0) {
        setTimeout(() => {
          toasts = toasts.filter((t) => t.id !== id);
        }, timeout);
      }
      return id;
    },

    dismissToast(id: string) {
      toasts = toasts.filter((t) => t.id !== id);
    },

    setCommandPaletteQuery(q: string) {
      commandPaletteQuery = q;
    },

    setFocusedPane(pane: FocusedPane) {
      focusedPane = pane;
    },

    restoreState(state: { sidebarTab: SidebarTab; sidebarOpen: boolean }) {
      sidebarTab = state.sidebarTab;
      sidebarOpen = state.sidebarOpen;
    },
  };
}

export const uiStore = createUIStore();
