<script lang="ts">
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/input/ChatInput.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
</script>

<svelte:head>
  <title>{conversationStore.active?.title ?? 'Maude'}</title>
</svelte:head>

<div class="chat-page">
  <MessageList />
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
