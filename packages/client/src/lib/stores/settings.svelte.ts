import type { ThemeId, CliProvider, Keybinding, PermissionMode } from '@maude/shared';

const STORAGE_KEY = 'maude-settings';

interface SettingsState {
  theme: ThemeId;
  cliProvider: CliProvider;
  model: string;
  permissionMode: PermissionMode;
  keybindings: Keybinding[];
  autoMemoryEnabled: boolean;
  fontSize: number;
  fontFamily: string;
  showThinkingBlocks: boolean;
  showToolDetails: boolean;
  autoScroll: boolean;
  streamingEnabled: boolean;
  compactMessages: boolean;
  projectPath: string;
  effort: string;
  maxBudgetUsd: number | null;
  maxTurns: number | null;
}

const defaults: SettingsState = {
  theme: 'dark',
  cliProvider: 'claude',
  model: 'claude-sonnet-4-5-20250929',
  permissionMode: 'safe',
  keybindings: [
    { keys: 'Ctrl+Enter', action: 'send', context: 'input', description: 'Send message' },
    {
      keys: 'Shift+Tab Shift+Tab',
      action: 'togglePlanMode',
      context: 'global',
      description: 'Toggle plan mode',
    },
    { keys: 'Escape', action: 'cancel', context: 'global', description: 'Cancel/close' },
    { keys: 'Ctrl+k', action: 'commandPalette', context: 'global', description: 'Command palette' },
    { keys: 'Ctrl+/', action: 'toggleSidebar', context: 'global', description: 'Toggle sidebar' },
  ],
  autoMemoryEnabled: true,
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  showThinkingBlocks: true,
  showToolDetails: true,
  autoScroll: true,
  streamingEnabled: true,
  compactMessages: false,
  projectPath: '.',
  effort: 'high',
  maxBudgetUsd: null,
  maxTurns: null,
};

function loadFromStorage(): SettingsState {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

function createSettingsStore() {
  let state = $state<SettingsState>(loadFromStorage());

  // Settings the server needs to know about (used for CLI process spawning)
  const SERVER_SYNCED_KEYS: (keyof SettingsState)[] = ['cliProvider'];

  function persist() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    applyTheme(state.theme);
  }

  function syncToServer(partial: Partial<SettingsState>) {
    const serverSettings: Record<string, unknown> = {};
    for (const key of SERVER_SYNCED_KEYS) {
      if (key in partial) serverSettings[key] = partial[key];
    }
    if (Object.keys(serverSettings).length === 0) return;

    const BASE_URL =
      typeof window !== 'undefined' && (window as any).__TAURI__
        ? 'http://localhost:3002/api'
        : '/api';
    fetch(`${BASE_URL}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: serverSettings }),
    }).catch(() => {
      /* best-effort sync */
    });
  }

  function applyTheme(theme: ThemeId) {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Apply theme on load
  if (typeof window !== 'undefined') {
    applyTheme(state.theme);
  }

  return {
    get theme() {
      return state.theme;
    },
    get cliProvider() {
      return state.cliProvider;
    },
    get model() {
      return state.model;
    },
    get permissionMode() {
      return state.permissionMode;
    },
    get keybindings() {
      return state.keybindings;
    },
    get autoMemoryEnabled() {
      return state.autoMemoryEnabled;
    },
    get fontSize() {
      return state.fontSize;
    },
    get fontFamily() {
      return state.fontFamily;
    },
    get showThinkingBlocks() {
      return state.showThinkingBlocks;
    },
    get showToolDetails() {
      return state.showToolDetails;
    },
    get autoScroll() {
      return state.autoScroll;
    },
    get streamingEnabled() {
      return state.streamingEnabled;
    },
    get compactMessages() {
      return state.compactMessages;
    },
    get projectPath() {
      return state.projectPath;
    },
    get effort() {
      return state.effort;
    },
    get maxBudgetUsd() {
      return state.maxBudgetUsd;
    },
    get maxTurns() {
      return state.maxTurns;
    },
    get all() {
      return state;
    },

    setTheme(theme: ThemeId) {
      state.theme = theme;
      persist();
    },
    setModel(model: string) {
      state.model = model;
      persist();
    },
    setPermissionMode(mode: PermissionMode) {
      state.permissionMode = mode;
      persist();
    },
    update(partial: Partial<SettingsState>) {
      state = { ...state, ...partial };
      persist();
      syncToServer(partial);
    },
    setKeybinding(action: string, keys: string) {
      const idx = state.keybindings.findIndex((k) => k.action === action);
      if (idx >= 0) state.keybindings[idx].keys = keys;
      persist();
    },
  };
}

export const settingsStore = createSettingsStore();
