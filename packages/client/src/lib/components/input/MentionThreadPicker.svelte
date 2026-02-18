<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { onMount } from 'svelte';

  interface ConversationSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    model: string;
  }

  let {
    onSelect,
    onClose,
  } = $props<{
    onSelect: (conv: ConversationSummary) => void;
    onClose: () => void;
  }>();

  let searchQuery = $state('');
  let selectedIndex = $state(0);
  let searchInput = $state<HTMLInputElement>();

  onMount(() => {
    searchInput?.focus();
  });

  let threads = $derived(
    conversationStore.list.filter((c) => c.id !== conversationStore.activeId),
  );

  let filtered = $derived(
    searchQuery.trim()
      ? threads.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : threads,
  );

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      onSelect(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="thread-picker" onclick={(e) => e.stopPropagation()}>
  <div class="picker-header">
    <span class="picker-title">💬 Select Thread</span>
    <button class="picker-close" onclick={onClose}>×</button>
  </div>
  <div class="search-wrap">
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      oninput={() => (selectedIndex = 0)}
      placeholder="Search conversations..."
      class="search-input"
    />
  </div>
  <div class="picker-list">
    {#if filtered.length === 0}
      <div class="picker-empty">
        {threads.length === 0 ? 'No prior conversations found' : 'No matching conversations'}
      </div>
    {:else}
      {#each filtered as conv, i}
        <button
          class="picker-item"
          class:selected={i === selectedIndex}
          onclick={() => onSelect(conv)}
          onmouseenter={() => (selectedIndex = i)}
        >
          <span class="thread-icon">💬</span>
          <span class="thread-title">{conv.title || 'Untitled'}</span>
          <span class="thread-meta">
            {conv.messageCount} msgs · {formatDate(conv.updatedAt)}
          </span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .thread-picker {
    position: absolute;
    bottom: 100%;
    left: 24px;
    right: 24px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: 100;
    display: flex;
    flex-direction: column;
    max-height: 340px;
  }

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    border-bottom: 1px solid var(--border-primary);
  }

  .picker-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-primary);
  }

  .picker-close {
    color: var(--text-tertiary);
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
  }
  .picker-close:hover {
    color: var(--text-primary);
  }

  .search-wrap {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-primary);
  }

  .search-input {
    width: 100%;
    font-size: 12px;
    padding: 5px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
  }
  .search-input:focus {
    border-color: var(--accent-primary);
  }

  .picker-list {
    overflow-y: auto;
    flex: 1;
    padding: 4px;
  }

  .picker-empty {
    padding: 12px;
    color: var(--text-tertiary);
    font-size: 12px;
    text-align: center;
  }

  .picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: 12px;
    transition: background var(--transition);
    color: var(--text-secondary);
  }
  .picker-item:hover,
  .picker-item.selected {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .thread-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .thread-title {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread-meta {
    color: var(--text-tertiary);
    font-size: 10px;
    flex-shrink: 0;
    white-space: nowrap;
  }
</style>
