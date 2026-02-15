<script lang="ts">
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import ConversationList from './ConversationList.svelte';
  import TaskPanel from './TaskPanel.svelte';
  import FileTree from './FileTree.svelte';
  import MemoryPanel from './MemoryPanel.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import SymbolOutline from '../editor/SymbolOutline.svelte';
  import McpPanel from './McpPanel.svelte';
  import LoopPanel from './LoopPanel.svelte';

  let { tabId }: { tabId: SidebarTab } = $props();
</script>

{#if tabId === 'conversations'}
  <ConversationList />
{:else if tabId === 'files'}
  <FileTree />
{:else if tabId === 'search'}
  <SearchPanel />
{:else if tabId === 'symbols'}
  <SymbolOutline />
{:else if tabId === 'tasks'}
  <TaskPanel />
{:else if tabId === 'memory'}
  <MemoryPanel />
{:else if tabId === 'agents'}
  <AgentPanel />
{:else if tabId === 'mcp'}
  <McpPanel />
{:else if tabId === 'loop'}
  <LoopPanel />
{/if}
