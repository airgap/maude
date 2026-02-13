export type SidebarTab = 'conversations' | 'files' | 'search' | 'tasks' | 'memory' | 'agents' | 'symbols';
type ModalId =
  | 'settings'
  | 'command-palette'
  | 'mcp-manager'
  | 'keybindings'
  | 'quick-open'
  | 'project-setup'
  | null;
type FocusedPane = 'chat' | 'editor';

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
      const id = crypto.randomUUID();
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
