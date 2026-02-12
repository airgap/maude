import { settingsStore } from '$lib/stores/settings.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { streamStore } from '$lib/stores/stream.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { api } from '$lib/api/client';

export interface SlashCommandContext {
  conversationId: string | null;
  sessionId: string | null;
  args: string;
}

export interface SlashCommandResult {
  handled: boolean;
  sendAsMessage?: string;
}

interface SlashCommand {
  name: string;
  description: string;
  execute: (ctx: SlashCommandContext) => SlashCommandResult | Promise<SlashCommandResult>;
}

const commands: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Clear chat display',
    execute: () => {
      if (conversationStore.active) {
        conversationStore.active.messages = [];
      }
      return { handled: true };
    },
  },
  {
    name: 'help',
    description: 'Show help information',
    execute: () => {
      const helpText = COMMANDS.map((c) => `/${c.name} — ${c.description}`).join('\n');
      if (conversationStore.active) {
        conversationStore.addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: [{ type: 'text', text: `Available commands:\n${helpText}` }],
          timestamp: Date.now(),
        });
      }
      return { handled: true };
    },
  },
  {
    name: 'memory',
    description: 'View and edit memory files',
    execute: () => {
      uiStore.setSidebarTab('memory');
      uiStore.setSidebarOpen(true);
      return { handled: true };
    },
  },
  {
    name: 'config',
    description: 'Open settings',
    execute: () => {
      uiStore.openSettings();
      return { handled: true };
    },
  },
  {
    name: 'theme',
    description: 'Switch theme',
    execute: (ctx) => {
      const name = ctx.args.trim();
      if (name) {
        const validThemes = [
          'dark',
          'light',
          'dark-colorblind',
          'light-colorblind',
          'dark-ansi',
          'light-ansi',
        ];
        if (validThemes.includes(name)) {
          settingsStore.setTheme(name as any);
        }
      } else {
        // Cycle through themes
        const themes = [
          'dark',
          'light',
          'dark-colorblind',
          'light-colorblind',
          'dark-ansi',
          'light-ansi',
        ] as const;
        const idx = themes.indexOf(settingsStore.theme);
        settingsStore.setTheme(themes[(idx + 1) % themes.length]);
      }
      return { handled: true };
    },
  },
  {
    name: 'model',
    description: 'Switch model',
    execute: (ctx) => {
      const modelArg = ctx.args.trim().toLowerCase();
      const modelMap: Record<string, string> = {
        opus: 'claude-opus-4-6',
        sonnet: 'claude-sonnet-4-5-20250929',
        haiku: 'claude-haiku-4-5-20251001',
      };
      const modelId = modelMap[modelArg] || modelArg;
      if (modelId) {
        settingsStore.setModel(modelId);
        if (conversationStore.activeId) {
          api.conversations.update(conversationStore.activeId, { model: modelId });
        }
      }
      return { handled: true };
    },
  },
  {
    name: 'plan',
    description: 'Toggle plan mode',
    execute: () => {
      if (conversationStore.active) {
        const newMode = !conversationStore.active.planMode;
        conversationStore.setPlanMode(newMode);
        if (conversationStore.activeId) {
          api.conversations.update(conversationStore.activeId, { planMode: newMode });
        }
      }
      return { handled: true };
    },
  },
  {
    name: 'permissions',
    description: 'Change permission mode',
    execute: (ctx) => {
      const mode = ctx.args.trim().toLowerCase();
      const validModes = ['plan', 'safe', 'fast', 'unrestricted'];
      if (validModes.includes(mode)) {
        settingsStore.setPermissionMode(mode as any);
      }
      return { handled: true };
    },
  },
  {
    name: 'cost',
    description: 'Show token/cost information',
    execute: async (ctx) => {
      if (ctx.conversationId) {
        try {
          const res = await api.conversations.cost(ctx.conversationId);
          const d = res.data;
          const msg = `Token usage: ${d.totalTokens.toLocaleString()} total (${d.inputTokens.toLocaleString()} in / ${d.outputTokens.toLocaleString()} out)\nEstimated cost: $${d.estimatedCostUsd.toFixed(4)}\nModel: ${d.model}`;
          conversationStore.addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: [{ type: 'text', text: msg }],
            timestamp: Date.now(),
          });
        } catch {
          // Failed to fetch cost
        }
      }
      return { handled: true };
    },
  },
  {
    name: 'status',
    description: 'Show session info',
    execute: () => {
      const parts = [
        `Session: ${streamStore.sessionId || 'none'}`,
        `Status: ${streamStore.status}`,
        `Model: ${settingsStore.model}`,
        `Permission: ${settingsStore.permissionMode}`,
        `Effort: ${settingsStore.effort}`,
      ];
      if (conversationStore.active) {
        parts.push(`Conversation: ${conversationStore.active.id}`);
        parts.push(`Messages: ${conversationStore.active.messages.length}`);
        if (conversationStore.active.cliSessionId) {
          parts.push(`CLI Session: ${conversationStore.active.cliSessionId}`);
        }
      }
      conversationStore.addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: [{ type: 'text', text: parts.join('\n') }],
        timestamp: Date.now(),
      });
      return { handled: true };
    },
  },
  {
    name: 'mcp',
    description: 'Manage MCP servers',
    execute: () => {
      uiStore.openMcpManager();
      return { handled: true };
    },
  },
  {
    name: 'compact',
    description: 'Compress conversation history',
    execute: (ctx) => {
      // Send as a message to the Claude CLI which handles /compact natively
      return { handled: true, sendAsMessage: '/compact' };
    },
  },
  {
    name: 'init',
    description: 'Initialize project with CLAUDE.md',
    execute: () => {
      return { handled: true, sendAsMessage: '/init' };
    },
  },
  {
    name: 'commit',
    description: 'Create a git commit from changes',
    execute: () => {
      return {
        handled: true,
        sendAsMessage:
          'Create a git commit for the current changes. Review the diff, write a good commit message, and commit.',
      };
    },
  },
  {
    name: 'review-pr',
    description: 'Review a pull request',
    execute: (ctx) => {
      const prRef = ctx.args.trim();
      const msg = prRef
        ? `Review pull request ${prRef}. Check for bugs, security issues, and code quality.`
        : 'Review the current pull request. Check for bugs, security issues, and code quality.';
      return { handled: true, sendAsMessage: msg };
    },
  },
];

// Export for use in SlashCommandMenu
export const COMMANDS = commands.map((c) => ({ name: c.name, description: c.description }));

export function executeSlashCommand(name: string, ctx: SlashCommandContext): SlashCommandResult {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) return { handled: false };

  const result = cmd.execute(ctx);
  // Handle async commands
  if (result instanceof Promise) {
    result.catch(console.error);
    return { handled: true };
  }
  return result;
}
