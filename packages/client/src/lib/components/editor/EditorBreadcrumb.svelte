<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import type { Symbol } from '$lib/workers/treesitter-worker';

  let breadcrumbs = $derived(getBreadcrumbs());

  function getBreadcrumbs(): { name: string; kind: string }[] {
    const tab = editorStore.activeTab;
    if (!tab) return [];

    const symbols = symbolStore.getSymbols(tab.id);
    if (symbols.length === 0) return [];

    const cursorRow = tab.cursorLine - 1; // 0-indexed
    const path: { name: string; kind: string }[] = [];

    function find(syms: Symbol[]) {
      for (const sym of syms) {
        if (cursorRow >= sym.startRow && cursorRow <= sym.endRow) {
          path.push({ name: sym.name, kind: sym.kind });
          if (sym.children) find(sym.children);
          return;
        }
      }
    }

    find(symbols);
    return path;
  }
</script>

{#if breadcrumbs.length > 0}
  <div class="breadcrumb-bar">
    {#each breadcrumbs as crumb, i}
      {#if i > 0}
        <span class="crumb-sep">&rsaquo;</span>
      {/if}
      <span class="crumb" title={crumb.kind}>{crumb.name}</span>
    {/each}
  </div>
{/if}

<style>
  .breadcrumb-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .breadcrumb-bar::-webkit-scrollbar {
    display: none;
  }

  .crumb {
    white-space: nowrap;
    cursor: default;
  }
  .crumb:hover {
    color: var(--accent-primary);
  }

  .crumb-sep {
    color: var(--text-tertiary);
    opacity: 0.5;
  }
</style>
