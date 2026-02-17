import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getDb } from '../../db/database';
import {
  getMcpServers,
  isMcpTool,
  mcpToolsToSchemas,
  clearMcpToolCache,
  type MCPServerConfig,
  type MCPToolInfo,
} from '../mcp-tool-adapter';

describe('MCP Tool Adapter', () => {
  let db: any;

  beforeEach(() => {
    db = getDb();
    // Clean up any existing MCP servers
    db.query('DELETE FROM mcp_servers').run();
  });

  afterEach(() => {
    clearMcpToolCache();
  });

  describe('getMcpServers', () => {
    it('should return empty array when no servers configured', () => {
      const servers = getMcpServers();
      expect(servers).toEqual([]);
    });

    it('should return configured MCP servers', () => {
      // Insert test server
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command, args, env)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        'test-filesystem',
        'stdio',
        'echo',
        JSON.stringify(['test']),
        JSON.stringify({ TEST_ENV: 'value' }),
      );

      const servers = getMcpServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        name: 'test-filesystem',
        transport: 'stdio',
        command: 'echo',
        args: ['test'],
        env: { TEST_ENV: 'value' },
      });
    });

    it('should handle multiple servers', () => {
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command)
        VALUES ('filesystem', 'stdio', 'npx')
      `,
      ).run();

      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command)
        VALUES ('database', 'stdio', 'npx')
      `,
      ).run();

      const servers = getMcpServers();
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.name)).toContain('filesystem');
      expect(servers.map((s) => s.name)).toContain('database');
    });
  });

  describe('isMcpTool', () => {
    it('should return true for MCP tool names', () => {
      expect(isMcpTool('mcp__filesystem__read_file')).toBe(true);
      expect(isMcpTool('mcp__database__query')).toBe(true);
      expect(isMcpTool('mcp__github__create_issue')).toBe(true);
    });

    it('should return false for built-in tool names', () => {
      expect(isMcpTool('Read')).toBe(false);
      expect(isMcpTool('Write')).toBe(false);
      expect(isMcpTool('Bash')).toBe(false);
    });

    it('should return false for invalid names', () => {
      expect(isMcpTool('')).toBe(false);
      expect(isMcpTool('mcp_invalid')).toBe(false);
      expect(isMcpTool('custom_tool')).toBe(false);
    });
  });

  describe('mcpToolsToSchemas', () => {
    it('should convert MCP tools to Anthropic schema format', () => {
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'filesystem',
          toolName: 'read_file',
          fullName: 'mcp__filesystem__read_file',
          description: 'Read a file from the filesystem',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
          isDangerous: false,
        },
        {
          serverName: 'database',
          toolName: 'execute_query',
          fullName: 'mcp__database__execute_query',
          description: 'Execute SQL query',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'SQL query' },
            },
            required: ['query'],
          },
          isDangerous: true,
        },
      ];

      const schemas = mcpToolsToSchemas(mcpTools);

      expect(schemas).toHaveLength(2);

      expect(schemas[0]).toMatchObject({
        name: 'mcp__filesystem__read_file',
        description: 'Read a file from the filesystem',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      });

      expect(schemas[1]).toMatchObject({
        name: 'mcp__database__execute_query',
        description: 'Execute SQL query',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'SQL query' },
          },
          required: ['query'],
        },
      });
    });

    it('should provide default schema when inputSchema is missing', () => {
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'test',
          toolName: 'simple_tool',
          fullName: 'mcp__test__simple_tool',
          description: 'A simple tool',
          inputSchema: undefined as any,
          isDangerous: false,
        },
      ];

      const schemas = mcpToolsToSchemas(mcpTools);

      expect(schemas[0].input_schema).toEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    });

    it('should use fallback description when description is missing', () => {
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'test',
          toolName: 'unnamed_tool',
          fullName: 'mcp__test__unnamed_tool',
          description: '',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
      ];

      const schemas = mcpToolsToSchemas(mcpTools);

      expect(schemas[0].description).toBe('unnamed_tool from test');
    });
  });

  describe('clearMcpToolCache', () => {
    it('should clear the tool cache', () => {
      // This is a simple test to ensure the function doesn't throw
      expect(() => clearMcpToolCache()).not.toThrow();
    });
  });

  describe('Tool naming format', () => {
    it('should follow mcp__server__tool convention', () => {
      const toolInfo: MCPToolInfo = {
        serverName: 'my-server',
        toolName: 'my_tool',
        fullName: 'mcp__my-server__my_tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
        isDangerous: false,
      };

      expect(toolInfo.fullName).toMatch(/^mcp__[^_]+__.+$/);
      expect(isMcpTool(toolInfo.fullName)).toBe(true);
    });
  });

  describe('Integration with tool-schemas', () => {
    it('should integrate with getFilteredTools pattern', async () => {
      // This tests that MCP tools can be filtered like built-in tools
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'test',
          toolName: 'tool1',
          fullName: 'mcp__test__tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
        {
          serverName: 'test',
          toolName: 'tool2',
          fullName: 'mcp__test__tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: true,
        },
      ];

      let schemas = mcpToolsToSchemas(mcpTools);

      // Test allowed tools filter
      const allowedTools = ['mcp__test__tool1'];
      schemas = schemas.filter((s) => allowedTools.includes(s.name));
      expect(schemas).toHaveLength(1);
      expect(schemas[0].name).toBe('mcp__test__tool1');

      // Test disallowed tools filter
      schemas = mcpToolsToSchemas(mcpTools);
      const disallowedTools = ['mcp__test__tool2'];
      schemas = schemas.filter((s) => !disallowedTools.includes(s.name));
      expect(schemas).toHaveLength(1);
      expect(schemas[0].name).toBe('mcp__test__tool1');
    });
  });

  describe('Server configuration validation', () => {
    it('should handle servers with minimal config', () => {
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command)
        VALUES (?, ?, ?)
      `,
      ).run('minimal-server', 'stdio', 'echo');

      const servers = getMcpServers();
      expect(servers[0]).toMatchObject({
        name: 'minimal-server',
        transport: 'stdio',
        command: 'echo',
        args: undefined,
        env: undefined,
      });
    });

    it('should handle servers with full config', () => {
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command, args, env, url)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        'full-server',
        'stdio',
        'npx',
        JSON.stringify(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']),
        JSON.stringify({ NODE_ENV: 'production', DEBUG: 'mcp:*' }),
        null,
      );

      const servers = getMcpServers();
      expect(servers[0]).toMatchObject({
        name: 'full-server',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { NODE_ENV: 'production', DEBUG: 'mcp:*' },
      });
    });
  });
});
