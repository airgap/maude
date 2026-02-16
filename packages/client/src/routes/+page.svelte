<script lang="ts">
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/input/ChatInput.svelte';
  import ChangeSummary from '$lib/components/chat/ChangeSummary.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
</script>

<svelte:head>
  <title>{conversationStore.active?.title ?? 'E'}</title>
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
