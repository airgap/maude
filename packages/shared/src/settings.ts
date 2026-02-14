import type { PermissionMode, PermissionRule } from './tools.js';
import type { MCPServerConfig } from './mcp.js';

export type ThemeId =
  | 'dark'
  | 'light'
  | 'dark-colorblind'
  | 'light-colorblind'
  | 'dark-ansi'
  | 'light-ansi'
  | 'monokai'
  | 'dracula'
  | 'nord'
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'solarized-dark'
  | 'solarized-light'
  | 'catppuccin-mocha'
  | 'catppuccin-latte'
  | 'tokyo-night'
  | 'rose-pine'
  | 'rose-pine-dawn'
  | 'synthwave'
  | 'github-dark'
  | 'github-light'
  | 'one-dark'
  | 'everforest'
  | (string & {});

export type CliProvider = 'claude' | 'kiro' | 'ollama';

export interface Settings {
  theme: ThemeId;
  cliProvider: CliProvider;
  model: string;
  permissionMode: PermissionMode;
  permissionRules: PermissionRule[];
  keybindings: Keybinding[];
  mcpServers: MCPServerConfig[];
  autoMemoryEnabled: boolean;
  projectPath: string;
  maxBudgetUsd?: number;
  // Appearance
  fontSize: number;
  fontFamily: string;
  showThinkingBlocks: boolean;
  showToolDetails: boolean;
  // Behavior
  autoScroll: boolean;
  streamingEnabled: boolean;
  compactMessages: boolean;
}

export interface Keybinding {
  keys: string;
  action: string;
  context: 'global' | 'input' | 'chat';
  description?: string;
}

// API key is stored server-side only, never sent to client
export interface ServerOnlySettings {
  anthropicApiKey: string;
  projectPaths: string[];
  sessionPersistence: boolean;
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  cliProvider: 'claude',
  model: 'claude-sonnet-4-5-20250929',
  permissionMode: 'safe',
  permissionRules: [],
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
    { keys: 'Ctrl+l', action: 'clearChat', context: 'global', description: 'Clear chat display' },
    {
      keys: 'Ctrl+Shift+p',
      action: 'commandPalette',
      context: 'global',
      description: 'Command palette (alt)',
    },
  ],
  mcpServers: [],
  autoMemoryEnabled: true,
  projectPath: '.',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  showThinkingBlocks: true,
  showToolDetails: true,
  autoScroll: true,
  streamingEnabled: true,
  compactMessages: false,
};
