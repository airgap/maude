import type { StreamEvent, MessageContent } from '@e/shared';
import { isMcpFileWriteTool } from '@e/shared';
import { editorStore } from './editor.svelte';

// Context key for Svelte 5 context API - ensures proper reactivity tracking
export const STREAM_CONTEXT_KEY = Symbol('streamStore');

export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'tool_pending'
  | 'error'
  | 'cancelled';

interface PendingApproval {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
}

export interface PendingQuestion {
  toolCallId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export interface StreamSnapshot {
  status: StreamStatus;
  sessionId: string | null;
  conversationId: string | null;
  partialText: string;
  partialThinking: string;
  contentBlocks: MessageContent[];
  pendingApprovals: PendingApproval[];
  pendingQuestions: PendingQuestion[];
  tokenUsage: { input: number; output: number };
  error: string | null;
  abortController: AbortController | null;
  toolResults: Map<string, { result: string; isError: boolean; duration?: number }>;
  indexOffset: number;
  currentParentId: string | null;
}

function createStreamStore() {
  let status = $state<StreamStatus>('idle');
  /** True while reconnectActiveStream() is running — prevents other code from
   *  calling reset() and wiping out state being rebuilt from replayed events. */
  let reconnecting = $state(false);
  let sessionId = $state<string | null>(null);
  let conversationId = $state<string | null>(null);
  let partialText = $state('');
  let partialThinking = $state('');
  let contentBlocks = $state<MessageContent[]>([]);
  let currentBlockIndex = $state(-1);
  let currentBlockType = $state<string>('');
  let pendingApprovals = $state<PendingApproval[]>([]);
  let pendingQuestions = $state<PendingQuestion[]>([]);
  let tokenUsage = $state({ input: 0, output: 0 });
  let error = $state<string | null>(null);
  let abortController = $state<AbortController | null>(null);
  let toolResults = $state<Map<string, { result: string; isError: boolean; duration?: number }>>(
    new Map(),
  );
  let verifications = $state<
    Map<
      string,
      {
        passed: boolean;
        issues: Array<{ severity: string; line?: number; message: string; rule?: string }>;
      }
    >
  >(new Map());
  // Offset for mapping event indices to contentBlocks array positions.
  // Reset to contentBlocks.length on each message_start so sub-agent
  // events with index=0 map to the correct position in the flat array.
  let indexOffset = 0;
  let currentParentId = $state<string | null>(null);

  return {
    get status() {
      return status;
    },
    get sessionId() {
      return sessionId;
    },
    get conversationId() {
      return conversationId;
    },
    get partialText() {
      return partialText;
    },
    get partialThinking() {
      return partialThinking;
    },
    get contentBlocks() {
      return contentBlocks;
    },
    get pendingApprovals() {
      return pendingApprovals;
    },
    get pendingQuestions() {
      return pendingQuestions;
    },
    get tokenUsage() {
      return tokenUsage;
    },
    get error() {
      return error;
    },
    get isStreaming() {
      return status === 'streaming' || status === 'connecting' || reconnecting;
    },
    get isReconnecting() {
      return reconnecting;
    },
    setReconnecting(v: boolean) {
      reconnecting = v;
    },
    get abortController() {
      return abortController;
    },
    get toolResults() {
      return toolResults;
    },
    get verifications() {
      return verifications;
    },

    setSessionId(id: string) {
      sessionId = id;
    },
    setConversationId(id: string) {
      conversationId = id;
    },
    setAbortController(ctrl: AbortController) {
      abortController = ctrl;
    },

    startStream(targetConversationId?: string) {
      status = 'connecting';
      partialText = '';
      partialThinking = '';
      contentBlocks = [];
      currentBlockIndex = -1;
      error = null;
      toolResults = new Map();
      pendingQuestions = [];
      indexOffset = 0;
      currentParentId = null;
      if (targetConversationId) conversationId = targetConversationId;
    },

    handleEvent(event: StreamEvent) {
      // console.log('[streamStore.handleEvent] Processing:', event.type);
      switch (event.type) {
        case 'message_start':
          status = 'streaming';
          // Each message_start begins a new index space. Sub-agent events
          // reuse index 0,1,2... so we offset them into the flat array.
          indexOffset = contentBlocks.length;
          currentParentId = (event as any).parent_tool_use_id || null;
          break;

        case 'content_block_start': {
          currentBlockIndex = event.index;
          currentBlockType = event.content_block.type;
          const pid = (event as any).parent_tool_use_id || currentParentId || undefined;
          if (event.content_block.type === 'text') {
            contentBlocks = [
              ...contentBlocks,
              { type: 'text', text: event.content_block.text ?? '', parentToolUseId: pid },
            ];
            // Text block added
          } else if (event.content_block.type === 'thinking') {
            contentBlocks = [
              ...contentBlocks,
              {
                type: 'thinking',
                thinking: event.content_block.thinking ?? '',
                parentToolUseId: pid,
              },
            ];
            // Thinking block added
          } else if (event.content_block.type === 'tool_use') {
            contentBlocks = [
              ...contentBlocks,
              {
                type: 'tool_use',
                id: event.content_block.id ?? '',
                name: event.content_block.name ?? '',
                input: {},
                parentToolUseId: pid,
              },
            ];
            // Tool use block added
          }
          break;
        }

        case 'content_block_delta': {
          // Map the event index to the actual position in contentBlocks
          const idx = indexOffset + event.index;
          if (idx < 0 || idx >= contentBlocks.length) break;
          const prev = contentBlocks[idx];

          // Build a fully new object — never mutate before reassign,
          // or Svelte 5's reactivity tracking won't detect the change.
          let updated: MessageContent;
          if (event.delta.type === 'text_delta' && prev.type === 'text') {
            updated = { ...prev, text: prev.text + (event.delta.text ?? '') };
            partialText += event.delta.text ?? '';
          } else if (event.delta.type === 'thinking_delta' && prev.type === 'thinking') {
            updated = { ...prev, thinking: prev.thinking + (event.delta.thinking ?? '') };
            partialThinking += event.delta.thinking ?? '';
          } else if (event.delta.type === 'input_json_delta' && prev.type === 'tool_use') {
            try {
              updated = { ...prev, input: JSON.parse(event.delta.partial_json ?? '{}') };
            } catch {
              // Partial JSON not yet parseable
              updated = prev;
            }
          } else {
            updated = prev;
          }

          contentBlocks = [
            ...contentBlocks.slice(0, idx),
            updated,
            ...contentBlocks.slice(idx + 1),
          ];
          break;
        }

        case 'content_block_stop':
          currentBlockIndex = -1;
          currentBlockType = '';
          break;

        case 'message_delta':
          if (event.usage) {
            tokenUsage = {
              input: event.usage.input_tokens,
              output: event.usage.output_tokens,
            };
          }
          break;

        case 'message_stop':
          status = 'idle';
          partialText = '';
          partialThinking = '';
          break;

        case 'tool_approval_request':
          status = 'tool_pending';
          pendingApprovals = [
            ...pendingApprovals,
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              description: event.description,
            },
          ];
          break;

        case 'user_question_request':
          status = 'tool_pending';
          pendingQuestions = [
            ...pendingQuestions,
            {
              toolCallId: event.toolCallId,
              questions: event.questions,
            },
          ];
          break;

        case 'tool_result': {
          // Track the result
          const newResults = new Map(toolResults);
          newResults.set(event.toolCallId, {
            result: event.result,
            isError: event.isError,
            duration: event.duration,
          });
          toolResults = newResults;

          // Refresh editor tabs when file-writing tools complete
          // Supports both built-in tools and MCP tools (e.g. desktop-commander)
          if (!event.isError && event.toolName) {
            const builtinFileWriteTools = [
              'write_file',
              'edit_file',
              'create_file',
              'str_replace_editor',
              'Write',
              'Edit',
            ];
            const isFileWrite =
              builtinFileWriteTools.includes(event.toolName) || isMcpFileWriteTool(event.toolName);
            if (isFileWrite && event.filePath) {
              editorStore.refreshFile(event.filePath);
            }
          }

          // Remove from pending approvals or questions if it was there
          pendingApprovals = pendingApprovals.filter((a) => a.toolCallId !== event.toolCallId);
          pendingQuestions = pendingQuestions.filter((q) => q.toolCallId !== event.toolCallId);
          if (
            pendingApprovals.length === 0 &&
            pendingQuestions.length === 0 &&
            status === 'tool_pending'
          ) {
            status = 'streaming';
          }
          break;
        }

        case 'error':
          status = 'error';
          error = event.error.message;
          break;

        case 'verification_result': {
          const newVerifications = new Map(verifications);
          newVerifications.set(event.filePath, {
            passed: event.passed,
            issues: event.issues,
          });
          verifications = newVerifications;
          break;
        }

        case 'ping':
          break;
      }
    },

    resolveApproval(toolCallId: string) {
      pendingApprovals = pendingApprovals.filter((a) => a.toolCallId !== toolCallId);
      if (pendingApprovals.length === 0 && pendingQuestions.length === 0) status = 'streaming';
    },

    resolveQuestion(toolCallId: string) {
      pendingQuestions = pendingQuestions.filter((q) => q.toolCallId !== toolCallId);
      if (pendingQuestions.length === 0 && pendingApprovals.length === 0) status = 'streaming';
    },

    cancel() {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      status = 'cancelled';
      partialText = '';
      partialThinking = '';
    },

    reset() {
      status = 'idle';
      sessionId = null;
      conversationId = null;
      partialText = '';
      partialThinking = '';
      contentBlocks = [];
      currentBlockIndex = -1;
      pendingApprovals = [];
      pendingQuestions = [];
      toolResults = new Map();
      verifications = new Map();
      error = null;
      abortController = null;
      indexOffset = 0;
      currentParentId = null;
    },

    captureState(): StreamSnapshot {
      return {
        status,
        sessionId,
        conversationId,
        partialText,
        partialThinking,
        contentBlocks: [...contentBlocks],
        pendingApprovals: [...pendingApprovals],
        pendingQuestions: [...pendingQuestions],
        tokenUsage: { ...tokenUsage },
        error,
        abortController,
        toolResults: new Map(toolResults),
        indexOffset,
        currentParentId,
      };
    },

    restoreState(snapshot: StreamSnapshot | null) {
      if (!snapshot) {
        this.reset();
        return;
      }
      status = snapshot.status;
      sessionId = snapshot.sessionId;
      conversationId = snapshot.conversationId;
      partialText = snapshot.partialText;
      partialThinking = snapshot.partialThinking;
      contentBlocks = snapshot.contentBlocks;
      currentBlockIndex = -1;
      currentBlockType = '';
      pendingApprovals = snapshot.pendingApprovals;
      pendingQuestions = snapshot.pendingQuestions;
      tokenUsage = snapshot.tokenUsage;
      error = snapshot.error;
      abortController = snapshot.abortController;
      toolResults = snapshot.toolResults;
      indexOffset = snapshot.indexOffset;
      currentParentId = snapshot.currentParentId;
    },
  };
}

export const streamStore = createStreamStore();
