import { describe, it, expect, beforeEach } from 'bun:test';
import { getDb } from '../../db/database';
import {
  compactMessages,
  loadConversationHistory,
  getContextLimit,
  getRecommendedOptions,
  type CompactionOptions,
} from '../chat-compaction';

describe('Chat Compaction', () => {
  let db: any;

  beforeEach(() => {
    db = getDb();
    // Clean up test conversations
    db.query('DELETE FROM conversations WHERE id LIKE "test-%"').run();
    db.query('DELETE FROM messages WHERE conversation_id LIKE "test-%"').run();
  });

  describe('getContextLimit', () => {
    it('should return correct limits for Claude models', () => {
      expect(getContextLimit('claude-opus-4')).toBe(200000);
      expect(getContextLimit('claude-sonnet-3.5')).toBe(200000);
      expect(getContextLimit('claude-haiku-3')).toBe(200000);
    });

    it('should return correct limits for Ollama models', () => {
      expect(getContextLimit('ollama:llama3.1')).toBe(128000);
      expect(getContextLimit('ollama:qwen2.5')).toBe(32000);
      expect(getContextLimit('ollama:mistral')).toBe(32000);
    });

    it('should return default limit for unknown models', () => {
      expect(getContextLimit('unknown-model')).toBe(100000);
    });
  });

  describe('compactMessages - sliding window', () => {
    it('should not compact when under message limit', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ];

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 10,
      });

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual(messages);
      expect(result.originalCount).toBe(2);
      expect(result.compactedCount).toBe(2);
    });

    it('should compact when over message limit', () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `Message ${i}` }],
      }));

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 5,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      expect(result.compactedCount).toBe(5);
      expect(result.originalCount).toBe(15);
      expect(result.tokensRemoved).toBeGreaterThan(0);
    });

    it('should create summary when compacting', () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `Message ${i}` }],
      }));

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 3,
        createSummary: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('Previous conversation summary');
      // Summary message + 3 kept messages
      expect(result.compactedCount).toBe(4);
    });
  });

  describe('compactMessages - token-based', () => {
    it('should not compact when under token limit', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Short' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      ];

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 1000,
      });

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('should compact based on token limit', () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [
          {
            type: 'text',
            text: 'This is a longer message that contains multiple words and should have more tokens'.repeat(
              10,
            ),
          },
        ],
      }));

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 2000,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      expect(result.compactedCount).toBeLessThan(result.originalCount);
      expect(result.tokensRemoved).toBeGreaterThan(0);
    });
  });

  describe('compactMessages - smart', () => {
    it('should preserve tool use messages', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Read file' }] },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool1', name: 'Read', input: { file_path: 'test.txt' } },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool1',
              content: 'File contents here',
            },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ];

      // Add many more regular messages with longer text to exceed token limit
      const manyMessages = [
        ...messages,
        ...Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Regular message ${i}`.repeat(100) }],
        })),
      ];

      const result = compactMessages(manyMessages, {
        strategy: 'smart',
        maxTokens: 500,
        preserveToolUse: true,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      // Tool use messages should be in the result
      const toolUseInResult = result.messages.some((m: any) =>
        m.content.some((c: any) => c.type === 'tool_use'),
      );
      expect(toolUseInResult).toBe(true);
    });

    it('should balance important and recent messages', () => {
      const messages = [
        { role: 'system', content: [{ type: 'text', text: 'System message' }] },
        ...Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Message ${i}`.repeat(100) }],
        })),
      ];

      const result = compactMessages(messages, {
        strategy: 'smart',
        maxTokens: 2000,
        preserveToolUse: true,
      });

      expect(result.compacted).toBe(true);
      // System message should be preserved
      const hasSystemMsg = result.messages.some((m: any) => m.role === 'system');
      expect(hasSystemMsg).toBe(true);
    });
  });

  describe('loadConversationHistory', () => {
    it('should load empty history for new conversation', () => {
      const result = loadConversationHistory('test-empty-conv');

      expect(result.messages).toEqual([]);
      expect(result.compacted).toBe(false);
      expect(result.originalCount).toBe(0);
    });

    it('should load and compact conversation from DB', () => {
      // Create test conversation
      db.query(
        `INSERT INTO conversations (id, model, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('test-compact-conv', 'claude-sonnet-3.5', Date.now(), Date.now());

      // Add many messages
      for (let i = 0; i < 25; i++) {
        const content = JSON.stringify([
          {
            type: 'text',
            text: `Test message ${i}`.repeat(50), // Make them longer
          },
        ]);
        db.query(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          `msg-${i}`,
          'test-compact-conv',
          i % 2 === 0 ? 'user' : 'assistant',
          content,
          Date.now() + i,
        );
      }

      const result = loadConversationHistory('test-compact-conv', {
        strategy: 'sliding-window',
        maxMessages: 10,
        createSummary: true,
      });

      expect(result.originalCount).toBe(25);
      expect(result.compacted).toBe(true);
      expect(result.compactedCount).toBe(11); // 10 messages + 1 summary
      expect(result.summary).toBeDefined();
    });
  });

  describe('getRecommendedOptions', () => {
    it('should return appropriate options for Claude models', () => {
      const opts = getRecommendedOptions('claude-sonnet-3.5');

      expect(opts.strategy).toBe('smart');
      expect(opts.preserveToolUse).toBe(true);
      expect(opts.createSummary).toBe(true);
      expect(opts.maxTokens).toBeGreaterThan(100000);
    });

    it('should return appropriate options for smaller Ollama models', () => {
      const opts = getRecommendedOptions('ollama:qwen2.5');

      expect(opts.maxTokens).toBeLessThan(30000); // 75% of 32000
    });
  });

  describe('edge cases', () => {
    it('should handle empty message array', () => {
      const result = compactMessages([]);

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual([]);
      expect(result.originalCount).toBe(0);
    });

    it('should handle messages with mixed content types', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello'.repeat(500) },
            { type: 'image', source: { type: 'base64', data: 'abc123' } },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'I see an image'.repeat(500) }] },
      ];

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 100,
      });

      // Should compact or not based on actual token count
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should handle invalid JSON in DB gracefully', () => {
      db.query(
        `INSERT INTO conversations (id, model, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('test-invalid-json', 'claude-sonnet-3.5', Date.now(), Date.now());

      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('msg-bad', 'test-invalid-json', 'user', 'not valid json{', Date.now());

      const result = loadConversationHistory('test-invalid-json');

      // Should skip invalid message
      expect(result.messages).toEqual([]);
    });
  });
});
