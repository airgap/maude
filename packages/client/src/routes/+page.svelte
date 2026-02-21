<script lang="ts">
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/input/ChatInput.svelte';
  import ChangeSummary from '$lib/components/chat/ChangeSummary.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';

  const pageTitle = $derived.by(() => {
    const base = conversationStore.active?.title ?? 'E';
    if (loopStore.isRunning) {
      const progress =
        loopStore.totalStories > 0
          ? ` ${loopStore.completedStories}/${loopStore.totalStories}`
          : '';
      return `⚡ Golem${progress} — ${base}`;
    }
    if (loopStore.isPaused) {
      return `⏸ Golem Paused — ${base}`;
    }
    return base;
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="chat-page">
  <MessageList />
  <ChangeSummary />
  <ChatInput />
</div>

<style>
  .chat-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
</style>
