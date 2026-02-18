<script lang="ts">
  export interface MentionType {
    id: 'file' | 'symbol' | 'diagnostics' | 'rule' | 'thread';
    label: string;
    description: string;
    icon: string;
  }

  const MENTION_TYPES: MentionType[] = [
    { id: 'file', label: '@file', description: 'Inject file content as context', icon: '📄' },
    { id: 'symbol', label: '@symbol', description: 'Inject symbol definition from code', icon: '⚡' },
    { id: 'diagnostics', label: '@diagnostics', description: 'Inject all LSP errors & warnings', icon: '🔴' },
    { id: 'rule', label: '@rule', description: 'Inject an on-demand rule from Rules Library', icon: '📋' },
    { id: 'thread', label: '@thread', description: 'Inject a prior conversation summary', icon: '💬' },
  ];

  let {
    query = '',
    onSelect,
    onClose,
  } = $props<{
    query: string;
    onSelect: (type: MentionType['id']) => void;
    onClose: () => void;
  }>();

  let filtered = $derived(
    MENTION_TYPES.filter(
      (m) =>
        m.id.toLowerCase().includes(query.toLowerCase()) ||
        m.description.toLowerCase().includes(query.toLowerCase()),
    ),
  );

  let selectedIndex = $state(0);

  $effect(() => {
    // Reset index when filter changes
    void query;
    selectedIndex = 0;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      onSelect(filtered[selectedIndex].id);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mention-menu" onclick={(e) => e.stopPropagation()}>
  {#if filtered.length === 0}
    <div class="no-results">No mention types found</div>
  {:else}
    {#each filtered as type, i}
      <button
        class="mention-item"
        class:selected={i === selectedIndex}
        onclick={() => onSelect(type.id)}
        onmouseenter={() => (selectedIndex = i)}
      >
        <span class="mention-icon">{type.icon}</span>
        <span class="mention-label">{type.label}</span>
        <span class="mention-desc">{type.description}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .mention-menu {
    position: absolute;
    bottom: 100%;
    left: 24px;
    right: 24px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    max-height: 300px;
    overflow-y: auto;
    padding: 4px;
    z-index: 100;
  }

  .mention-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background var(--transition);
  }
  .mention-item:hover,
  .mention-item.selected {
    background: var(--bg-hover);
  }

  .mention-icon {
    font-size: 14px;
    flex-shrink: 0;
    width: 20px;
    text-align: center;
  }

  .mention-label {
    font-weight: 600;
    color: var(--accent-primary);
    font-size: 13px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .mention-desc {
    color: var(--text-tertiary);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .no-results {
    padding: 12px;
    color: var(--text-tertiary);
    font-size: 13px;
    text-align: center;
  }
</style>
