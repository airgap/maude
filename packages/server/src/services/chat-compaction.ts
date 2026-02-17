/**
 * Chat compaction service for managing conversation history length
 *
 * Strategies:
 * 1. Token-based compaction - Keep recent messages, summarize old ones
 * 2. Sliding window - Keep last N messages with full content
 * 3. Smart retention - Always keep system messages, important context
 * 4. Provider-specific limits - Different providers have different context windows
 */

import { getDb } from '../db/database';
import type { Message } from '@e/shared';

export interface CompactionOptions {
  /** Maximum number of tokens to retain (default: 100000) */
  maxTokens?: number;
  /** Maximum number of messages to keep uncompressed (default: 20) */
  maxMessages?: number;
  /** Strategy: 'sliding-window' | 'token-based' | 'smart' (default: 'smart') */
  strategy?: 'sliding-window' | 'token-based' | 'smart';
  /** Whether to preserve tool use messages (default: true) */
  preserveToolUse?: boolean;
  /** Whether to create summary message (default: true) */
  createSummary?: boolean;
}

export interface CompactedHistory {
  messages: any[];
  summary?: string;
  compacted: boolean;
  originalCount: number;
  compactedCount: number;
  tokensRemoved: number;
}

/**
 * Provider context window limits (in tokens)
 */
const CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4': 200000,
  'claude-sonnet-3.5': 200000,
  'claude-sonnet-4': 200000,
  'claude-haiku-3': 200000,
  'ollama:llama3.1': 128000,
  'ollama:llama3.2': 128000,
  'ollama:qwen2.5': 32000,
  'ollama:mistral': 32000,
  default: 100000,
};

/**
 * Estimate token count for a message (rough approximation)
 * Real implementation should use tiktoken or similar
 */
function estimateTokens(content: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(content.length / 4);
}

/**
 * Get context window limit for a model
 */
export function getContextLimit(model: string): number {
  // Check exact match
  if (CONTEXT_LIMITS[model]) {
    return CONTEXT_LIMITS[model];
  }

  // Check prefixed models
  for (const [key, limit] of Object.entries(CONTEXT_LIMITS)) {
    if (model.includes(key)) {
      return limit;
    }
  }

  return CONTEXT_LIMITS.default;
}

/**
 * Calculate total tokens in message array
 */
function calculateTotalTokens(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          total += estimateTokens(block.text);
        } else if (block.type === 'tool_result' && block.content) {
          total += estimateTokens(
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          );
        }
      }
    } else if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    }
  }
  return total;
}

/**
 * Check if a message is important and should be preserved
 */
function isImportantMessage(msg: any): boolean {
  // Preserve system messages
  if (msg.role === 'system') return true;

  // Preserve messages with tool use
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'tool_use' || block.type === 'tool_result') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Create a summary message from a range of messages
 */
function createSummaryMessage(messages: any[]): any {
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  let toolUsageCount = 0;

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          if (msg.role === 'user') {
            userMessages.push(block.text);
          } else if (msg.role === 'assistant') {
            assistantMessages.push(block.text);
          }
        } else if (block.type === 'tool_use') {
          toolUsageCount++;
        }
      }
    }
  }

  const summaryParts = [];

  if (userMessages.length > 0) {
    summaryParts.push(`User discussed: ${userMessages.slice(0, 3).join('; ')}`);
    if (userMessages.length > 3) {
      summaryParts.push(`(and ${userMessages.length - 3} more topics)`);
    }
  }

  if (assistantMessages.length > 0) {
    summaryParts.push(`Assistant provided: ${assistantMessages.slice(0, 2).join('; ')}`);
    if (assistantMessages.length > 2) {
      summaryParts.push(`(and ${assistantMessages.length - 2} more responses)`);
    }
  }

  if (toolUsageCount > 0) {
    summaryParts.push(`${toolUsageCount} tool operations were performed`);
  }

  const summaryText = summaryParts.join('. ') + '.';

  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `[Previous conversation summary: ${summaryText}]`,
      },
    ],
  };
}

/**
 * Compact messages using sliding window strategy
 * Keeps the last N messages, discards older ones
 */
function compactSlidingWindow(
  messages: any[],
  maxMessages: number,
  createSummary: boolean,
): CompactedHistory {
  if (messages.length <= maxMessages) {
    return {
      messages,
      compacted: false,
      originalCount: messages.length,
      compactedCount: messages.length,
      tokensRemoved: 0,
    };
  }

  const keptMessages = messages.slice(-maxMessages);
  const removedMessages = messages.slice(0, -maxMessages);
  const tokensRemoved = calculateTotalTokens(removedMessages);

  let finalMessages = keptMessages;
  let summary: string | undefined;

  if (createSummary && removedMessages.length > 0) {
    const summaryMsg = createSummaryMessage(removedMessages);
    summary = summaryMsg.content[0].text;
    finalMessages = [summaryMsg, ...keptMessages];
  }

  return {
    messages: finalMessages,
    summary,
    compacted: true,
    originalCount: messages.length,
    compactedCount: finalMessages.length,
    tokensRemoved,
  };
}

/**
 * Compact messages based on token limit
 * Keeps recent messages until token limit is reached
 */
function compactTokenBased(
  messages: any[],
  maxTokens: number,
  createSummary: boolean,
): CompactedHistory {
  const totalTokens = calculateTotalTokens(messages);

  if (totalTokens <= maxTokens) {
    return {
      messages,
      compacted: false,
      originalCount: messages.length,
      compactedCount: messages.length,
      tokensRemoved: 0,
    };
  }

  // Work backwards from most recent messages
  const keptMessages: any[] = [];
  let currentTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = calculateTotalTokens([msg]);

    if (currentTokens + msgTokens <= maxTokens) {
      keptMessages.unshift(msg);
      currentTokens += msgTokens;
    } else {
      break;
    }
  }

  const removedMessages = messages.slice(0, messages.length - keptMessages.length);
  const tokensRemoved = calculateTotalTokens(removedMessages);

  let finalMessages = keptMessages;
  let summary: string | undefined;

  if (createSummary && removedMessages.length > 0) {
    const summaryMsg = createSummaryMessage(removedMessages);
    const summaryTokens = calculateTotalTokens([summaryMsg]);

    // Make room for summary if needed
    while (currentTokens + summaryTokens > maxTokens && finalMessages.length > 1) {
      const removed = finalMessages.shift()!;
      currentTokens -= calculateTotalTokens([removed]);
    }

    summary = summaryMsg.content[0].text;
    finalMessages = [summaryMsg, ...finalMessages];
  }

  return {
    messages: finalMessages,
    summary,
    compacted: true,
    originalCount: messages.length,
    compactedCount: finalMessages.length,
    tokensRemoved,
  };
}

/**
 * Smart compaction - preserves important messages, compacts the rest
 */
function compactSmart(
  messages: any[],
  maxTokens: number,
  preserveToolUse: boolean,
  createSummary: boolean,
): CompactedHistory {
  const totalTokens = calculateTotalTokens(messages);

  if (totalTokens <= maxTokens) {
    return {
      messages,
      compacted: false,
      originalCount: messages.length,
      compactedCount: messages.length,
      tokensRemoved: 0,
    };
  }

  // Separate important and regular messages
  const importantMessages: any[] = [];
  const regularMessages: any[] = [];

  for (const msg of messages) {
    if (isImportantMessage(msg) && preserveToolUse) {
      importantMessages.push(msg);
    } else {
      regularMessages.push(msg);
    }
  }

  // Always keep important messages
  const importantTokens = calculateTotalTokens(importantMessages);
  const remainingTokens = maxTokens - importantTokens;

  // Fill remaining space with recent regular messages
  const keptRegular: any[] = [];
  let currentTokens = 0;

  for (let i = regularMessages.length - 1; i >= 0; i--) {
    const msg = regularMessages[i];
    const msgTokens = calculateTotalTokens([msg]);

    if (currentTokens + msgTokens <= remainingTokens) {
      keptRegular.unshift(msg);
      currentTokens += msgTokens;
    } else {
      break;
    }
  }

  // Merge important and kept regular messages in chronological order
  const allKept = [...importantMessages, ...keptRegular].sort((a, b) => {
    // Maintain original order
    const aIdx = messages.indexOf(a);
    const bIdx = messages.indexOf(b);
    return aIdx - bIdx;
  });

  const removedCount = messages.length - allKept.length;
  const removedMessages = messages.filter((m) => !allKept.includes(m));
  const tokensRemoved = calculateTotalTokens(removedMessages);

  let finalMessages = allKept;
  let summary: string | undefined;

  if (createSummary && removedMessages.length > 0) {
    const summaryMsg = createSummaryMessage(removedMessages);
    summary = summaryMsg.content[0].text;
    finalMessages = [summaryMsg, ...allKept];
  }

  return {
    messages: finalMessages,
    summary,
    compacted: removedCount > 0,
    originalCount: messages.length,
    compactedCount: finalMessages.length,
    tokensRemoved,
  };
}

/**
 * Compact conversation history based on specified strategy
 */
export function compactMessages(
  messages: any[],
  options: CompactionOptions = {},
): CompactedHistory {
  const {
    maxTokens = 100000,
    maxMessages = 20,
    strategy = 'smart',
    preserveToolUse = true,
    createSummary = true,
  } = options;

  if (messages.length === 0) {
    return {
      messages: [],
      compacted: false,
      originalCount: 0,
      compactedCount: 0,
      tokensRemoved: 0,
    };
  }

  switch (strategy) {
    case 'sliding-window':
      return compactSlidingWindow(messages, maxMessages, createSummary);
    case 'token-based':
      return compactTokenBased(messages, maxTokens, createSummary);
    case 'smart':
      return compactSmart(messages, maxTokens, preserveToolUse, createSummary);
    default:
      throw new Error(`Unknown compaction strategy: ${strategy}`);
  }
}

/**
 * Load conversation history from DB with optional compaction
 */
export function loadConversationHistory(
  conversationId: string,
  options: CompactionOptions = {},
): CompactedHistory {
  const db = getDb();
  const rows = db
    .query('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as any[];

  const messages: any[] = [];

  for (const row of rows) {
    try {
      const content = JSON.parse(row.content);
      messages.push({
        role: row.role,
        content,
      });
    } catch (e) {
      console.warn(`[chat-compaction] Failed to parse message: ${e}`);
    }
  }

  return compactMessages(messages, options);
}

/**
 * Get recommended compaction options for a model
 */
export function getRecommendedOptions(model: string): CompactionOptions {
  const contextLimit = getContextLimit(model);

  // Reserve 25% for system prompt and current request
  const maxTokens = Math.floor(contextLimit * 0.75);

  return {
    maxTokens,
    strategy: 'smart',
    preserveToolUse: true,
    createSummary: true,
  };
}

/**
 * Check if conversation needs compaction
 */
export function needsCompaction(conversationId: string, model: string): boolean {
  const recommended = getRecommendedOptions(model);
  const history = loadConversationHistory(conversationId, { ...recommended, createSummary: false });
  return history.compacted;
}
