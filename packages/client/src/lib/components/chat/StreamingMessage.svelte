<script lang="ts">
  import type { MessageContent } from '@maude/shared';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { renderMarkdownPartial } from '$lib/utils/markdown';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import ToolApprovalDialog from './ToolApprovalDialog.svelte';
  import AgentGroup from './AgentGroup.svelte';
  import StreamingText from './StreamingText.svelte';
  import MessageAnimation from './MessageAnimation.svelte';
  import ToolCallTracker from './ToolCallTracker.svelte';

  // Build a grouped view: top-level blocks + agent groups.
  // A "Task" tool_use block becomes an agent header, and all blocks
  // whose parentToolUseId matches its id are its children.
  interface GroupedItem {
    kind: 'block';
    block: MessageContent;
    index: number;
  }
  interface GroupedAgent {
    kind: 'agent';
    taskBlock: MessageContent & { type: 'tool_use' };
    children: MessageContent[];
    lastChildIndex: number;
  }
  type GroupedEntry = GroupedItem | GroupedAgent;

  let grouped = $derived.by(() => {
    const blocks = streamStore.contentBlocks;
    console.log('[StreamingMessage] $derived recalculating, blocks.length:', blocks.length);
    const entries: GroupedEntry[] = [];

    // Collect all agent task block IDs
    const agentIds = new Set<string>();
    for (const b of blocks) {
      if (
        b.type === 'tool_use' &&
        b.name === 'Task' &&
        !('parentToolUseId' in b && b.parentToolUseId)
      ) {
        agentIds.add(b.id);
      }
    }

    // Group children by parent
    const childrenMap = new Map<string, MessageContent[]>();
    const lastChildIndexMap = new Map<string, number>();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const pid = 'parentToolUseId' in b ? (b as any).parentToolUseId : undefined;
      if (pid && agentIds.has(pid)) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(b);
        lastChildIndexMap.set(pid, i);
      }
    }

    // Build entries
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const pid = 'parentToolUseId' in b ? (b as any).parentToolUseId : undefined;
      if (pid && agentIds.has(pid)) {
        // Skip — rendered inside agent group
        continue;
      }
      if (b.type === 'tool_use' && agentIds.has(b.id)) {
        entries.push({
          kind: 'agent',
          taskBlock: b as MessageContent & { type: 'tool_use' },
          children: childrenMap.get(b.id) || [],
          lastChildIndex: lastChildIndexMap.get(b.id) ?? i,
        });
      } else {
        entries.push({ kind: 'block', block: b, index: i });
      }
    }

    return entries;
  });

  let totalBlocks = $derived(streamStore.contentBlocks.length);
</script>

<MessageAnimation>
  {#snippet children()}
    <div class="message assistant streaming">
      <div class="message-header">
        <span class="role-label">Claude</span>
        <span class="streaming-indicator">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </span>
      </div>

      <div class="message-body">
        <!-- Tool call tracker for progress visibility -->
        <ToolCallTracker />

        {#each grouped as entry}
          {#if entry.kind === 'agent'}
            <AgentGroup
              taskBlock={entry.taskBlock}
              children={entry.children}
              streaming={entry.lastChildIndex === totalBlocks - 1}
            />
          {:else if entry.block.type === 'thinking' && settingsStore.showThinkingBlocks}
            <ThinkingBlock content={entry.block.thinking} streaming={entry.index === totalBlocks - 1} />
          {:else if entry.block.type === 'text' && entry.block.text}
            {@const isStreaming = entry.index === totalBlocks - 1}
            <StreamingText text={entry.block.text} streaming={isStreaming} />
          {:else if entry.block.type === 'tool_use'}
            {@const hasResult = streamStore.toolResults.has(entry.block.id)}
            {@const isLast = entry.index === totalBlocks - 1}
            <ToolCallBlock
              toolName={entry.block.name}
              input={entry.block.input}
              result={hasResult
                ? {
                    content: streamStore.toolResults.get(entry.block.id)!.result,
                    is_error: streamStore.toolResults.get(entry.block.id)!.isError,
                  }
                : undefined}
              running={!hasResult && isLast}
            />
          {/if}
        {/each}

        {#each streamStore.pendingApprovals as approval}
          <ToolApprovalDialog
            toolCallId={approval.toolCallId}
            toolName={approval.toolName}
            input={approval.input}
            description={approval.description}
          />
        {/each}
      </div>
    </div>
  {/snippet}
</MessageAnimation>

<style>
  .message {
    padding: 16px 28px;
    max-width: 900px;
    margin: 0 auto;
    animation: fadeIn 0.2s linear;
    border-radius: 0;
  }

  .message.assistant {
    background: var(--bg-message-assistant);
    margin-left: 28px;
    margin-right: 28px;
    position: relative;
    border-left: 2px solid var(--accent-primary);
  }
  /* Shield charge bar on active streaming */
  .message.assistant::before {
    content: '';
    position: absolute;
    left: -2px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: linear-gradient(180deg, transparent, var(--accent-primary), transparent);
    background-size: 100% 200%;
    animation: shieldCharge 1.5s linear infinite;
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
    color: var(--accent-secondary);
    text-shadow: 0 0 8px rgba(0, 255, 136, 0.3);
  }

  .streaming-indicator {
    display: flex;
    gap: 3px;
    align-items: center;
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: 0;
    background: var(--accent-primary);
    box-shadow: 0 0 4px rgba(0, 180, 255, 0.4);
    animation: hudPulse 1.2s infinite linear;
  }
  .dot:nth-child(1) {
    animation-delay: 0s;
  }
  .dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes hudPulse {
    0%,
    100% {
      opacity: 0.2;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1);
      box-shadow: 0 0 8px rgba(0, 180, 255, 0.6);
    }
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

  @keyframes shieldCharge {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 0% 100%;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
