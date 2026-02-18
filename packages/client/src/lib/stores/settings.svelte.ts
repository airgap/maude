import type {
  ThemeId,
  CliProvider,
  Keybinding,
  PermissionMode,
  TerminalCommandPolicy,
  PermissionRule,
} from '@e/shared';
import { convertVsCodeSnippets, type ConvertedSnippet } from '$lib/utils/vscode-snippet-converter';
import { convertVsCodeTheme, type ConvertedTheme } from '$lib/utils/vscode-theme-converter';
import { findHypertheme, getDefaultHypertheme } from '$lib/config/hyperthemes';
import { getBaseUrl } from '$lib/api/client';

const STORAGE_KEY = 'e-settings';

interface SettingsState {
  theme: ThemeId;
  hypertheme: string;
  cliProvider: CliProvider;
  model: string;
  permissionMode: PermissionMode;
  terminalCommandPolicy: TerminalCommandPolicy;
  permissionRules: PermissionRule[];
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
  autoCompaction: boolean;
  showBudgetDisplay: boolean;
  workspacePath: string;
  effort: string;
  maxBudgetUsd: number | null;
  maxTurns: number | null;
  sessionBudgetUsd: number | null;
  customSnippets: Record<string, ConvertedSnippet[]>;
  customThemes: Record<
    string,
    { name: string; type: 'dark' | 'light'; cssVars: Record<string, string> }
  >;
  streamingIndicator: 'dots' | 'spinner' | 'pulse' | 'none';
  streamingProgressBar: 'rainbow' | 'accent' | 'pulse' | 'neon' | 'cylon' | 'matrix' | 'plasma' | 'comet' | 'helix' | 'glitch' | 'aurora' | 'fire' | 'ocean' | 'electric' | 'candy' | 'vapor' | 'none';
  streamingCursor: 'block' | 'line' | 'underscore' | 'none';
  sendWithEnter: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  soundStyle: 'classic' | 'melodic' | 'whimsy' | 'slot-machine' | 'forest';
  // Desktop notification settings
  notifyOnCompletion: boolean;
  notifyOnFailure: boolean;
  notifyOnApproval: boolean;
  // Startup tips
  showStartupTips: boolean;
}

const defaults: SettingsState = {
  theme: 'dark',
  hypertheme: 'tech',
  cliProvider: 'claude',
  model: 'claude-sonnet-4-5-20250929',
  permissionMode: 'safe',
  terminalCommandPolicy: 'auto',
  permissionRules: [],
  keybindings: [
    { keys: 'Enter', action: 'send', context: 'input', description: 'Send message' },
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
  autoCompaction: true,
  showBudgetDisplay: false,
  workspacePath: '.',
  effort: 'high',
  maxBudgetUsd: null,
  maxTurns: null,
  sessionBudgetUsd: null,
  customSnippets: {},
  customThemes: {},
  streamingIndicator: 'dots',
  streamingProgressBar: 'rainbow',
  streamingCursor: 'block',
  sendWithEnter: true,
  soundEnabled: true,
  soundVolume: 80,
  soundStyle: 'melodic',
  notifyOnCompletion: true,
  notifyOnFailure: true,
  notifyOnApproval: true,
  showStartupTips: true,
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
      // Migrate: ensure hypertheme exists
      if (!parsed.hypertheme) {
        parsed.hypertheme = defaults.hypertheme;
      }
      return parsed;
    }
  } catch {}
  return defaults;
}

function createSettingsStore() {
  let state = $state<SettingsState>(loadFromStorage());

  // Settings the server needs to know about (used for CLI process spawning)
  const SERVER_SYNCED_KEYS: (keyof SettingsState)[] = [
    'cliProvider',
    'autoCompaction',
    'permissionMode',
    'terminalCommandPolicy',
  ];

  function persist() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    applyTheme(state.theme);
    applyHypertheme(state.hypertheme);
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

    // Clear any previously applied custom CSS vars (but preserve --ht-* vars)
    const root = document.documentElement;
    for (const key of Array.from(root.style)) {
      if (key.startsWith('--') && !key.startsWith('--ht-')) root.style.removeProperty(key);
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

  function applyHypertheme(hyperthemeId: string) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const ht = findHypertheme(hyperthemeId) || getDefaultHypertheme();

    // Set data attribute for CSS selectors
    root.setAttribute('data-hypertheme', ht.id);

    // Clear old --ht-* vars and apply new ones
    for (const key of Array.from(root.style)) {
      if (key.startsWith('--ht-')) root.style.removeProperty(key);
    }
    for (const [varName, value] of Object.entries(ht.cssVars)) {
      root.style.setProperty(varName, value);
    }

    // Apply color overrides for magic hyperthemes.
    // applyTheme() runs first in persist() and clears non-ht inline vars,
    // so we can safely layer color overrides on top here.
    if (ht.colorOverrides) {
      for (const [varName, value] of Object.entries(ht.colorOverrides)) {
        root.style.setProperty(varName, value);
      }
    }
  }

  // Apply theme + hypertheme on load
  if (typeof window !== 'undefined') {
    applyTheme(state.theme);
    applyHypertheme(state.hypertheme);
  }

  return {
    get theme() {
      return state.theme;
    },
    get hypertheme() {
      return state.hypertheme;
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
    get terminalCommandPolicy() {
      return state.terminalCommandPolicy;
    },
    get permissionRules() {
      return state.permissionRules;
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
    get autoCompaction() {
      return state.autoCompaction;
    },
    get showBudgetDisplay() {
      return state.showBudgetDisplay;
    },
    get workspacePath() {
      return state.workspacePath;
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
    get streamingIndicator() {
      return state.streamingIndicator;
    },
    get streamingProgressBar() {
      return state.streamingProgressBar;
    },
    get streamingCursor() {
      return state.streamingCursor;
    },
    get sendWithEnter() {
      return state.sendWithEnter;
    },
    get soundEnabled() {
      return state.soundEnabled;
    },
    get soundVolume() {
      return state.soundVolume;
    },
    get soundStyle() {
      return state.soundStyle;
    },
    get notifyOnCompletion() {
      return state.notifyOnCompletion;
    },
    get notifyOnFailure() {
      return state.notifyOnFailure;
    },
    get notifyOnApproval() {
      return state.notifyOnApproval;
    },
    get showStartupTips() {
      return state.showStartupTips;
    },
    get all() {
      return state;
    },

    setTheme(theme: ThemeId) {
      state.theme = theme;
      persist();
    },
    setHypertheme(hyperthemeId: string) {
      state.hypertheme = hyperthemeId;
      persist();
    },
    setModel(model: string) {
      state.model = model;
      persist();
    },
    setPermissionMode(mode: PermissionMode) {
      state.permissionMode = mode;
      persist();
      // Sync to server so it takes effect for the running process immediately.
      // The server reads permissionMode from its settings DB on every tool call.
      syncToServer({ permissionMode: mode });
    },
    setTerminalCommandPolicy(policy: TerminalCommandPolicy) {
      state.terminalCommandPolicy = policy;
      persist();
      syncToServer({ terminalCommandPolicy: policy });
    },
    setPermissionRules(rules: PermissionRule[]) {
      state.permissionRules = rules;
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
