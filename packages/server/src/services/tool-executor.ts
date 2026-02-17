/**
 * Tool execution engine for Bedrock and Ollama providers.
 * Executes built-in tools and MCP tools, returning results in a standardized format.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { isMcpTool, executeMcpTool } from './mcp-tool-adapter';

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

/**
 * Execute a tool and return the result
 * Handles both built-in tools and MCP tools
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  try {
    // Check if this is an MCP tool
    if (isMcpTool(toolName)) {
      return await executeMcpTool(toolName, toolInput);
    }

    // Execute built-in tools
    switch (toolName) {
      case 'Read':
        return await executeReadTool(toolInput);
      case 'Write':
        return await executeWriteTool(toolInput);
      case 'Edit':
        return await executeEditTool(toolInput);
      case 'Glob':
        return await executeGlobTool(toolInput, workspacePath);
      case 'Grep':
        return await executeGrepTool(toolInput, workspacePath);
      case 'Bash':
        return await executeBashTool(toolInput, workspacePath);
      case 'WebFetch':
        return await executeWebFetchTool(toolInput);
      case 'WebSearch':
        return await executeWebSearchTool(toolInput);
      case 'NotebookEdit':
        return await executeNotebookEditTool(toolInput);
      default:
        return {
          content: `Unknown tool: ${toolName}`,
          is_error: true,
        };
    }
  } catch (error) {
    return {
      content: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeReadTool(input: Record<string, unknown>): Promise<ToolResult> {
  const filePath = String(input.file_path);
  const offset = input.offset ? Number(input.offset) : undefined;
  const limit = input.limit ? Number(input.limit) : undefined;

  if (!existsSync(filePath)) {
    return {
      content: `File not found: ${filePath}`,
      is_error: true,
    };
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let result: string[];
  if (offset !== undefined || limit !== undefined) {
    const start = offset ? offset - 1 : 0;
    const end = limit ? start + limit : lines.length;
    result = lines.slice(start, end);
  } else {
    result = lines;
  }

  // Add line numbers like cat -n
  const numbered = result.map((line, idx) => {
    const lineNum = (offset || 1) + idx;
    return `${lineNum.toString().padStart(6, ' ')}  ${line}`;
  });

  return {
    content: numbered.join('\n'),
  };
}

async function executeWriteTool(input: Record<string, unknown>): Promise<ToolResult> {
  const filePath = String(input.file_path);
  const content = String(input.content);

  writeFileSync(filePath, content, 'utf-8');

  return {
    content: `Successfully wrote ${content.length} characters to ${filePath}`,
  };
}

async function executeEditTool(input: Record<string, unknown>): Promise<ToolResult> {
  const filePath = String(input.file_path);
  const oldString = String(input.old_string);
  const newString = String(input.new_string);
  const replaceAll = Boolean(input.replace_all);

  if (!existsSync(filePath)) {
    return {
      content: `File not found: ${filePath}`,
      is_error: true,
    };
  }

  const content = readFileSync(filePath, 'utf-8');

  if (!replaceAll) {
    // Check if old_string appears exactly once
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      return {
        content: `String not found in file: ${oldString.substring(0, 100)}`,
        is_error: true,
      };
    }
    if (occurrences > 1) {
      return {
        content: `String appears ${occurrences} times. Use replace_all: true or provide a more specific old_string.`,
        is_error: true,
      };
    }
  }

  const newContent = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);

  writeFileSync(filePath, newContent, 'utf-8');

  const replacements = replaceAll ? content.split(oldString).length - 1 : 1;
  return {
    content: `Successfully replaced ${replacements} occurrence(s) in ${filePath}`,
  };
}

async function executeGlobTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  const pattern = String(input.pattern);
  const searchPath = input.path ? String(input.path) : workspacePath || process.cwd();

  try {
    // Use the Bun.Glob API for pattern matching
    const { Glob } = await import('bun');
    const glob = new Glob(pattern);
    const matches: string[] = [];

    for await (const file of glob.scan({ cwd: searchPath, absolute: true })) {
      matches.push(file);
    }

    if (matches.length === 0) {
      return {
        content: `No files found matching pattern: ${pattern}`,
      };
    }

    return {
      content: matches.join('\n'),
    };
  } catch (error) {
    return {
      content: `Error globbing: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeGrepTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  const pattern = String(input.pattern);
  const searchPath = input.path ? String(input.path) : workspacePath || '.';
  const outputMode = (input.output_mode as string) || 'files_with_matches';
  const globPattern = input.glob ? String(input.glob) : undefined;
  const caseInsensitive = Boolean(input.case_insensitive);
  const context = input.context ? Number(input.context) : undefined;

  try {
    // Build rg command
    const args = [pattern];

    if (caseInsensitive) args.push('-i');
    if (globPattern) args.push('--glob', globPattern);

    if (outputMode === 'files_with_matches') {
      args.push('-l');
    } else if (outputMode === 'count') {
      args.push('-c');
    } else if (outputMode === 'content') {
      args.push('-n');
      if (context) args.push(`-C ${context}`);
    }

    args.push(searchPath);

    const result = execSync(`rg ${args.join(' ')}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return {
      content: result || 'No matches found',
    };
  } catch (error: any) {
    // rg returns exit code 1 when no matches found
    if (error.status === 1) {
      return {
        content: 'No matches found',
      };
    }
    return {
      content: `Error searching: ${error.message}`,
      is_error: true,
    };
  }
}

async function executeBashTool(
  input: Record<string, unknown>,
  workspacePath?: string,
): Promise<ToolResult> {
  const command = String(input.command);
  const timeout = input.timeout ? Number(input.timeout) : 120000;

  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout,
      cwd: workspacePath || process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return {
      content: result || '(command completed with no output)',
    };
  } catch (error: any) {
    return {
      content: `Command failed with exit code ${error.status || 'unknown'}:\n${error.stderr || error.message}`,
      is_error: true,
    };
  }
}

async function executeWebFetchTool(input: Record<string, unknown>): Promise<ToolResult> {
  const url = String(input.url);
  const prompt = String(input.prompt);

  try {
    // This would integrate with the existing WebFetch tool implementation
    // For now, return a placeholder
    return {
      content: `WebFetch tool execution not yet fully integrated. URL: ${url}, Prompt: ${prompt}`,
    };
  } catch (error) {
    return {
      content: `Error fetching URL: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeWebSearchTool(input: Record<string, unknown>): Promise<ToolResult> {
  const query = String(input.query);

  try {
    // This would integrate with the existing WebSearch tool implementation
    // For now, return a placeholder
    return {
      content: `WebSearch tool execution not yet fully integrated. Query: ${query}`,
    };
  } catch (error) {
    return {
      content: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

async function executeNotebookEditTool(input: Record<string, unknown>): Promise<ToolResult> {
  const notebookPath = String(input.notebook_path);
  const newSource = String(input.new_source);
  const editMode = (input.edit_mode as string) || 'replace';

  try {
    if (!existsSync(notebookPath)) {
      return {
        content: `Notebook not found: ${notebookPath}`,
        is_error: true,
      };
    }

    const notebook = JSON.parse(readFileSync(notebookPath, 'utf-8'));

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return {
        content: 'Invalid notebook format: missing cells array',
        is_error: true,
      };
    }

    // For simplicity, edit the first code cell
    // In a full implementation, would use cell_id to find specific cell
    const cellIndex = notebook.cells.findIndex((c: any) => c.cell_type === 'code');

    if (cellIndex === -1) {
      return {
        content: 'No code cells found in notebook',
        is_error: true,
      };
    }

    if (editMode === 'replace') {
      notebook.cells[cellIndex].source = newSource.split('\n');
    } else if (editMode === 'insert') {
      notebook.cells.splice(cellIndex, 0, {
        cell_type: 'code',
        source: newSource.split('\n'),
        metadata: {},
        outputs: [],
        execution_count: null,
      });
    } else if (editMode === 'delete') {
      notebook.cells.splice(cellIndex, 1);
    }

    writeFileSync(notebookPath, JSON.stringify(notebook, null, 2), 'utf-8');

    return {
      content: `Successfully ${editMode}d cell in ${notebookPath}`,
    };
  } catch (error) {
    return {
      content: `Error editing notebook: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}
