import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock fs to prevent actual file writes
let writtenPath = '';
let writtenContent = '';
mock.module('fs', () => ({
  writeFileSync: (path: string, content: string) => {
    writtenPath = path;
    writtenContent = content;
  },
  mkdirSync: () => {},
}));

import { generateMcpConfig } from '../mcp-config';

function clearServers() {
  testDb.exec('DELETE FROM mcp_servers');
}

function insertServer(overrides: Record<string, any> = {}) {
  const defaults = {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: JSON.stringify(['server.js']),
    url: null,
    env: JSON.stringify({}),
    scope: 'project',
    status: 'disconnected',
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      'INSERT INTO mcp_servers (name, transport, command, args, url, env, scope, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(row.name, row.transport, row.command, row.args, row.url, row.env, row.scope, row.status);
}

describe('generateMcpConfig', () => {
  beforeEach(() => {
    clearServers();
    writtenPath = '';
    writtenContent = '';
  });

  test('returns null when no servers exist', () => {
    const result = generateMcpConfig();
    expect(result).toBeNull();
  });

  test('generates config for stdio server', () => {
    insertServer({
      name: 'my-server',
      transport: 'stdio',
      command: 'node',
      args: JSON.stringify(['index.js', '--flag']),
    });

    const result = generateMcpConfig();
    expect(result).toBeTruthy();

    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['my-server']).toBeDefined();
    expect(config.mcpServers['my-server'].command).toBe('node');
    expect(config.mcpServers['my-server'].args).toEqual(['index.js', '--flag']);
  });

  test('generates config for SSE server', () => {
    insertServer({
      name: 'sse-server',
      transport: 'sse',
      command: null,
      args: null,
      url: 'http://localhost:8080/sse',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['sse-server'].url).toBe('http://localhost:8080/sse');
    expect(config.mcpServers['sse-server'].type).toBe('sse');
  });

  test('generates config for HTTP server', () => {
    insertServer({
      name: 'http-server',
      transport: 'http',
      command: null,
      args: null,
      url: 'http://localhost:9090/api',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['http-server'].url).toBe('http://localhost:9090/api');
    expect(config.mcpServers['http-server'].type).toBe('http');
  });

  test('includes env vars', () => {
    insertServer({
      name: 'env-server',
      env: JSON.stringify({ API_KEY: 'secret', DEBUG: 'true' }),
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['env-server'].env).toEqual({ API_KEY: 'secret', DEBUG: 'true' });
  });

  test('handles invalid JSON in args gracefully', () => {
    insertServer({
      name: 'bad-args',
      args: 'not json',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['bad-args'].args).toEqual([]);
  });

  test('handles invalid JSON in env gracefully', () => {
    insertServer({
      name: 'bad-env',
      env: '{bad json}',
    });

    // Should not throw
    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    // env should be undefined since JSON.parse failed
    expect(config.mcpServers['bad-env'].env).toBeUndefined();
  });

  test('generates config for multiple servers', () => {
    insertServer({ name: 'server-a', transport: 'stdio', command: 'python' });
    insertServer({
      name: 'server-b',
      transport: 'sse',
      command: null,
      url: 'http://localhost:3000',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(Object.keys(config.mcpServers)).toHaveLength(2);
    expect(config.mcpServers['server-a']).toBeDefined();
    expect(config.mcpServers['server-b']).toBeDefined();
  });

  test('returns config file path', () => {
    insertServer({ name: 'test' });
    const result = generateMcpConfig();
    expect(result).toContain('.e');
    expect(result).toContain('mcp-config.json');
  });

  test('writes formatted JSON', () => {
    insertServer({ name: 'test' });
    generateMcpConfig();
    // Check that content is formatted (has newlines from JSON.stringify indent)
    expect(writtenContent).toContain('\n');
  });
});
