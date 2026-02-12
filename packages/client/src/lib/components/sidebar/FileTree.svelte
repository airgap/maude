<script lang="ts">
  import { api } from '$lib/api/client';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';

  interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: TreeNode[];
  }

  let tree = $state<TreeNode[]>([]);
  let expandedDirs = $state<Set<string>>(new Set());
  let loading = $state(false);
  let currentPath = $state('');

  // Reactively reload when active conversation changes
  $effect(() => {
    const path = conversationStore.active?.projectPath || settingsStore.projectPath || '.';
    if (path !== currentPath) {
      currentPath = path;
      loadTree(path);
    }
  });

  async function loadTree(path: string) {
    loading = true;
    tree = [];
    expandedDirs = new Set();
    try {
      const res = await api.files.tree(path, 2);
      tree = res.data;
    } catch {}
    loading = false;
  }

  function toggleDir(path: string) {
    const next = new Set(expandedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedDirs = next;
  }

  function getIcon(node: TreeNode): string {
    if (node.type === 'directory')
      return expandedDirs.has(node.path)
        ? 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'
        : 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
    return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z';
  }
</script>

<div class="file-tree">
  <div class="tree-header">
    <h3>Files</h3>
    {#if currentPath && currentPath !== '.'}
      <span class="tree-path" title={currentPath}
        >{currentPath.split('/').pop() || currentPath}</span
      >
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="tree-items">
      {#each tree as node}
        {@render treeNode(node, 0)}
      {/each}
    </div>
  {/if}
</div>

{#snippet treeNode(node: TreeNode, depth: number)}
  <button
    class="tree-item"
    class:directory={node.type === 'directory'}
    style:padding-left="{8 + depth * 16}px"
    onclick={() => (node.type === 'directory' ? toggleDir(node.path) : null)}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d={getIcon(node)} />
    </svg>
    <span class="node-name truncate">{node.name}</span>
  </button>

  {#if node.type === 'directory' && expandedDirs.has(node.path) && node.children}
    {#each node.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<style>
  .file-tree {
    padding: 8px;
  }
  .tree-header {
    padding: 4px 4px 8px;
  }
  .tree-header h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
  }
  .tree-path {
    display: block;
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-items {
    overflow-y: auto;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-secondary);
    text-align: left;
    transition: background var(--transition);
  }
  .tree-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .tree-item.directory {
    color: var(--text-primary);
  }

  .node-name {
    flex: 1;
    min-width: 0;
  }

  .loading {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
