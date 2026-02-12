import { getDb } from '../db/database';
import { join } from 'path';
import { homedir } from 'os';
import { writeFileSync, mkdirSync } from 'fs';

const MCP_CONFIG_PATH = join(homedir(), '.maude', 'mcp-config.json');

/**
 * Reads MCP servers from the database and generates a config file
 * in the format expected by Claude CLI's --mcp-config flag.
 *
 * CLI expects:
 * {
 *   "mcpServers": {
 *     "server-name": {
 *       "command": "...",
 *       "args": [...],
 *       "env": {...}
 *     }
 *   }
 * }
 */
export function generateMcpConfig(): string | null {
  const db = getDb();
  const servers = db.query('SELECT * FROM mcp_servers').all() as any[];

  if (servers.length === 0) return null;

  const mcpServers: Record<string, any> = {};

  for (const server of servers) {
    const config: any = {};

    if (server.transport === 'stdio') {
      if (server.command) config.command = server.command;
      if (server.args) {
        try {
          config.args = JSON.parse(server.args);
        } catch {
          config.args = [];
        }
      }
    } else if (server.transport === 'sse' || server.transport === 'http') {
      if (server.url) config.url = server.url;
      config.type = server.transport;
    }

    if (server.env) {
      try {
        config.env = JSON.parse(server.env);
      } catch {}
    }

    mcpServers[server.name] = config;
  }

  const configContent = JSON.stringify({ mcpServers }, null, 2);

  // Ensure directory exists and write config
  mkdirSync(join(homedir(), '.maude'), { recursive: true });
  writeFileSync(MCP_CONFIG_PATH, configContent, 'utf-8');

  return MCP_CONFIG_PATH;
}
