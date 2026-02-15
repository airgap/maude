import type { Message, Conversation, ConversationSummary, MessageContent } from '@maude/shared';
import { api } from '$lib/api/client';

export const DRAFT_ID = '__draft__';

function createConversationStore() {
  let conversations = $state<ConversationSummary[]>([]);
  let active = $state<Conversation | null>(null);
  let loading = $state(false);
  let draft = $state<ConversationSummary | null>(null);

  return {
    get list() {
      return conversations;
    },
    get active() {
      return active;
    },
    get loading() {
      return loading;
    },
    get activeId() {
      return active?.id ?? null;
    },
    get draft() {
      return draft;
    },

    setList(list: ConversationSummary[]) {
      conversations = list;
    },
    setActive(conv: Conversation | null) {
      active = conv;
      // Clear draft when a real conversation becomes active
      if (conv) draft = null;
    },
    setLoading(v: boolean) {
      loading = v;
    },

    /** Create a draft placeholder that appears in the conversation list. */
    createDraft() {
      const now = Date.now();
      draft = {
        id: DRAFT_ID,
        title: 'New conversation',
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        model: '',
      };
    },

    /** Clear the draft placeholder without replacing it. */
    clearDraft() {
      draft = null;
    },

    addMessage(msg: Message) {
      if (!active) return;
      active.messages = [...active.messages, msg];
      active.updatedAt = Date.now();
      const idx = conversations.findIndex((c) => c.id === active!.id);
      if (idx >= 0) {
        conversations[idx] = {
          ...conversations[idx],
          messageCount: active.messages.length,
          updatedAt: active.updatedAt,
        };
      }
    },

    /** Add a message to a specific conversation (even if it's not the active one). */
    addMessageTo(conv: Conversation, msg: Message) {
      conv.messages = [...conv.messages, msg];
      conv.updatedAt = Date.now();
      // Keep the summary list's messageCount in sync
      const idx = conversations.findIndex((c) => c.id === conv.id);
      if (idx >= 0) {
        conversations[idx] = {
          ...conversations[idx],
          messageCount: conv.messages.length,
          updatedAt: conv.updatedAt,
        };
      }
      // If this is the active conversation, trigger reactivity by
      // assigning a new object (same-reference assignment won't trigger Svelte 5 updates)
      if (active && active.id === conv.id) {
        active = { ...conv };
      }
    },

    updateLastAssistantMessage(content: MessageContent[]) {
      if (!active) return;
      const msgs = active.messages;
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        last.content = content;
        active.messages = [...msgs];
      }
    },

    /** Update the last assistant message in a specific conversation. */
    updateLastAssistantMessageIn(conv: Conversation, content: MessageContent[]) {
      const msgs = conv.messages;
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        last.content = content;
        conv.messages = [...msgs];
        // If this is the active conversation, trigger reactivity by
        // assigning a new object (same-reference assignment won't trigger Svelte 5 updates)
        if (active && active.id === conv.id) {
          active = { ...conv };
        }
      }
    },

    setPlanMode(enabled: boolean) {
      if (active) active = { ...active, planMode: enabled };
    },

    updateTitle(title: string) {
      if (active) active.title = title;
      const idx = conversations.findIndex((c) => c.id === active?.id);
      if (idx >= 0) conversations[idx].title = title;
    },

    removeConversation(id: string) {
      conversations = conversations.filter((c) => c.id !== id);
      if (active?.id === id) active = null;
    },

    prependConversation(summary: ConversationSummary) {
      draft = null; // Draft is replaced by the real conversation
      conversations = [summary, ...conversations];
    },

    /** Reload the active conversation from the server DB. */
    async reload() {
      if (!active) return;
      try {
        const res = await api.conversations.get(active.id);
        if (res.ok && res.data) {
          const conv = res.data as Conversation;
          const idx = conversations.findIndex((c) => c.id === active!.id);
          if (idx >= 0) {
            conversations[idx] = {
              ...conversations[idx],
              messageCount: conv.messages.length,
              updatedAt: conv.updatedAt,
            };
          }
          active = conv;
        }
      } catch (e) {
        console.warn('[conversationStore] Failed to reload:', e);
      }
    },

    /** Reload a specific conversation by ID. Updates active if it matches. */
    async reloadById(id: string) {
      try {
        const res = await api.conversations.get(id);
        if (res.ok && res.data) {
          const conv = res.data as Conversation;
          if (active && active.id === id) {
            active = conv;
          }
          // Sync summary list's messageCount with the authoritative DB data
          const idx = conversations.findIndex((c) => c.id === id);
          if (idx >= 0) {
            conversations[idx] = {
              ...conversations[idx],
              messageCount: conv.messages.length,
              updatedAt: conv.updatedAt,
            };
          }
        }
      } catch (e) {
        console.warn('[conversationStore] Failed to reload:', e);
      }
    },
  };
}

export const conversationStore = createConversationStore();
