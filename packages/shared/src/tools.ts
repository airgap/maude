export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
  source: 'builtin' | 'mcp';
  mcpServer?: string;
}

export type ToolCategory =
  | 'filesystem' // Read, Write, Edit, Glob, Grep
  | 'execution'  // Bash, start_process
  | 'web'        // WebFetch, WebSearch
  | 'agent'      // Task (sub-agents)
  | 'task'       // TaskCreate, TaskUpdate, TaskList, TaskGet
  | 'planning'   // EnterPlanMode, ExitPlanMode
  | 'notebook'   // NotebookEdit
  | 'mcp'        // MCP-provided tools
  | 'other';

export interface ToolExecution {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'denied';
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  approvalState?: 'pending' | 'approved' | 'denied';
}

export interface PermissionRule {
  id: string;
  type: 'allow' | 'deny' | 'ask';
  tool: string;
  pattern?: string; // e.g., "git push:*"
  scope: 'session' | 'project' | 'global';
}

export type PermissionMode = 'plan' | 'safe' | 'fast' | 'unrestricted';
