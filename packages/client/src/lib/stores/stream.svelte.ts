import type { StreamEvent, MessageContent } from '@maude/shared';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'tool_pending' | 'error' | 'cancelled';

interface PendingApproval {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
}

function createStreamStore() {
  let status = $state<StreamStatus>('idle');
  let sessionId = $state<string | null>(null);
  let partialText = $state('');
  let partialThinking = $state('');
  let contentBlocks = $state<MessageContent[]>([]);
  let currentBlockIndex = $state(-1);
  let currentBlockType = $state<string>('');
  let pendingApprovals = $state<PendingApproval[]>([]);
  let tokenUsage = $state({ input: 0, output: 0 });
  let error = $state<string | null>(null);
  let abortController = $state<AbortController | null>(null);
  let toolResults = $state<Map<string, { result: string; isError: boolean; duration?: number }>>(new Map());
  // Offset for mapping event indices to contentBlocks array positions.
  // Reset to contentBlocks.length on each message_start so sub-agent
  // events with index=0 map to the correct position in the flat array.
  let indexOffset = 0;
  let currentParentId = $state<string | null>(null);

  return {
    get status() { return status; },
    get sessionId() { return sessionId; },
    get partialText() { return partialText; },
    get partialThinking() { return partialThinking; },
    get contentBlocks() { return contentBlocks; },
    get pendingApprovals() { return pendingApprovals; },
    get tokenUsage() { return tokenUsage; },
    get error() { return error; },
    get isStreaming() { return status === 'streaming' || status === 'connecting'; },
    get abortController() { return abortController; },
    get toolResults() { return toolResults; },

    setSessionId(id: string) { sessionId = id; },
    setAbortController(ctrl: AbortController) { abortController = ctrl; },

    startStream() {
      status = 'connecting';
      partialText = '';
      partialThinking = '';
      contentBlocks = [];
      currentBlockIndex = -1;
      error = null;
      toolResults = new Map();
      indexOffset = 0;
      currentParentId = null;
    },

    handleEvent(event: StreamEvent) {
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
            contentBlocks = [...contentBlocks, { type: 'text', text: event.content_block.text ?? '', parentToolUseId: pid }];
          } else if (event.content_block.type === 'thinking') {
            contentBlocks = [...contentBlocks, { type: 'thinking', thinking: event.content_block.thinking ?? '', parentToolUseId: pid }];
          } else if (event.content_block.type === 'tool_use') {
            contentBlocks = [...contentBlocks, {
              type: 'tool_use',
              id: event.content_block.id ?? '',
              name: event.content_block.name ?? '',
              input: {},
              parentToolUseId: pid,
            }];
          }
          break;
        }

        case 'content_block_delta': {
          // Map the event index to the actual position in contentBlocks
          const idx = indexOffset + event.index;
          if (idx < 0 || idx >= contentBlocks.length) break;
          const block = { ...contentBlocks[idx] };

          if (event.delta.type === 'text_delta' && block.type === 'text') {
            block.text += event.delta.text ?? '';
            partialText += event.delta.text ?? '';
          } else if (event.delta.type === 'thinking_delta' && block.type === 'thinking') {
            block.thinking += event.delta.thinking ?? '';
            partialThinking += event.delta.thinking ?? '';
          } else if (event.delta.type === 'input_json_delta' && block.type === 'tool_use') {
            try {
              block.input = JSON.parse(event.delta.partial_json ?? '{}');
            } catch {
              // Partial JSON not yet parseable
            }
          }

          contentBlocks = [...contentBlocks.slice(0, idx), block, ...contentBlocks.slice(idx + 1)];
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
          pendingApprovals = [...pendingApprovals, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
            description: event.description,
          }];
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

          // Remove from pending if it was there
          pendingApprovals = pendingApprovals.filter(a => a.toolCallId !== event.toolCallId);
          if (pendingApprovals.length === 0 && status === 'tool_pending') {
            status = 'streaming';
          }
          break;
        }

        case 'error':
          status = 'error';
          error = event.error.message;
          break;

        case 'ping':
          break;
      }
    },

    resolveApproval(toolCallId: string) {
      pendingApprovals = pendingApprovals.filter(a => a.toolCallId !== toolCallId);
      if (pendingApprovals.length === 0) status = 'streaming';
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
      partialText = '';
      partialThinking = '';
      contentBlocks = [];
      currentBlockIndex = -1;
      pendingApprovals = [];
      toolResults = new Map();
      error = null;
      abortController = null;
      indexOffset = 0;
      currentParentId = null;
    },
  };
}

export const streamStore = createStreamStore();
