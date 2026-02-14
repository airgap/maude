import type { Message, Conversation, ConversationSummary, MessageContent } from '@maude/shared';
import { api } from '$lib/api/client';

function createConversationStore() {
  let conversations = $state<ConversationSummary[]>([]);
  let active = $state<Conversation | null>(null);
  let loading = $state(false);

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

    setList(list: ConversationSummary[]) {
      conversations = list;
    },
    setActive(conv: Conversation | null) {
      active = conv;
    },
    setLoading(v: boolean) {
      loading = v;
    },

    addMessage(msg: Message) {
      if (!active) return;
      active.messages = [...active.messages, msg];
      active.updatedAt = Date.now();
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
      conversations = [summary, ...conversations];
    },

    /** Reload the active conversation from the server DB. */
    async reload() {
      if (!active) return;
      try {
        const res = await api.conversations.get(active.id);
        if (res.ok && res.data) {
          active = res.data as Conversation;
        }
      } catch (e) {
        console.warn('[conversationStore] Failed to reload:', e);
      }
    },
  };
}

export const conversationStore = createConversationStore();
