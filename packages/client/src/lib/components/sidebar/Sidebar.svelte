<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import ConversationList from './ConversationList.svelte';
  import TaskPanel from './TaskPanel.svelte';
  import FileTree from './FileTree.svelte';
  import MemoryPanel from './MemoryPanel.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import SymbolOutline from '../editor/SymbolOutline.svelte';
  import McpPanel from './McpPanel.svelte';

  const tabs = [
    {
      id: 'conversations' as const,
      label: 'Chats',
      icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    },
    {
      id: 'files' as const,
      label: 'Files',
      icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
    },
    {
      id: 'search' as const,
      label: 'Search',
      icon: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
    },
    {
      id: 'symbols' as const,
      label: 'Symbols',
      icon: 'M4 7h16M4 12h10M4 17h6',
    },
    {
      id: 'tasks' as const,
      label: 'Tasks',
      icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    },
    {
      id: 'memory' as const,
      label: 'Memory',
      icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM12 16v-4M12 8h.01',
    },
    {
      id: 'agents' as const,
      label: 'Agents',
      icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    },
    {
      id: 'mcp' as const,
      label: 'MCP',
      icon: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z',
    },
  ];
</script>

<div class="sidebar-container">
  <nav class="sidebar-tabs">
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:active={uiStore.sidebarTab === tab.id}
        onclick={() => uiStore.setSidebarTab(tab.id)}
        title={tab.label}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d={tab.icon} />
        </svg>
      </button>
    {/each}
  </nav>

  <div class="sidebar-content">
    {#if uiStore.sidebarTab === 'conversations'}
      <ConversationList />
    {:else if uiStore.sidebarTab === 'files'}
      <FileTree />
    {:else if uiStore.sidebarTab === 'search'}
      <SearchPanel />
    {:else if uiStore.sidebarTab === 'symbols'}
      <SymbolOutline />
    {:else if uiStore.sidebarTab === 'tasks'}
      <TaskPanel />
    {:else if uiStore.sidebarTab === 'memory'}
      <MemoryPanel />
    {:else if uiStore.sidebarTab === 'agents'}
      <AgentPanel />
    {:else if uiStore.sidebarTab === 'mcp'}
      <McpPanel />
    {/if}
  </div>
</div>

<style>
  .sidebar-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .sidebar-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-primary);
    padding: 4px 6px;
    gap: 1px;
    flex-shrink: 0;
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    color: var(--text-tertiary);
    border-radius: 0;
    transition: all var(--transition);
    position: relative;
    border: 1px solid transparent;
  }
  .tab-btn:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .tab-btn.active {
    color: var(--accent-primary);
    background: var(--bg-active);
    border-color: var(--border-primary);
    border-bottom-color: transparent;
  }
  .tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 20%;
    right: 20%;
    height: 1px;
    background: var(--accent-primary);
    box-shadow: 0 0 6px rgba(0, 180, 255, 0.4);
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
</style>
