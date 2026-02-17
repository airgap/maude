<script lang="ts">
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import ConversationList from './ConversationList.svelte';
  import WorkPanel from './WorkPanel.svelte';
  import FileTree from './FileTree.svelte';
  import MemoryPanel from './MemoryPanel.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import SymbolOutline from '../editor/SymbolOutline.svelte';
  import McpPanel from './McpPanel.svelte';

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
{:else if tabId === 'work'}
  <WorkPanel />
{:else if tabId === 'memory'}
  <MemoryPanel />
{:else if tabId === 'agents'}
  <AgentPanel />
{:else if tabId === 'mcp'}
  <McpPanel />
{/if}
