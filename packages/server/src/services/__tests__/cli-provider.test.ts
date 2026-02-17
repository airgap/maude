import { describe, test, expect } from 'bun:test';
import { buildCliCommand } from '../cli-provider';

describe('buildCliCommand - claude', () => {
  test('builds minimal claude command', () => {
    const { binary, args } = buildCliCommand('claude', { content: 'hello' });
    expect(binary).toBe('claude');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  test('includes resume session flag', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', resumeSessionId: 'sess-123' });
    expect(args).toContain('-r');
    expect(args).toContain('sess-123');
  });

  test('includes model flag', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', model: 'claude-opus-4-6' });
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4-6');
  });

  test('includes system prompt', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', systemPrompt: 'be concise' });
    expect(args).toContain('--system-prompt');
    expect(args).toContain('be concise');
  });

  test('includes effort flag', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', effort: 'high' });
    expect(args).toContain('--effort');
    expect(args).toContain('high');
  });

  test('includes max budget', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', maxBudgetUsd: 5.0 });
    expect(args).toContain('--max-budget-usd');
    expect(args).toContain('5');
  });

  test('includes max turns', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', maxTurns: 10 });
    expect(args).toContain('--max-turns');
    expect(args).toContain('10');
  });

  test('includes allowed tools as repeated flags', () => {
    const { args } = buildCliCommand('claude', {
      content: 'hi',
      allowedTools: ['Bash', 'Read'],
    });
    const allowedIndices = args.reduce(
      (acc: number[], arg, i) => (arg === '--allowedTools' ? [...acc, i] : acc),
      [],
    );
    expect(allowedIndices).toHaveLength(2);
    expect(args[allowedIndices[0] + 1]).toBe('Bash');
    expect(args[allowedIndices[1] + 1]).toBe('Read');
  });

  test('includes disallowed tools', () => {
    const { args } = buildCliCommand('claude', {
      content: 'hi',
      disallowedTools: ['Write'],
    });
    expect(args).toContain('--disallowedTools');
    expect(args).toContain('Write');
  });

  test('includes mcp config path', () => {
    const { args } = buildCliCommand('claude', {
      content: 'hi',
      mcpConfigPath: '/tmp/mcp.json',
    });
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/tmp/mcp.json');
  });

  test('omits optional flags when not set', () => {
    const { args } = buildCliCommand('claude', { content: 'test' });
    expect(args).not.toContain('-r');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--max-budget-usd');
    expect(args).not.toContain('--max-turns');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--disallowedTools');
    expect(args).not.toContain('--mcp-config');
  });
});

describe('buildCliCommand - kiro', () => {
  test('builds kiro-cli acp command', () => {
    const { binary, args } = buildCliCommand('kiro', { content: 'hello' });
    expect(binary).toBe('kiro-cli');
    expect(args).toEqual(['acp']);
  });

  test('uses acp mode regardless of options', () => {
    const { args } = buildCliCommand('kiro', {
      content: 'hi',
      resumeSessionId: 'sess-1',
      allowedTools: ['Bash', 'Read'],
      model: 'opus',
      systemPrompt: 'be concise',
    });
    // ACP mode always uses just ['acp'] - options are sent via JSON-RPC
    expect(args).toEqual(['acp']);
  });

  test('does not include chat command flags', () => {
    const { args } = buildCliCommand('kiro', {
      content: 'test',
      model: 'opus',
      systemPrompt: 'be concise',
    });
    expect(args).not.toContain('chat');
    expect(args).not.toContain('--no-interactive');
    expect(args).not.toContain('--output-format');
    expect(args).not.toContain('stream-json');
    expect(args).not.toContain('--trust-all-tools');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('-p');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
});

describe('buildCliCommand - default provider', () => {
  test('unknown provider falls back to claude', () => {
    const { binary } = buildCliCommand('claude', { content: 'test' });
    expect(binary).toBe('claude');
  });
});
