<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { projectStore } from '$lib/stores/projects.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  let search = $state('');
  let showAllProjects = $state(false);

  let filtered = $derived(
    conversationStore.list
      .filter((c) => {
        // Filter by active project unless "All Projects" is toggled
        if (!showAllProjects && projectStore.activeProject) {
          return (
            c.projectId === projectStore.activeProjectId ||
            c.projectPath === projectStore.activeProject.path
          );
        }
        return true;
      })
      .filter((c) => c.title.toLowerCase().includes(search.toLowerCase())),
  );

  /** Whether the draft placeholder should appear (new conversation, nothing typed yet). */
  let showDraft = $derived(conversationStore.draft !== null && !conversationStore.active);

  onMount(async () => {
    try {
      const res = await api.conversations.list();
      conversationStore.setList(res.data);

      // Auto-restore the previously active conversation after page reload,
      // but skip if a stream reconnection is already in progress (it handles
      // loading the conversation itself and calling streamStore.reset() here
      // would destroy its state).
      if (!conversationStore.active && !streamStore.isStreaming) {
        const savedId = workspaceStore.activeWorkspace?.snapshot.activeConversationId;
        if (savedId && res.data.some((c: any) => c.id === savedId)) {
          conversationStore.setLoading(true);
          try {
            const convRes = await api.conversations.get(savedId);
            conversationStore.setActive(convRes.data);
            streamStore.reset();
          } finally {
            conversationStore.setLoading(false);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  });

  async function selectConversation(id: string) {
    if (conversationStore.activeId === id) return;
    conversationStore.clearDraft();
    conversationStore.setLoading(true);
    try {
      const res = await api.conversations.get(id);
      conversationStore.setActive(res.data);
      // Only reset stream state if there's no active stream, or the stream
      // belongs to the conversation we're switching TO (so UI syncs up).
      // If the stream is for a different conversation, leave it running —
      // it will continue updating its target conversation in the background.
      if (!streamStore.isStreaming || streamStore.conversationId === id) {
        streamStore.reset();
      }
    } finally {
      conversationStore.setLoading(false);
    }
  }

  async function newConversation() {
    conversationStore.setActive(null);
    conversationStore.createDraft();
    // Only reset if no active stream is running for another conversation
    if (!streamStore.isStreaming) {
      streamStore.reset();
    }
  }

  async function deleteConversation(e: MouseEvent, id: string) {
    e.stopPropagation();
    await api.conversations.delete(id);
    conversationStore.removeConversation(id);
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="conv-list">
  <div class="conv-header">
    <input
      type="text"
      bind:value={search}
      placeholder="Search conversations..."
      class="search-input"
    />
    <button class="new-btn" onclick={newConversation} title="New conversation">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  </div>
  {#if projectStore.activeProject}
    <div class="project-filter">
      <button
        class="filter-toggle"
        class:active={!showAllProjects}
        onclick={() => (showAllProjects = false)}
      >
        {projectStore.activeProject.name}
      </button>
      <button
        class="filter-toggle"
        class:active={showAllProjects}
        onclick={() => (showAllProjects = true)}
      >
        All
      </button>
    </div>
  {/if}

  <div class="conv-items">
    {#if showDraft}
      <div class="conv-item active draft">
        <div class="conv-title truncate">New conversation</div>
        <div class="conv-meta">
          <span>Now</span>
        </div>
      </div>
    {/if}
    {#each filtered as conv (conv.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="conv-item"
        class:active={conversationStore.activeId === conv.id}
        onclick={() => selectConversation(conv.id)}
        role="button"
        tabindex="0"
      >
        <div class="conv-title truncate">{conv.title}</div>
        <div class="conv-meta">
          <span>{formatDate(conv.updatedAt)}</span>
          <span>{conv.messageCount} msgs</span>
        </div>
        <button class="conv-delete" onclick={(e) => deleteConversation(e, conv.id)} title="Delete">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {:else}
      {#if !showDraft}
        <div class="empty">
          {search ? 'No matching conversations' : 'No conversations yet'}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .conv-list {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .conv-header {
    display: flex;
    gap: 6px;
    padding: 10px 10px 8px;
  }

  .search-input {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    letter-spacing: var(--ht-label-spacing);
  }
  .search-input:focus {
    border-color: var(--accent-primary);
    background: var(--bg-input);
    box-shadow: var(--shadow-glow-sm);
  }

  .new-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    color: var(--accent-primary);
    transition: all var(--transition);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
  }
  .new-btn:hover {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    background: var(--bg-hover);
  }

  .conv-items {
    flex: 1;
    overflow-y: auto;
    padding: 4px 6px;
  }

  .conv-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--ht-item-padding);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    position: relative;
    margin-bottom: 1px;
    cursor: pointer;
    border-left: var(--ht-item-indicator) solid transparent;
  }
  .conv-item:hover {
    background: var(--bg-hover);
    border-left-color: var(--border-primary);
  }
  .conv-item.active {
    background: var(--bg-active);
    border-left-color: var(--accent-primary);
    box-shadow: inset 0 0 20px var(--bg-hover);
  }

  /* ── Hypertheme list item variants ── */

  :global([data-hypertheme='ethereal']) .conv-item {
    border-left: none;
    border-radius: var(--radius);
    margin-bottom: 4px;
  }
  :global([data-hypertheme='ethereal']) .conv-item:hover {
    border-left: none;
    transform: translateX(2px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  :global([data-hypertheme='ethereal']) .conv-item.active {
    border-left: none;
    box-shadow:
      0 2px 12px rgba(0, 0, 0, 0.15),
      inset 0 0 0 1px var(--border-primary);
  }

  :global([data-hypertheme='arcane']) .conv-item {
    border-left: 3px double transparent;
    margin-bottom: 2px;
  }
  :global([data-hypertheme='arcane']) .conv-item:hover {
    border-left-color: var(--border-primary);
  }
  :global([data-hypertheme='arcane']) .conv-item.active {
    border-left-color: var(--accent-primary);
    border: 1px solid var(--border-secondary);
    border-left: 3px double var(--accent-primary);
  }

  :global([data-hypertheme='study']) .conv-item {
    border-left: 4px solid transparent;
    margin-bottom: 0;
    border-bottom: 1px solid var(--border-secondary);
    border-radius: 0;
  }
  :global([data-hypertheme='study']) .conv-item:hover {
    border-left-color: var(--border-primary);
  }
  :global([data-hypertheme='study']) .conv-item.active {
    border-left-color: var(--accent-primary);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  :global([data-hypertheme='astral']) .conv-item,
  :global([data-hypertheme='astral-midnight']) .conv-item {
    border-left: none;
    border-bottom: 1px solid var(--border-secondary);
    border-radius: 0;
    margin-bottom: 0;
  }
  :global([data-hypertheme='astral']) .conv-item:hover,
  :global([data-hypertheme='astral-midnight']) .conv-item:hover {
    border-left: none;
    border-bottom-color: var(--accent-primary);
  }
  :global([data-hypertheme='astral']) .conv-item.active,
  :global([data-hypertheme='astral-midnight']) .conv-item.active {
    border-left: none;
    border-bottom-color: var(--accent-primary);
  }

  .conv-item.draft .conv-title {
    font-style: italic;
    opacity: 0.7;
  }

  .conv-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 3px;
  }
  .conv-item.active .conv-title {
    color: var(--accent-primary);
    text-shadow: var(--shadow-glow-sm);
  }

  .conv-meta {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: var(--text-tertiary);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
  }

  .conv-delete {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: none;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .conv-item:hover .conv-delete {
    display: flex;
  }
  .conv-delete:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: var(--bg-hover);
  }

  .empty {
    padding: 30px 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 13px;
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
  }

  .project-filter {
    display: flex;
    gap: 2px;
    padding: 0 10px 8px;
  }
  .filter-toggle {
    flex: 1;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .filter-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .filter-toggle.active {
    background: var(--bg-active);
    color: var(--accent-primary);
  }
</style>
