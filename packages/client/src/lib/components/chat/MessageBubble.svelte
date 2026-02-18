<script lang="ts">
  import type { Message, MessageContent } from '@e/shared';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import CodeBlock from './CodeBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import AgentGroupStatic from './AgentGroupStatic.svelte';
  import MessageAnimation from './MessageAnimation.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';
  import ConversationBranchButton from './ConversationBranchButton.svelte';
  import { ttsStore } from '$lib/stores/tts.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import ReplayModal from './ReplayModal.svelte';

  let { message, conversationId, onEdit, onDelete, onFork } = $props<{
    message: Message;
    conversationId?: string;
    onEdit?: (messageId: string, newText: string) => void;
    onDelete?: (messageId: string) => void;
    onFork?: (messageId: string) => void;
  }>();

  // ── Edit state ──
  let editing = $state(false);
  let editText = $state('');
  let editTextarea = $state<HTMLTextAreaElement>();

  function getTextContent(): string {
    return (message.content as any[])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text as string)
      .join('\n\n');
  }

  function startEdit() {
    editText = getTextContent();
    editing = true;
    requestAnimationFrame(() => {
      if (editTextarea) {
        editTextarea.focus();
        editTextarea.style.height = 'auto';
        editTextarea.style.height = Math.min(editTextarea.scrollHeight, 400) + 'px';
      }
    });
  }

  function cancelEdit() {
    editing = false;
    editText = '';
  }

  function submitEdit() {
    const text = editText.trim();
    if (text && onEdit) {
      onEdit(message.id, text);
    }
    editing = false;
    editText = '';
  }

  // ── Snapshot restore state ──
  let restoringSnapshot = $state(false);

  async function handleRestore() {
    if (restoringSnapshot || message.role !== 'assistant') return;
    restoringSnapshot = true;
    try {
      const snapRes = await api.git.snapshotByMessage(message.id);
      if (snapRes.ok && snapRes.data) {
        await api.git.restoreSnapshot(snapRes.data.id);
        uiStore.toast('Snapshot restored successfully', 'success');
      } else {
        uiStore.toast('No snapshot found for this message', 'info');
      }
    } catch {
      uiStore.toast('Failed to restore snapshot', 'error');
    }
    restoringSnapshot = false;
  }

  // ── Replay state ──
  let showReplay = $state(false);

  // ── Context menu state ──
  let showContextMenu = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    contextMenuX = e.clientX;
    contextMenuY = e.clientY;
    showContextMenu = true;
  }

  function closeContextMenu() {
    showContextMenu = false;
  }

  function contextEdit() {
    closeContextMenu();
    startEdit();
  }

  function contextFork() {
    closeContextMenu();
    onFork?.(message.id);
  }

  function contextDelete() {
    closeContextMenu();
    onDelete?.(message.id);
  }

  // ── Markdown rendering ──
  let renderedHtml = $state('');

  // Render user message text as markdown (single blob for user messages)
  $effect(() => {
    if (message.role !== 'user') {
      renderedHtml = '';
      return;
    }
    const textContent = getTextContent();
    if (textContent) {
      renderMarkdown(textContent).then((html) => {
        renderedHtml = html;
      });
    }
  });

  // Pre-render each text block's markdown for assistant messages
  let renderedTextBlocks = $state<Map<number, string>>(new Map());

  $effect(() => {
    if (message.role !== 'assistant') return;
    const blocks = message.content as any[];
    const promises: Array<{ idx: number; promise: Promise<string> }> = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'text' && !b.parentToolUseId && b.text) {
        promises.push({ idx: i, promise: renderMarkdown(b.text) });
      }
    }
    Promise.all(promises.map(async (p) => ({ idx: p.idx, html: await p.promise }))).then(
      (results) => {
        const newMap = new Map<number, string>();
        for (const r of results) newMap.set(r.idx, r.html);
        renderedTextBlocks = newMap;
      },
    );
  });

  function getToolResults(content: any[]) {
    return content.filter((c: any) => c.type === 'tool_result');
  }

  // Group content blocks: top-level items + agent groups, preserving original order
  interface GroupedItem {
    kind: 'block';
    block: MessageContent;
    index: number;
  }
  interface GroupedAgent {
    kind: 'agent';
    taskBlock: MessageContent & { type: 'tool_use' };
    children: MessageContent[];
  }
  type GroupedEntry = GroupedItem | GroupedAgent;

  let grouped = $derived.by(() => {
    const blocks = message.content as any[];
    if (message.role !== 'assistant') return [];
    const entries: GroupedEntry[] = [];

    const agentIds = new Set<string>();
    for (const b of blocks) {
      if (b.type === 'tool_use' && b.name === 'Task' && !b.parentToolUseId) {
        agentIds.add(b.id);
      }
    }

    const childrenMap = new Map<string, MessageContent[]>();
    for (const b of blocks) {
      const pid = b.parentToolUseId;
      if (pid && agentIds.has(pid)) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(b);
      }
    }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'tool_result') continue;
      if (b.parentToolUseId && agentIds.has(b.parentToolUseId)) continue;
      if (b.type === 'tool_use' && agentIds.has(b.id)) {
        entries.push({
          kind: 'agent',
          taskBlock: b as MessageContent & { type: 'tool_use' },
          children: childrenMap.get(b.id) || [],
        });
      } else {
        entries.push({ kind: 'block', block: b, index: i });
      }
    }

    return entries;
  });
</script>

<!-- Close context menu on any click outside -->
{#if showContextMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-backdrop"
    onclick={closeContextMenu}
    oncontextmenu={(e) => {
      e.preventDefault();
      closeContextMenu();
    }}
  ></div>
{/if}

{#snippet messageHeader()}
  <div class="message-header">
    <span class="role-label">{message.role === 'user' ? 'You' : 'Claude'}</span>
    {#if message.model}
      <span class="model-label">{message.model.split('-').slice(1, 3).join(' ')}</span>
    {/if}
    <span class="timestamp">
      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
    {#if !editing}
      <div class="message-actions">
        <button class="action-btn" title="Edit" onclick={() => startEdit()}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
              d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
            />
          </svg>
        </button>
        <button class="action-btn" title="Fork from here" onclick={() => onFork?.(message.id)}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle
              cx="6"
              cy="18"
              r="3"
            /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
        </button>
        {#if conversationId}
          <ConversationBranchButton {conversationId} messageId={message.id} role={message.role} />
        {/if}
        {#if message.role === 'assistant'}
          <button
            class="action-btn action-restore"
            title={restoringSnapshot ? 'Restoring...' : 'Restore to before this message'}
            onclick={handleRestore}
            disabled={restoringSnapshot}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
          </button>
          <button
            class="btn-icon"
            class:active={ttsStore.currentId === message.id}
            onclick={() => {
              const text = message.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join(' ');
              ttsStore.toggle(text, message.id);
            }}
            title={ttsStore.currentId === message.id ? 'Stop reading' : 'Read aloud'}
          >
            {ttsStore.currentId === message.id ? '⏹' : '🔊'}
          </button>
          {#if conversationId}
            <button class="btn-icon" onclick={() => (showReplay = true)} title="Replay session"
              >▶</button
            >
          {/if}
        {/if}
        <button
          class="action-btn action-delete"
          title="Delete"
          onclick={() => onDelete?.(message.id)}
        >
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
    {/if}
  </div>
{/snippet}

{#snippet editUI()}
  <div class="edit-container">
    <textarea
      class="edit-textarea"
      bind:this={editTextarea}
      bind:value={editText}
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitEdit();
        }
        if (e.key === 'Escape') cancelEdit();
      }}
      oninput={() => {
        if (editTextarea) {
          editTextarea.style.height = 'auto';
          editTextarea.style.height = Math.min(editTextarea.scrollHeight, 400) + 'px';
        }
      }}
    ></textarea>
    <div class="edit-actions">
      <button class="edit-btn edit-cancel" onclick={cancelEdit}>Cancel</button>
      <button class="edit-btn edit-submit" onclick={submitEdit} disabled={!editText.trim()}
        >Save & Resend</button
      >
    </div>
  </div>
{/snippet}

{#snippet contextMenu()}
  {#if showContextMenu}
    <div class="context-menu" style="left: {contextMenuX}px; top: {contextMenuY}px;">
      <button class="context-item" onclick={contextEdit}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
            d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
          />
        </svg>
        Edit
      </button>
      <button class="context-item" onclick={contextFork}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle
            cx="6"
            cy="18"
            r="3"
          /><path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        Fork from here
      </button>
      <div class="context-divider"></div>
      <button class="context-item context-item-danger" onclick={contextDelete}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
          />
        </svg>
        Delete
      </button>
    </div>
  {/if}
{/snippet}

{#if message.role === 'assistant'}
  <MessageAnimation>
    {#snippet children()}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="message"
        class:user={message.role === 'user'}
        class:assistant={message.role === 'assistant'}
        class:editing
        oncontextmenu={handleContextMenu}
      >
        {@render messageHeader()}

        <div class="message-body">
          {#if editing}
            {@render editUI()}
          {:else}
            {#each grouped as entry}
              {#if entry.kind === 'agent'}
                {#if settingsStore.showToolDetails}
                  <AgentGroupStatic
                    taskBlock={entry.taskBlock}
                    children={entry.children}
                    toolResults={getToolResults(message.content)}
                  />
                {/if}
              {:else if entry.block.type === 'text' && !entry.block.parentToolUseId}
                {@const html = renderedTextBlocks.get(entry.index)}
                {#if html}
                  <div class="prose">{@html html}</div>
                {/if}
              {:else if entry.block.type === 'thinking' && settingsStore.showThinkingBlocks}
                <ThinkingBlock content={entry.block.thinking} />
              {:else if entry.block.type === 'tool_use'}
                {#if settingsStore.showToolDetails}
                  {@const toolBlock = entry.block as import('@e/shared').ToolUseContent}
                  <ToolCallBlock
                    toolName={toolBlock.name}
                    input={toolBlock.input}
                    result={getToolResults(message.content).find(
                      (r: any) => r.tool_use_id === toolBlock.id,
                    )}
                  />
                {/if}
              {/if}
            {/each}
          {/if}
        </div>
      </div>
    {/snippet}
  </MessageAnimation>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="message"
    class:user={message.role === 'user'}
    class:assistant={message.role === 'assistant'}
    class:editing
    oncontextmenu={handleContextMenu}
  >
    {@render messageHeader()}

    <div class="message-body">
      {#if editing}
        {@render editUI()}
      {:else if renderedHtml}
        <div class="prose">{@html renderedHtml}</div>
      {/if}
    </div>
  </div>
{/if}

{@render contextMenu()}

{#if showReplay && conversationId}
  <ReplayModal {conversationId} onClose={() => (showReplay = false)} />
{/if}

<style>
  .message {
    padding: var(--ht-msg-padding);
    max-width: 900px;
    margin: 0 auto;
    animation: fadeIn 0.2s linear;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    position: relative;
  }

  .message.user {
    background: var(--bg-message-user);
    margin-left: 28px;
    margin-right: 28px;
    margin-bottom: 2px;
    border-left: var(--ht-msg-border-width) var(--ht-msg-border-style) var(--border-primary);
  }
  .message.user:hover {
    background: var(--bg-hover);
    border-left-color: var(--accent-primary);
  }

  .message.assistant {
    background: var(--bg-message-assistant);
    margin-left: 28px;
    margin-right: 28px;
    margin-bottom: 2px;
    border-left: var(--ht-msg-border-width) var(--ht-msg-border-style) var(--border-secondary);
  }
  .message.assistant:hover {
    background: var(--bg-hover);
    border-left-color: var(--accent-primary);
  }

  .message.editing {
    border-left-color: var(--accent-primary);
  }

  /* ── Hypertheme message variants ── */

  /* Ethereal: no left border, floating card with glow halo */
  :global([data-hypertheme='ethereal']) .message {
    border-radius: var(--radius-lg);
    border-left: none !important;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }
  :global([data-hypertheme='ethereal']) .message:hover {
    box-shadow:
      0 4px 20px rgba(0, 0, 0, 0.2),
      0 0 20px rgba(160, 120, 240, 0.06);
    transform: translateY(-1px);
  }

  /* Arcane: thick double left border, ornate feel */
  :global([data-hypertheme='arcane']) .message {
    border: 1px solid var(--border-secondary);
    border-left: 3px double var(--border-primary);
  }
  :global([data-hypertheme='arcane']) .message:hover {
    border-color: var(--border-primary);
    border-left-color: var(--accent-primary);
    box-shadow: inset 0 0 20px rgba(139, 92, 246, 0.04);
  }

  /* Study: warm ember glow, subtle left accent */
  :global([data-hypertheme='study']) .message {
    border: 1px solid var(--border-secondary);
    border-left: 3px solid var(--border-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  :global([data-hypertheme='study']) .message:hover {
    border-left-color: var(--accent-primary);
    box-shadow:
      0 2px 12px rgba(0, 0, 0, 0.2),
      0 0 20px rgba(228, 160, 60, 0.06);
  }

  /* Astral: thin luminous top-border, clean geometric */
  :global([data-hypertheme='astral']) .message,
  :global([data-hypertheme='astral-midnight']) .message {
    border-left: none;
    border-top: 1px solid var(--border-secondary);
    border-bottom: none;
  }
  :global([data-hypertheme='astral']) .message.user,
  :global([data-hypertheme='astral-midnight']) .message.user {
    border-left: none;
    border-top-color: var(--border-primary);
  }
  :global([data-hypertheme='astral']) .message.assistant,
  :global([data-hypertheme='astral-midnight']) .message.assistant {
    border-left: none;
    border-top-color: var(--border-secondary);
  }
  :global([data-hypertheme='astral']) .message:hover,
  :global([data-hypertheme='astral-midnight']) .message:hover {
    border-top-color: var(--accent-primary);
    box-shadow: 0 0 15px rgba(140, 160, 220, 0.05);
  }

  /* ── Header ── */

  .message-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    font-size: 12px;
  }

  .role-label {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }
  .user .role-label {
    color: var(--accent-primary);
    text-shadow: var(--shadow-glow-sm);
  }
  .assistant .role-label {
    color: var(--accent-secondary);
    text-shadow: var(--shadow-glow-sm);
  }

  .model-label {
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing);
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-transform: var(--ht-label-transform);
  }

  .timestamp {
    color: var(--text-tertiary);
    margin-left: auto;
    font-size: 10px;
    font-family: var(--font-family);
    opacity: 0;
    transition: opacity var(--transition);
  }
  .message:hover .timestamp {
    opacity: 1;
  }

  /* ── Hover action buttons ── */

  .message-actions {
    display: none;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
  }
  .message:hover .message-actions {
    display: flex;
  }
  .message:hover :global(.branch-btn) {
    opacity: 1;
  }

  .action-btn {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all var(--transition);
    padding: 0;
  }
  .action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .action-delete:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }
  .action-restore:hover {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
  }
  .action-restore:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-icon {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all var(--transition);
    padding: 0;
    font-size: 12px;
  }
  .btn-icon:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .btn-icon.active {
    color: var(--accent-primary);
  }

  /* ── Inline edit ── */

  .edit-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .edit-textarea {
    width: 100%;
    min-height: 60px;
    max-height: 400px;
    padding: 10px 12px;
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
    line-height: 1.6;
    background: var(--bg-input);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    resize: vertical;
    outline: none;
  }
  .edit-textarea:focus {
    box-shadow: var(--shadow-glow-sm);
  }
  .edit-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .edit-btn {
    padding: 4px 14px;
    font-size: 12px;
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
  }
  .edit-cancel {
    background: transparent;
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
  }
  .edit-cancel:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }
  .edit-submit {
    background: var(--accent-primary);
    border: 1px solid var(--accent-primary);
    color: var(--bg-primary);
  }
  .edit-submit:hover:not(:disabled) {
    filter: brightness(1.1);
    box-shadow: var(--shadow-glow-sm);
  }
  .edit-submit:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ── Context menu ── */

  .context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    padding: 4px;
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.3));
    animation: fadeIn 0.1s linear;
  }

  .context-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    text-align: left;
  }
  .context-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .context-item-danger:hover {
    color: var(--accent-error);
  }

  .context-divider {
    height: 1px;
    background: var(--border-secondary);
    margin: 4px 6px;
  }

  /* ── Body & prose ── */

  .message-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .prose {
    line-height: 1.7;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
  }

  .prose :global(p) {
    margin-bottom: 10px;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }
  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 20px;
    margin-bottom: 10px;
  }
  .prose :global(li) {
    margin-bottom: 4px;
  }
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    margin: 20px 0 10px;
    font-family: var(--font-family-sans);
    color: var(--accent-primary);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }
  .prose :global(h1) {
    font-size: 1.4em;
    font-weight: var(--ht-prose-heading-weight);
  }
  .prose :global(h2) {
    font-size: 1.2em;
    font-weight: var(--ht-prose-heading-weight);
  }
  .prose :global(h3) {
    font-size: 1.05em;
    font-weight: var(--ht-prose-heading-weight);
  }
  .prose :global(blockquote) {
    border-left: 2px solid var(--accent-primary);
    padding-left: 14px;
    color: var(--text-secondary);
    margin: 10px 0;
    font-style: normal;
  }
  .prose :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
  }
  .prose :global(th),
  .prose :global(td) {
    border: 1px solid var(--border-primary);
    padding: 8px 14px;
    text-align: left;
  }
  .prose :global(th) {
    background: var(--bg-tertiary);
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    font-size: 12px;
  }
  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--border-primary);
    margin: 20px 0;
  }
  .prose :global(strong) {
    font-weight: 700;
    color: var(--accent-primary);
  }
  .prose :global(em) {
    color: var(--text-secondary);
  }
</style>
