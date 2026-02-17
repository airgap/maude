import type { CliProvider } from '@e/shared';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
 * Resolve the full path to a CLI binary, checking common install locations.
 * Falls back to bare name (relies on PATH) if not found at known locations.
 */
function resolveBinary(name: string): string {
  const home = homedir();
  const candidates = [
    join(home, '.local', 'bin', name),
    join(home, '.claude', 'local', 'bin', name),
    join(home, '.npm-global', 'bin', name),
    join('/usr', 'local', 'bin', name),
    join('/usr', 'bin', name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return name; // fall back to PATH lookup
}

/**
 * Build the CLI command + args for a given provider.
 *
 * Claude Code:
 *   claude -p <msg> --output-format stream-json --verbose --dangerously-skip-permissions [flags...]
 *
 * Kiro CLI (ACP mode for JSON-RPC output):
 *   kiro-cli acp
 *   Communicates via JSON-RPC 2.0 over stdin/stdout for reliable structured output.
 *
 * Bedrock & Ollama:
 *   No CLI — handled via direct API calls in bedrock-provider.ts and ollama-provider.ts
 */
export function buildCliCommand(provider: CliProvider, opts: CliSessionOpts): CliCommand {
  switch (provider) {
    case 'kiro':
      return buildKiroCommand(opts);
    case 'bedrock':
    case 'ollama':
      // Bedrock and Ollama use direct API calls, not CLI processes
      throw new Error(`${provider} provider does not use CLI commands — use API streaming instead`);
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

  return { binary: resolveBinary('claude'), args };
}

function buildKiroCommand(opts: CliSessionOpts): CliCommand {
  // Use ACP (Agent Client Protocol) mode for JSON-RPC communication.
  // ACP provides reliable, structured JSON-RPC 2.0 output over stdin/stdout.
  const args = ['acp'];

  // TODO: The caller (claude-process.ts) needs to implement ACP protocol initialization:
  // 1. After spawning, send initialize request:
  //    {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}
  //    Response will include: promptCapabilities.image: true (multimodal support!)
  // 2. Then send session/new or session/prompt with the actual prompt:
  //    {"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"prompt": [text and image blocks]}}
  // 3. Handle JSON-RPC responses and notifications (AgentMessageChunk, ToolCall, TurnEnd)
  //
  // Note: Kiro CLI supports images via ACP! Can send base64-encoded images in prompt blocks.
  // See docs/kiro-cli-images.md for details on multimodal support.
  //
  // For now, we warn about unsupported options until full ACP integration is implemented.

  if (
    opts.model ||
    opts.systemPrompt ||
    opts.effort ||
    opts.maxTurns != null ||
    opts.maxBudgetUsd != null ||
    opts.allowedTools?.length ||
    opts.resumeSessionId
  ) {
    console.warn(
      '[kiro-acp] Options like --model, --system-prompt, --effort, --max-turns, --max-budget-usd, --allowed-tools, and --resume need to be sent via JSON-RPC protocol or configured in Kiro agent config. Full ACP integration pending.',
    );
  }

  return { binary: resolveBinary('kiro-cli'), args };
}
