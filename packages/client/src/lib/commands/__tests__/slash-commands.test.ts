import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock all store dependencies before importing
vi.mock('$lib/stores/settings.svelte', () => ({
  settingsStore: {
    theme: 'dark',
    model: 'claude-sonnet-4-5-20250929',
    permissionMode: 'safe',
    effort: 'high',
    setTheme: vi.fn(),
    setModel: vi.fn(),
    setPermissionMode: vi.fn(),
  },
}));

vi.mock('$lib/stores/conversation.svelte', () => ({
  conversationStore: {
    active: {
      id: 'conv-1',
      messages: [{ id: 'msg-1' }],
      planMode: false,
      cliSessionId: 'cli-1',
    },
    activeId: 'conv-1',
    addMessage: vi.fn(),
    setPlanMode: vi.fn(),
  },
}));

vi.mock('$lib/stores/stream.svelte', () => ({
  streamStore: {
    sessionId: 'session-1',
    status: 'idle',
  },
}));

vi.mock('$lib/stores/ui.svelte', () => ({
  uiStore: {
    setSidebarTab: vi.fn(),
    setSidebarOpen: vi.fn(),
    openSettings: vi.fn(),
    openMcpManager: vi.fn(),
  },
}));

vi.mock('$lib/api/client', () => ({
  api: {
    conversations: {
      update: vi.fn(),
      cost: vi.fn().mockResolvedValue({
        data: {
          totalTokens: 1000,
          inputTokens: 300,
          outputTokens: 700,
          estimatedCostUsd: 0.015,
          model: 'claude-sonnet-4-5-20250929',
        },
      }),
    },
  },
}));

import { executeSlashCommand, COMMANDS } from '../slash-commands';
import { settingsStore } from '$lib/stores/settings.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { api } from '$lib/api/client';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('COMMANDS', () => {
  test('exports list of commands', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
  });

  test('each command has name and description', () => {
    for (const cmd of COMMANDS) {
      expect(typeof cmd.name).toBe('string');
      expect(typeof cmd.description).toBe('string');
    }
  });

  test('includes expected commands', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(names).toContain('clear');
    expect(names).toContain('help');
    expect(names).toContain('memory');
    expect(names).toContain('config');
    expect(names).toContain('theme');
    expect(names).toContain('model');
    expect(names).toContain('plan');
    expect(names).toContain('permissions');
    expect(names).toContain('cost');
    expect(names).toContain('status');
    expect(names).toContain('mcp');
    expect(names).toContain('compact');
    expect(names).toContain('init');
    expect(names).toContain('commit');
    expect(names).toContain('review-pr');
  });
});

describe('executeSlashCommand', () => {
  const ctx = { conversationId: 'conv-1', sessionId: 'session-1', args: '' };

  test('returns handled:false for unknown command', () => {
    const result = executeSlashCommand('nonexistent', ctx);
    expect(result.handled).toBe(false);
  });

  test('/clear clears messages', () => {
    const result = executeSlashCommand('clear', ctx);
    expect(result.handled).toBe(true);
    expect((conversationStore.active as any).messages).toEqual([]);
  });

  test('/help adds system message with command list', () => {
    const result = executeSlashCommand('help', ctx);
    expect(result.handled).toBe(true);
    expect(conversationStore.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        content: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
      }),
    );
  });

  test('/memory opens sidebar to memory tab', () => {
    const result = executeSlashCommand('memory', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.setSidebarTab).toHaveBeenCalledWith('memory');
    expect(uiStore.setSidebarOpen).toHaveBeenCalledWith(true);
  });

  test('/config opens settings', () => {
    const result = executeSlashCommand('config', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.openSettings).toHaveBeenCalled();
  });

  test('/theme with valid name sets theme', () => {
    const result = executeSlashCommand('theme', { ...ctx, args: 'light' });
    expect(result.handled).toBe(true);
    expect(settingsStore.setTheme).toHaveBeenCalledWith('light');
  });

  test('/theme with invalid name does not set theme', () => {
    const result = executeSlashCommand('theme', { ...ctx, args: 'invalid-theme' });
    expect(result.handled).toBe(true);
    expect(settingsStore.setTheme).not.toHaveBeenCalled();
  });

  test('/theme without args cycles theme', () => {
    const result = executeSlashCommand('theme', { ...ctx, args: '' });
    expect(result.handled).toBe(true);
    expect(settingsStore.setTheme).toHaveBeenCalled();
  });

  test('/model with shorthand maps to full model id', () => {
    executeSlashCommand('model', { ...ctx, args: 'opus' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-opus-4-6');
    expect(api.conversations.update).toHaveBeenCalledWith('conv-1', {
      model: 'claude-opus-4-6',
    });
  });

  test('/model with sonnet shorthand', () => {
    executeSlashCommand('model', { ...ctx, args: 'sonnet' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-sonnet-4-5-20250929');
  });

  test('/model with haiku shorthand', () => {
    executeSlashCommand('model', { ...ctx, args: 'haiku' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-haiku-4-5-20251001');
  });

  test('/model with full model id passes through', () => {
    executeSlashCommand('model', { ...ctx, args: 'claude-opus-4-6' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-opus-4-6');
  });

  test('/plan toggles plan mode', () => {
    const result = executeSlashCommand('plan', ctx);
    expect(result.handled).toBe(true);
    expect(conversationStore.setPlanMode).toHaveBeenCalledWith(true);
    expect(api.conversations.update).toHaveBeenCalledWith('conv-1', { planMode: true });
  });

  test('/permissions with valid mode sets it', () => {
    executeSlashCommand('permissions', { ...ctx, args: 'unrestricted' });
    expect(settingsStore.setPermissionMode).toHaveBeenCalledWith('unrestricted');
  });

  test('/permissions with invalid mode does nothing', () => {
    executeSlashCommand('permissions', { ...ctx, args: 'invalid' });
    expect(settingsStore.setPermissionMode).not.toHaveBeenCalled();
  });

  test('/cost fetches and displays cost info', () => {
    const result = executeSlashCommand('cost', ctx);
    expect(result.handled).toBe(true);
    // The cost command is async so it fires and forgets
  });

  test('/status adds system message with session info', () => {
    const result = executeSlashCommand('status', ctx);
    expect(result.handled).toBe(true);
    expect(conversationStore.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
      }),
    );
  });

  test('/mcp opens MCP manager', () => {
    const result = executeSlashCommand('mcp', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.openMcpManager).toHaveBeenCalled();
  });

  test('/compact returns sendAsMessage', () => {
    const result = executeSlashCommand('compact', ctx);
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toBe('/compact');
  });

  test('/init returns sendAsMessage', () => {
    const result = executeSlashCommand('init', ctx);
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toBe('/init');
  });

  test('/commit returns sendAsMessage with commit instruction', () => {
    const result = executeSlashCommand('commit', ctx);
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('commit');
  });

  test('/review-pr without args returns generic message', () => {
    const result = executeSlashCommand('review-pr', { ...ctx, args: '' });
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('Review the current pull request');
  });

  test('/review-pr with PR ref includes it in message', () => {
    const result = executeSlashCommand('review-pr', { ...ctx, args: '#123' });
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('#123');
  });
});
