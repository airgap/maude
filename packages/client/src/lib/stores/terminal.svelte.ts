function createTerminalStore() {
  let isOpen = $state(false);
  let panelHeight = $state(250);
  let connected = $state(false);

  return {
    get isOpen() {
      return isOpen;
    },
    get panelHeight() {
      return panelHeight;
    },
    get connected() {
      return connected;
    },

    toggle() {
      isOpen = !isOpen;
    },
    open() {
      isOpen = true;
    },
    close() {
      isOpen = false;
    },
    setConnected(v: boolean) {
      connected = v;
    },
    setPanelHeight(h: number) {
      panelHeight = Math.max(100, Math.min(600, h));
    },

    restoreState(state: { isOpen: boolean; panelHeight: number }) {
      isOpen = state.isOpen;
      panelHeight = state.panelHeight;
    },
  };
}

export const terminalStore = createTerminalStore();
