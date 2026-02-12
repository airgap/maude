<script lang="ts">
  import type { Message, MessageContent } from '@maude/shared';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import CodeBlock from './CodeBlock.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import AgentGroupStatic from './AgentGroupStatic.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';

  let { message } = $props<{ message: Message }>();

  let renderedHtml = $state('');

  // Render text blocks as markdown
  $effect(() => {
    const textContent = (message.content as any[])
      .filter((c: any) => c.type === 'text' && !c.parentToolUseId)
      .map((c: any) => c.text as string)
      .join('\n\n');

    if (textContent) {
      renderMarkdown(textContent).then((html) => {
        renderedHtml = html;
      });
    }
  });

  function getToolResults(content: any[]) {
    return content.filter((c: any) => c.type === 'tool_result');
  }

  // Group content blocks: top-level items + agent groups
  interface GroupedItem {
    kind: 'block';
    block: MessageContent;
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

    // Build entries — skip child blocks, tool_results, and top-level text (rendered separately)
    for (const b of blocks) {
      if (b.type === 'tool_result') continue;
      if (b.type === 'text' && !b.parentToolUseId) continue;
      if (b.parentToolUseId && agentIds.has(b.parentToolUseId)) continue;
      if (b.type === 'tool_use' && agentIds.has(b.id)) {
        entries.push({
          kind: 'agent',
          taskBlock: b as MessageContent & { type: 'tool_use' },
          children: childrenMap.get(b.id) || [],
        });
      } else {
        entries.push({ kind: 'block', block: b });
      }
    }

    return entries;
  });
</script>

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
    {#if message.role === 'user'}
      {#if renderedHtml}
        <div class="prose">{@html renderedHtml}</div>
      {/if}
    {:else}
      {#if renderedHtml}
        <div class="prose">{@html renderedHtml}</div>
      {/if}
      {#each grouped as entry}
        {#if entry.kind === 'agent'}
          {#if settingsStore.showToolDetails}
            <AgentGroupStatic
              taskBlock={entry.taskBlock}
              children={entry.children}
              toolResults={getToolResults(message.content)}
            />
          {/if}
        {:else if entry.block.type === 'thinking' && settingsStore.showThinkingBlocks}
          <ThinkingBlock content={entry.block.thinking} />
        {:else if entry.block.type === 'tool_use'}
          {#if settingsStore.showToolDetails}
            <ToolCallBlock
              toolName={entry.block.name}
              input={entry.block.input}
              result={getToolResults(message.content).find(
                (r: any) => r.tool_use_id === entry.block.id,
              )}
            />
          {/if}
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .message {
    padding: 16px 28px;
    max-width: 900px;
    margin: 0 auto;
    animation: fadeIn 0.2s linear;
    border-radius: 0;
    transition: background var(--transition);
    position: relative;
  }

  .message.user {
    background: var(--bg-message-user);
    margin-left: 28px;
    margin-right: 28px;
    margin-bottom: 2px;
    border-left: 2px solid rgba(0, 180, 255, 0.2);
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
    border-left: 2px solid rgba(0, 180, 255, 0.1);
  }
  .message.assistant:hover {
    background: var(--bg-hover);
    border-left-color: var(--accent-primary);
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
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }
  .user .role-label {
    color: var(--accent-primary);
    text-shadow: 0 0 8px rgba(0, 180, 255, 0.3);
  }
  .assistant .role-label {
    color: var(--accent-secondary);
    text-shadow: 0 0 8px rgba(0, 255, 136, 0.3);
  }

  .model-label {
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 0;
    text-transform: uppercase;
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
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .prose :global(h1) {
    font-size: 1.4em;
    font-weight: 700;
  }
  .prose :global(h2) {
    font-size: 1.2em;
    font-weight: 700;
  }
  .prose :global(h3) {
    font-size: 1.05em;
    font-weight: 600;
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
    text-transform: uppercase;
    letter-spacing: 0.5px;
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
