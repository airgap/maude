<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';

  let query = $state('');
  let selectedIndex = $state(0);
  let input: HTMLInputElement;

  interface Command {
    id: string;
    label: string;
    category: string;
    shortcut?: string;
    action: () => void;
  }

  const commands: Command[] = [
    {
      id: 'new-chat',
      label: 'New Conversation',
      category: 'Chat',
      shortcut: 'Ctrl+N',
      action: () => {
        conversationStore.setActive(null);
        close();
      },
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      category: 'View',
      shortcut: 'Ctrl+/',
      action: () => {
        uiStore.toggleSidebar();
        close();
      },
    },
    {
      id: 'settings',
      label: 'Open Settings',
      category: 'Settings',
      action: () => {
        uiStore.openModal('settings');
      },
    },
    {
      id: 'theme-dark',
      label: 'Theme: Dark',
      category: 'Appearance',
      action: () => {
        settingsStore.setTheme('dark');
        close();
      },
    },
    {
      id: 'theme-light',
      label: 'Theme: Light',
      category: 'Appearance',
      action: () => {
        settingsStore.setTheme('light');
        close();
      },
    },
    {
      id: 'plan-mode',
      label: 'Toggle Plan Mode',
      category: 'Mode',
      shortcut: 'Shift+Tab x2',
      action: () => {
        conversationStore.active &&
          conversationStore.setPlanMode(!conversationStore.active.planMode);
        close();
      },
    },
    {
      id: 'tab-chats',
      label: 'Show Conversations',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('conversations');
        close();
      },
    },
    {
      id: 'tab-files',
      label: 'Show Files',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('files');
        close();
      },
    },
    {
      id: 'tab-tasks',
      label: 'Show Tasks',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('tasks');
        close();
      },
    },
    {
      id: 'tab-memory',
      label: 'Show Memory',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('memory');
        close();
      },
    },
    {
      id: 'tab-agents',
      label: 'Show Agents',
      category: 'View',
      action: () => {
        uiStore.setSidebarTab('agents');
        close();
      },
    },
    {
      id: 'mcp',
      label: 'Manage MCP Servers',
      category: 'Settings',
      action: () => {
        uiStore.openModal('mcp-manager');
      },
    },
  ];

  let filtered = $derived(
    commands.filter(
      (c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.category.toLowerCase().includes(query.toLowerCase()),
    ),
  );

  function close() {
    uiStore.closeModal();
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
      filtered[selectedIndex].action();
    } else if (e.key === 'Escape') {
      close();
    }
  }

  $effect(() => {
    query;
    selectedIndex = 0;
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="palette-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="palette" onclick={(e) => e.stopPropagation()}>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={handleKeydown}
      placeholder="Type a command..."
      class="palette-input"
    />

    <div class="palette-results">
      {#each filtered as cmd, i (cmd.id)}
        <button
          class="palette-item"
          class:selected={i === selectedIndex}
          onclick={() => cmd.action()}
          onmouseenter={() => (selectedIndex = i)}
        >
          <span class="cmd-category">{cmd.category}</span>
          <span class="cmd-label">{cmd.label}</span>
          {#if cmd.shortcut}
            <kbd class="cmd-shortcut">{cmd.shortcut}</kbd>
          {/if}
        </button>
      {:else}
        <div class="no-results">No commands found</div>
      {/each}
    </div>
  </div>
</div>

<svelte:window onkeydown={handleKeydown} />

<style>
  .palette-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 20vh;
    z-index: 1000;
  }

  .palette {
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    width: 500px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .palette-input {
    padding: 14px 16px;
    border: none;
    border-bottom: 1px solid var(--border-primary);
    background: transparent;
    font-size: 15px;
    outline: none;
    color: var(--text-primary);
  }

  .palette-results {
    overflow-y: auto;
    padding: 4px;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background var(--transition);
  }
  .palette-item:hover,
  .palette-item.selected {
    background: var(--bg-hover);
  }

  .cmd-category {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    min-width: 60px;
    text-align: center;
  }
  .cmd-label {
    flex: 1;
    font-size: 13px;
    color: var(--text-primary);
  }
  .cmd-shortcut {
    font-size: 11px;
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .no-results {
    padding: 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 13px;
  }
</style>
