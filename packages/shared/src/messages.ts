export type MessageRole = 'user' | 'assistant' | 'system';

export interface TextContent {
  type: 'text';
  text: string;
  parentToolUseId?: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  parentToolUseId?: string;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  parentToolUseId?: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type: string; // e.g., 'image/png', 'image/jpeg'
    data?: string; // base64-encoded image data
    url?: string; // image URL
  };
}

export type MessageContent =
  | TextContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent
  | ImageContent;

export interface Message {
  id: string;
  role: MessageRole;
  content: MessageContent[];
  timestamp: number;
  model?: string;
  tokenCount?: number;
  // For tool calls, track approval state
  toolApprovals?: Record<string, ToolApprovalState>;
}

export type ToolApprovalState = 'pending' | 'approved' | 'denied';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  model: string;
  systemPrompt?: string;
  workspacePath?: string;
  workspaceId?: string;
  totalTokens: number;
  maxContextTokens: number;
  // Plan mode
  planMode: boolean;
  planFile?: string;
  // Memory
  memoryFiles: string[];
  // CLI parity settings
  permissionMode?: string;
  effort?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  cliSessionId?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
  workspacePath?: string;
  workspaceId?: string;
}
