import type { CliProvider } from '@maude/shared';

export interface CliSessionOpts {
  content: string;
  resumeSessionId?: string;
  model?: string;
  systemPrompt?: string;
  effort?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpConfigPath?: string;
}

interface CliCommand {
  binary: string;
  args: string[];
}

/**
 * Build the CLI command + args for a given provider.
 *
 * Claude Code:
 *   claude -p <msg> --output-format stream-json --verbose --dangerously-skip-permissions [flags...]
 *
 * Kiro CLI:
 *   kiro-cli chat --no-interactive --output-format stream-json --trust-all-tools [flags...] <msg>
 */
export function buildCliCommand(provider: CliProvider, opts: CliSessionOpts): CliCommand {
  switch (provider) {
    case 'kiro':
      return buildKiroCommand(opts);
    case 'claude':
    default:
      return buildClaudeCommand(opts);
  }
}

function buildClaudeCommand(opts: CliSessionOpts): CliCommand {
  const args = ['--output-format', 'stream-json', '--verbose', '-p', opts.content];

  if (opts.resumeSessionId) args.push('-r', opts.resumeSessionId);
  if (opts.model) args.push('--model', opts.model);
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);

  args.push('--dangerously-skip-permissions');

  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.maxBudgetUsd != null) args.push('--max-budget-usd', String(opts.maxBudgetUsd));
  if (opts.maxTurns != null) args.push('--max-turns', String(opts.maxTurns));
  if (opts.allowedTools?.length) {
    for (const tool of opts.allowedTools) args.push('--allowedTools', tool);
  }
  if (opts.disallowedTools?.length) {
    for (const tool of opts.disallowedTools) args.push('--disallowedTools', tool);
  }
  if (opts.mcpConfigPath) args.push('--mcp-config', opts.mcpConfigPath);

  return { binary: 'claude', args };
}

function buildKiroCommand(opts: CliSessionOpts): CliCommand {
  const args = ['chat', '--no-interactive', '--output-format', 'stream-json', '--trust-all-tools'];

  if (opts.resumeSessionId) args.push('--resume');
  if (opts.allowedTools?.length) args.push('--trust-tools', opts.allowedTools.join(','));

  // Kiro doesn't support these as CLI flags — they're configured via agent configs.
  // We pass them where possible and log warnings for unsupported options.
  if (
    opts.model ||
    opts.systemPrompt ||
    opts.effort ||
    opts.maxTurns != null ||
    opts.maxBudgetUsd != null
  ) {
    console.warn(
      '[kiro] --model, --system-prompt, --effort, --max-turns, --max-budget-usd are not supported as CLI flags in kiro-cli. Configure these via a Kiro agent config instead.',
    );
  }

  // Prompt goes as positional arg at the end
  args.push(opts.content);

  return { binary: 'kiro-cli', args };
}
