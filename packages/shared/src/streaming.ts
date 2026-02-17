import type { Task } from './tasks.js';
import type { UserStory, StreamLoopEvent } from './prd.js';

// SSE event types matching Claude's stream-json format
export type StreamEvent =
  | StreamMessageStart
  | StreamContentBlockStart
  | StreamContentBlockDelta
  | StreamContentBlockStop
  | StreamMessageDelta
  | StreamMessageStop
  | StreamToolUseStart
  | StreamToolResult
  | StreamToolApprovalRequest
  | StreamUserQuestionRequest
  | StreamError
  | StreamPing
  | StreamTaskUpdate
  | StreamStoryUpdate
  | StreamAgentEvent
  | StreamVerificationResult
  | StreamLoopEvent;

export interface StreamMessageStart {
  type: 'message_start';
  message: {
    id: string;
    role: 'assistant';
    model: string;
  };
  parent_tool_use_id?: string | null;
}

export interface StreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'thinking' | 'tool_use';
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
  };
  parent_tool_use_id?: string | null;
}

export interface StreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'thinking_delta' | 'input_json_delta';
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  parent_tool_use_id?: string | null;
}

export interface StreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
  parent_tool_use_id?: string | null;
}

export interface StreamMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  };
  usage?: {
    output_tokens: number;
    input_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface StreamMessageStop {
  type: 'message_stop';
}

export interface StreamToolUseStart {
  type: 'tool_use_start';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface StreamToolResult {
  type: 'tool_result';
  toolCallId: string;
  result: string;
  isError: boolean;
  duration?: number;
  toolName?: string;
  filePath?: string;
}

export interface StreamToolApprovalRequest {
  type: 'tool_approval_request';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
}

export interface StreamUserQuestionRequest {
  type: 'user_question_request';
  toolCallId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export interface StreamError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export interface StreamPing {
  type: 'ping';
}

/**
 * @deprecated Use StreamStoryUpdate instead. Tasks have been unified into stories.
 */
export interface StreamTaskUpdate {
  type: 'task_update';
  task: Task;
}

/** Emitted when a story's status or data changes during loop execution or manual updates. */
export interface StreamStoryUpdate {
  type: 'story_update';
  story: UserStory;
}

export interface StreamAgentEvent {
  type: 'agent_event';
  agentId: string;
  event: 'spawned' | 'progress' | 'completed' | 'error';
  data?: unknown;
}

export interface StreamVerificationResult {
  type: 'verification_result';
  filePath: string;
  passed: boolean;
  issues: Array<{
    severity: 'error' | 'warning' | 'info';
    line?: number;
    message: string;
    rule?: string;
  }>;
  tool: string;
  duration: number;
}
