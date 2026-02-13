/**
 * Registry of known language servers and their CLI commands.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface LspServerEntry {
  language: string;
  command: string;
  args: string[];
  available: boolean;
  installable: boolean;
  npmPackage?: string;
  systemInstallHint?: string;
}

interface LspRegistryEntry {
  command: string;
  args: string[];
  npmPackage?: string;
  systemInstallHint?: string;
}

const REGISTRY: Record<string, LspRegistryEntry> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    npmPackage: 'typescript-language-server typescript',
  },
  javascript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    npmPackage: 'typescript-language-server typescript',
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    npmPackage: 'pyright',
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    systemInstallHint: 'rustup component add rust-analyzer',
  },
  go: {
    command: 'gopls',
    args: ['serve'],
    systemInstallHint: 'go install golang.org/x/tools/gopls@latest',
  },
  css: {
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    npmPackage: 'vscode-langservers-extracted',
  },
  html: {
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    npmPackage: 'vscode-langservers-extracted',
  },
  json: {
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    npmPackage: 'vscode-langservers-extracted',
  },
  svelte: {
    command: 'svelteserver',
    args: ['--stdio'],
    npmPackage: 'svelte-language-server',
  },
  shell: {
    command: 'bash-language-server',
    args: ['start'],
    npmPackage: 'bash-language-server',
  },
  yaml: {
    command: 'yaml-language-server',
    args: ['--stdio'],
    npmPackage: 'yaml-language-server',
  },
};

/** Base directory for managed LSP installs */
const LSP_DIR = join(homedir(), '.maude', 'lsp');

/**
 * Look up the LSP command for a given language.
 * Resolves from ~/.maude/lsp/node_modules/.bin/ first, then system PATH.
 */
export function getLspCommand(language: string): { command: string; args: string[] } | null {
  const entry = REGISTRY[language];
  if (!entry) return null;

  // Try managed install first
  const managedBin = join(LSP_DIR, 'node_modules', '.bin', entry.command);
  if (existsSync(managedBin)) {
    return { command: managedBin, args: entry.args };
  }

  // Fall back to system PATH
  if (Bun.which(entry.command)) {
    return { command: entry.command, args: entry.args };
  }

  return null;
}

/**
 * Get install metadata for a language.
 */
export function getInstallInfo(language: string): LspRegistryEntry | null {
  return REGISTRY[language] ?? null;
}

/**
 * Check which language servers are available on the system.
 */
export async function getAvailableServers(): Promise<LspServerEntry[]> {
  const results: LspServerEntry[] = [];
  const seen = new Set<string>();

  for (const [language, entry] of Object.entries(REGISTRY)) {
    // Deduplicate availability check by command
    const key = entry.command;
    let available: boolean;
    if (seen.has(key)) {
      available = results.find((r) => r.command === key)?.available ?? false;
    } else {
      // Check managed install first, then system PATH
      const managedBin = join(LSP_DIR, 'node_modules', '.bin', entry.command);
      available = existsSync(managedBin) || Bun.which(entry.command) !== null;
    }
    seen.add(key);

    results.push({
      language,
      command: entry.command,
      args: entry.args,
      available,
      installable: !!entry.npmPackage,
      npmPackage: entry.npmPackage,
      systemInstallHint: entry.systemInstallHint,
    });
  }

  return results;
}
