<script lang="ts">
  import type { Message, MessageContent } from '@maude/shared';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import CodeBlock from './CodeBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import AgentGroupStatic from './AgentGroupStatic.svelte';
  import MessageAnimation from './MessageAnimation.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';

  let { message } = $props<{ message: Message }>();

  let renderedHtml = $state('');

  // Render user message text as markdown (single blob for user messages)
  $effect(() => {
    if (message.role !== 'user') {
      renderedHtml = '';
      return;
    }
    const textContent = (message.content as any[])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text as string)
      .join('\n\n');

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
  // Text blocks are now included so they render interleaved with tool calls.
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

    // Collect agent task block IDs (top-level Task tool_use blocks)
    const agentIds = new Set<string>();
    for (const b of blocks) {
      if (b.type === 'tool_use' && b.name === 'Task' && !b.parentToolUseId) {
        agentIds.add(b.id);
      }
    }

    // Group children by parent
    const childrenMap = new Map<string, MessageContent[]>();
    for (const b of blocks) {
      const pid = b.parentToolUseId;
      if (pid && agentIds.has(pid)) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(b);
      }
    }

    // Build entries in original order — include text blocks for interleaved rendering
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

{#if message.role === 'assistant'}
  <MessageAnimation>
    {#snippet children()}
      <div
        class="message"
        class:user={message.role === 'user'}
        class:assistant={message.role === 'assistant'}
      >
        <div class="message-header">
          <span class="role-label">{message.role === 'user' ? 'You' : 'Claude'}</span>
          {#if message.model}
            <span class="model-label">{message.model.split('-').slice(1, 3).join(' ')}</span>
          {/if}
          <span class="timestamp">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        <div class="message-body">
          {#if message.role === 'user'}
            {#if renderedHtml}
              <div class="prose">{@html renderedHtml}</div>
            {/if}
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
                  {@const toolBlock = entry.block as import('@maude/shared').ToolUseContent}
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
  <div
    class="message"
    class:user={message.role === 'user'}
    class:assistant={message.role === 'assistant'}
  >
    <div class="message-header">
      <span class="role-label">{message.role === 'user' ? 'You' : 'Claude'}</span>
      {#if message.model}
        <span class="model-label">{message.model.split('-').slice(1, 3).join(' ')}</span>
      {/if}
      <span class="timestamp">
        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>

    <div class="message-body">
      {#if renderedHtml}
        <div class="prose">{@html renderedHtml}</div>
      {/if}
    </div>
  </div>
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

  /* Study: thick left border, inset book-page feel */
  :global([data-hypertheme='study']) .message {
    border: 2px solid var(--border-secondary);
    border-left: 4px solid var(--border-primary);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  :global([data-hypertheme='study']) .message:hover {
    border-left-color: var(--accent-primary);
    box-shadow:
      inset 0 1px 3px rgba(0, 0, 0, 0.1),
      0 0 8px rgba(218, 165, 50, 0.08);
  }

  /* Astral: thin luminous top-border, clean geometric */
  :global([data-hypertheme='astral']) .message {
    border-left: none;
    border-top: 1px solid var(--border-secondary);
    border-bottom: none;
  }
  :global([data-hypertheme='astral']) .message.user {
    border-left: none;
    border-top-color: var(--border-primary);
  }
  :global([data-hypertheme='astral']) .message.assistant {
    border-left: none;
    border-top-color: var(--border-secondary);
  }
  :global([data-hypertheme='astral']) .message:hover {
    border-top-color: var(--accent-primary);
    box-shadow: 0 0 15px rgba(140, 160, 220, 0.05);
  }

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

  .message-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .prose {
    line-height: 1.7;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    font-size: 14px;
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
