/**
 * Tool schema definitions compatible with Anthropic/Bedrock format.
 * Maps built-in tools to standardized tool definitions.
 * Integrates with MCP servers for dynamic tool discovery.
 */

import { getCachedMcpTools, mcpToolsToSchemas, isMcpTool } from './mcp-tool-adapter';
import { isMcpToolDangerous } from '@e/shared';

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
        items?: { type: string };
      }
    >;
    required?: string[];
  };
}

/**
 * Get all available tool definitions for Bedrock/Anthropic format
 */
export function getToolDefinitions(): ToolSchema[] {
  return [
    // Filesystem tools
    {
      name: 'Read',
      description:
        'Read the contents of a file from the filesystem. Returns the full text content of the specified file. Use offset and limit parameters to read specific portions of large files.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to read',
          },
          offset: {
            type: 'integer',
            description:
              'Optional line number to start reading from (1-indexed). Use this to read specific sections of large files.',
          },
          limit: {
            type: 'integer',
            description:
              'Optional maximum number of lines to read. Use with offset to paginate through large files.',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'Write',
      description:
        'Create a new file or completely overwrite an existing file with the provided content. This is a DESTRUCTIVE operation - use Edit for modifying existing files. Requires user approval.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path where the file should be written',
          },
          content: {
            type: 'string',
            description: 'The complete content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
    {
      name: 'Edit',
      description:
        'Edit an existing file by replacing exact string matches. Performs surgical string replacements in files. The old_string must match exactly (including whitespace and indentation). Requires user approval.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to edit',
          },
          old_string: {
            type: 'string',
            description:
              'The exact string to replace. Must match precisely including all whitespace.',
          },
          new_string: {
            type: 'string',
            description: 'The replacement string',
          },
          replace_all: {
            type: 'boolean',
            description:
              'If true, replace all occurrences. If false (default), only replace if the match is unique.',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'Glob',
      description:
        'Find files matching a glob pattern. Returns a list of file paths sorted by modification time. Useful for discovering files in a project.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files against (e.g., "**/*.ts", "src/**/*.js")',
          },
          path: {
            type: 'string',
            description: 'Optional directory to search in. Defaults to current working directory.',
          },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'Grep',
      description:
        'Search for text patterns in files using regex. Built on ripgrep for fast searching. Returns matching lines or file paths.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regular expression pattern to search for',
          },
          path: {
            type: 'string',
            description: 'File or directory to search in. Defaults to current working directory.',
          },
          output_mode: {
            type: 'string',
            description:
              'Output mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows match counts',
            enum: ['content', 'files_with_matches', 'count'],
          },
          glob: {
            type: 'string',
            description: 'Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}")',
          },
          case_insensitive: {
            type: 'boolean',
            description: 'If true, perform case-insensitive search',
          },
          context: {
            type: 'integer',
            description: 'Number of lines to show before and after each match',
          },
        },
        required: ['pattern'],
      },
    },

    // Execution tools
    {
      name: 'Bash',
      description:
        'Execute a shell command in the workspace directory. DANGEROUS - can modify files, install packages, or run arbitrary code. Requires user approval. Use for git operations, npm/package management, running tests, etc.',
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          timeout: {
            type: 'integer',
            description: 'Optional timeout in milliseconds (max 600000ms / 10 minutes)',
          },
          description: {
            type: 'string',
            description: 'Brief description of what this command does',
          },
        },
        required: ['command'],
      },
    },

    // Web tools
    {
      name: 'WebFetch',
      description:
        'Fetch content from a URL and process it with AI. Converts HTML to markdown and extracts relevant information based on a prompt.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from (must be a valid HTTP/HTTPS URL)',
          },
          prompt: {
            type: 'string',
            description: 'What information to extract from the page',
          },
        },
        required: ['url', 'prompt'],
      },
    },
    {
      name: 'WebSearch',
      description:
        'Search the web using a search engine and return relevant results. Useful for finding current information, documentation, or answering questions that require up-to-date knowledge.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          allowed_domains: {
            type: 'array',
            description: 'Optional list of domains to restrict search results to',
            items: { type: 'string' },
          },
          blocked_domains: {
            type: 'array',
            description: 'Optional list of domains to exclude from search results',
            items: { type: 'string' },
          },
        },
        required: ['query'],
      },
    },

    // Notebook tools
    {
      name: 'NotebookEdit',
      description:
        'Edit a Jupyter notebook cell. Can replace, insert, or delete cells. Requires user approval for modifications.',
      input_schema: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Absolute path to the Jupyter notebook file (.ipynb)',
          },
          new_source: {
            type: 'string',
            description: 'The new source code for the cell',
          },
          cell_id: {
            type: 'string',
            description: 'The ID of the cell to edit',
          },
          cell_type: {
            type: 'string',
            description: 'The type of cell (code or markdown)',
            enum: ['code', 'markdown'],
          },
          edit_mode: {
            type: 'string',
            description: 'The type of edit: replace, insert, or delete',
            enum: ['replace', 'insert', 'delete'],
          },
        },
        required: ['notebook_path', 'new_source'],
      },
    },
  ];
}

/**
 * Check if a tool requires user approval before execution.
 * This is the simple/legacy check used when no permission rules are provided.
 */
export function requiresApproval(toolName: string): boolean {
  // Check if it's an MCP tool
  if (isMcpTool(toolName)) {
    return isMcpToolDangerous(toolName);
  }

  // Built-in dangerous tools
  const dangerousTools = ['Write', 'Edit', 'Bash', 'NotebookEdit'];
  return dangerousTools.includes(toolName);
}

/**
 * Enhanced approval check that evaluates per-tool permission rules.
 * Returns 'allow' | 'deny' | 'ask' based on rules + permission mode + terminal policy.
 */
export {
  shouldRequireApproval,
  loadPermissionRules,
  loadTerminalCommandPolicy,
  extractToolInputForMatching,
} from './permission-rules';

/**
 * Get tools filtered by allowed/disallowed lists
 */
export function getFilteredTools(
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolSchema[] {
  let tools = getToolDefinitions();

  if (allowedTools && allowedTools.length > 0) {
    tools = tools.filter((t) => allowedTools.includes(t.name));
  }

  if (disallowedTools && disallowedTools.length > 0) {
    tools = tools.filter((t) => !disallowedTools.includes(t.name));
  }

  return tools;
}

/**
 * Get all tools including MCP tools from configured servers
 * Combines built-in tools with dynamically discovered MCP tools
 */
export async function getAllToolsWithMcp(
  allowedTools?: string[],
  disallowedTools?: string[],
): Promise<ToolSchema[]> {
  // Get built-in tools
  let tools = getToolDefinitions();

  // Get MCP tools
  try {
    const mcpTools = await getCachedMcpTools();
    const mcpSchemas = mcpToolsToSchemas(mcpTools);
    tools = [...tools, ...mcpSchemas];
  } catch (error) {
    console.warn('[tool-schemas] Failed to discover MCP tools:', error);
    // Continue with built-in tools only
  }

  // Apply filters
  if (allowedTools && allowedTools.length > 0) {
    tools = tools.filter((t) => allowedTools.includes(t.name));
  }

  if (disallowedTools && disallowedTools.length > 0) {
    tools = tools.filter((t) => !disallowedTools.includes(t.name));
  }

  return tools;
}

/**
 * Convert tool definitions to Ollama function calling format
 */
export function toOllamaFunctions(tools: ToolSchema[]) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}
