<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import MessageBubble from './MessageBubble.svelte';
  import StreamingMessage from './StreamingMessage.svelte';
  import StoryActionCards from './StoryActionCards.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { hasStoryActions } from '$lib/utils/story-parser';
  import { tick } from 'svelte';

  // Check if the current conversation is a planning conversation with edits enabled
  let isPlanningWithEdits = $derived(
    loopStore.allowEdits &&
      loopStore.planConversationId === conversationStore.activeId &&
      conversationStore.active?.title?.startsWith('[Plan]'),
  );

  let scrollContainer: HTMLDivElement;
  let userScrolled = $state(false);
  let scrollPending = false;

  function handleScroll() {
    if (!scrollContainer || scrollPending) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    userScrolled = scrollHeight - scrollTop - clientHeight > 60;
  }

  async function scrollToBottom() {
    if (userScrolled) return;
    if (scrollPending) return;
    scrollPending = true;
    await tick();
    await tick(); // double tick to let DOM fully settle
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
    scrollPending = false;
  }

  // Single effect that watches both messages and streaming content
  $effect(() => {
    // Touch reactive deps
    const _msgs = conversationStore.active?.messages?.length;
    const _blocks = streamStore.contentBlocks.length;
    const _status = streamStore.status;
    scrollToBottom();
  });
</script>

<div class="message-list" bind:this={scrollContainer} onscroll={handleScroll}>
  {#if !conversationStore.active || conversationStore.active.messages.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M4 4 L12 2 L20 4 L20 14 L12 22 L4 14 Z" />
          <path d="M8 8 L12 6 L16 8 L16 13 L12 17 L8 13 Z" />
        </svg>
      </div>
      <h2>MAUDE</h2>
      <p>Start a conversation to begin.</p>
      <div class="shortcuts">
        <kbd>Ctrl+K</kbd> PALETTE
        <kbd>Ctrl+/</kbd> SIDEBAR
        <kbd>/</kbd> COMMANDS
      </div>
    </div>
  {:else}
    {@const msgs = conversationStore.active.messages}
    {#each msgs as message, i (message.id)}
      {@const isStreamingHere =
        streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId}
      {#if !(isStreamingHere && i === msgs.length - 1 && message.role === 'assistant')}
        <MessageBubble {message} />
        {#if isPlanningWithEdits && message.role === 'assistant'}
          <StoryActionCards {message} />
        {/if}
      {/if}
    {/each}

    {#if streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId}
      <StreamingMessage />
    {/if}

    {#if streamStore.status === 'error' && streamStore.error}
      <div class="stream-error">
        <span class="error-label">ERROR</span>
        <span class="error-message">{streamStore.error}</span>
      </div>
    {/if}
  {/if}

  {#if userScrolled}
    <button
      class="scroll-bottom"
      onclick={() => {
        userScrolled = false;
        scrollToBottom();
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 20px 0;
    position: relative;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-tertiary);
    gap: 16px;
    text-align: center;
    padding: 20px;
    animation: fadeIn 0.5s linear;
  }
  .empty-state h2 {
    font-size: 36px;
    font-weight: 700;
    letter-spacing: 8px;
    text-transform: uppercase;
    color: var(--accent-primary);
    text-shadow:
      0 0 20px rgba(0, 180, 255, 0.4),
      0 0 40px rgba(0, 180, 255, 0.1);
  }
  .empty-state p {
    font-size: 15px;
    max-width: 420px;
    color: var(--text-secondary);
    line-height: 1.6;
    letter-spacing: 0.5px;
    font-weight: 500;
  }
  .empty-icon {
    color: var(--accent-primary);
    opacity: 0.5;
    filter: drop-shadow(0 0 12px rgba(0, 180, 255, 0.6))
      drop-shadow(0 0 24px rgba(0, 180, 255, 0.3));
  }
  .shortcuts {
    display: flex;
    gap: 20px;
    font-size: 12px;
    margin-top: 12px;
    color: var(--text-secondary);
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .shortcuts kbd {
    background: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: 0;
    font-size: 11px;
    font-family: var(--font-family);
    margin-right: 5px;
    border: 1px solid var(--border-primary);
    color: var(--accent-primary);
  }

  .stream-error {
    margin: 8px 28px;
    padding: 12px 16px;
    background: rgba(255, 50, 50, 0.08);
    border-left: 2px solid var(--error, #ff3232);
    font-size: 13px;
    color: var(--text-primary);
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .error-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--error, #ff3232);
    flex-shrink: 0;
  }
  .error-message {
    word-break: break-word;
    color: var(--text-secondary);
  }

  .scroll-bottom {
    position: sticky;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 32px;
    border-radius: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .scroll-bottom:hover {
    background: var(--bg-active);
    border-color: var(--accent-primary);
    box-shadow: 0 0 10px rgba(0, 180, 255, 0.3);
    transform: translateX(-50%);
  }
</style>
