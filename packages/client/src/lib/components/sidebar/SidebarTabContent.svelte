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
  import TodoScanPanel from './TodoScanPanel.svelte';
  import CostPanel from './CostPanel.svelte';
  import AmbientPanel from './AmbientPanel.svelte';
  import DigestPanel from './DigestPanel.svelte';
  import CustomToolsPanel from './CustomToolsPanel.svelte';
  import InitiativesPanel from './InitiativesPanel.svelte';
  import HelpPanel from './HelpPanel.svelte';
  import GitPanel from './GitPanel.svelte';
  import ArtifactsPanel from './ArtifactsPanel.svelte';

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
{:else if tabId === 'todos'}
  <TodoScanPanel />
{:else if tabId === 'costs'}
  <CostPanel />
{:else if tabId === 'ambient'}
  <AmbientPanel />
{:else if tabId === 'digest'}
  <DigestPanel />
{:else if tabId === 'custom-tools'}
  <CustomToolsPanel />
{:else if tabId === 'initiatives'}
  <InitiativesPanel />
{:else if tabId === 'help'}
  <HelpPanel />
{:else if tabId === 'git'}
  <GitPanel />
{:else if tabId === 'artifacts'}
  <ArtifactsPanel />
{/if}
