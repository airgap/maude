import type { ThemeId, CliProvider, Keybinding, PermissionMode } from '@maude/shared';
import { convertVsCodeSnippets, type ConvertedSnippet } from '$lib/utils/vscode-snippet-converter';
import { convertVsCodeTheme, type ConvertedTheme } from '$lib/utils/vscode-theme-converter';
import { getBaseUrl } from '$lib/api/client';

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
  fontFamilySans: string;
  showThinkingBlocks: boolean;
  showToolDetails: boolean;
  autoScroll: boolean;
  streamingEnabled: boolean;
  compactMessages: boolean;
  showBudgetDisplay: boolean;
  projectPath: string;
  effort: string;
  maxBudgetUsd: number | null;
  maxTurns: number | null;
  sessionBudgetUsd: number | null;
  customSnippets: Record<string, ConvertedSnippet[]>;
  customThemes: Record<
    string,
    { name: string; type: 'dark' | 'light'; cssVars: Record<string, string> }
  >;
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
  fontFamily: 'share-tech-mono',
  fontFamilySans: 'rajdhani',
  showThinkingBlocks: true,
  showToolDetails: true,
  autoScroll: true,
  streamingEnabled: true,
  compactMessages: false,
  showBudgetDisplay: true,
  projectPath: '.',
  effort: 'high',
  maxBudgetUsd: null,
  maxTurns: null,
  sessionBudgetUsd: null,
  customSnippets: {},
  customThemes: {},
};

function loadFromStorage(): SettingsState {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = { ...defaults, ...JSON.parse(raw) };
      // Migrate old CSS-string fontFamily values to font IDs
      if (parsed.fontFamily && parsed.fontFamily.includes("'")) {
        parsed.fontFamily = defaults.fontFamily;
      }
      if (!parsed.fontFamilySans) {
        parsed.fontFamilySans = defaults.fontFamilySans;
      }
      return parsed;
    }
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

    fetch(`${getBaseUrl()}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: serverSettings }),
    }).catch(() => {
      /* best-effort sync */
    });
  }

  function applyTheme(theme: ThemeId) {
    if (typeof document === 'undefined') return;

    // Clear any previously applied custom CSS vars
    const root = document.documentElement;
    for (const key of Array.from(root.style)) {
      if (key.startsWith('--')) root.style.removeProperty(key);
    }

    if (theme.startsWith('custom-') && state.customThemes[theme]) {
      const ct = state.customThemes[theme];
      // Apply the base dark/light theme first for fallback vars
      root.setAttribute('data-theme', ct.type);
      // Then override with custom CSS vars
      for (const [varName, value] of Object.entries(ct.cssVars)) {
        root.style.setProperty(varName, value);
      }
    } else {
      root.setAttribute('data-theme', theme);
    }
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
    get fontFamilySans() {
      return state.fontFamilySans;
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
    get showBudgetDisplay() {
      return state.showBudgetDisplay;
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
    get sessionBudgetUsd() {
      return state.sessionBudgetUsd;
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

    // --- Custom snippets ---
    get customSnippets() {
      return state.customSnippets;
    },
    importSnippets(json: Record<string, any>, language: string) {
      const converted = convertVsCodeSnippets(json);
      const existing = state.customSnippets[language] || [];
      state.customSnippets = {
        ...state.customSnippets,
        [language]: [...existing, ...converted],
      };
      persist();
      return converted.length;
    },
    clearSnippets(language: string) {
      const { [language]: _, ...rest } = state.customSnippets;
      state.customSnippets = rest;
      persist();
    },

    // --- Custom themes ---
    get customThemes() {
      return state.customThemes;
    },
    importTheme(json: Record<string, any>): string {
      const theme = convertVsCodeTheme(json as any);
      state.customThemes = {
        ...state.customThemes,
        [theme.id]: { name: theme.name, type: theme.type, cssVars: theme.cssVars },
      };
      persist();
      return theme.id;
    },
    deleteCustomTheme(id: string) {
      const { [id]: _, ...rest } = state.customThemes;
      state.customThemes = rest;
      // If current theme was deleted, switch to dark
      if (state.theme === id) {
        state.theme = 'dark';
      }
      persist();
    },
  };
}

export const settingsStore = createSettingsStore();
