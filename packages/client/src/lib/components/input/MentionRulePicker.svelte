<script lang="ts">
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { onMount } from 'svelte';

  interface RuleFile {
    path: string;
    name: string;
    content: string;
    type: string;
    mode: string;
    lastModified: number;
  }

  let { onSelect, onClose } = $props<{
    onSelect: (rule: RuleFile) => void;
    onClose: () => void;
  }>();

  let rules = $state<RuleFile[]>([]);
  let loading = $state(false);
  let searchQuery = $state('');
  let selectedIndex = $state(0);
  let searchInput = $state<HTMLInputElement>();

  onMount(async () => {
    searchInput?.focus();
    await loadRules();
  });

  async function loadRules() {
    loading = true;
    try {
      const workspacePath = settingsStore.workspacePath || undefined;
      const res = await api.rules.list(workspacePath);
      rules = res.data || [];
    } catch {
      rules = [];
    } finally {
      loading = false;
    }
  }

  let filtered = $derived(
    searchQuery.trim()
      ? rules.filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : rules,
  );

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
<div class="rule-picker" onclick={(e) => e.stopPropagation()}>
  <div class="picker-header">
    <span class="picker-title">📋 Select Rule</span>
    <button class="picker-close" onclick={onClose}>×</button>
  </div>
  <div class="search-wrap">
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      oninput={() => (selectedIndex = 0)}
      placeholder="Search rules..."
      class="search-input"
    />
  </div>
  <div class="picker-list">
    {#if loading}
      <div class="picker-loading">Loading rules...</div>
    {:else if filtered.length === 0}
      <div class="picker-empty">
        {rules.length === 0
          ? 'No rules found — create rules in the Memory panel'
          : 'No matching rules'}
      </div>
    {:else}
      {#each filtered as rule, i}
        <button
          class="picker-item"
          class:selected={i === selectedIndex}
          onclick={() => onSelect(rule)}
          onmouseenter={() => (selectedIndex = i)}
        >
          <span class="rule-icon">📋</span>
          <span class="rule-name">{rule.name}</span>
          <span class="rule-mode" class:on-demand={rule.mode === 'on-demand'}>{rule.mode}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .rule-picker {
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

  .picker-loading,
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

  .rule-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .rule-name {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rule-mode {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-active);
    color: var(--accent-primary);
    font-weight: 600;
    flex-shrink: 0;
  }
  .rule-mode.on-demand {
    background: var(--bg-hover);
    color: var(--text-tertiary);
  }
</style>
