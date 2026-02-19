<script lang="ts">
  import type { TerminalCommandBlock } from '@e/shared';
  import { terminalStore } from '$lib/stores/terminal.svelte';

  let {
    sessionId,
    blocks,
    cellHeight,
    cellWidth,
    viewportTopRow,
    viewportRows,
    terminalElement,
  } = $props<{
    sessionId: string;
    blocks: TerminalCommandBlock[];
    cellHeight: number;
    cellWidth: number;
    viewportTopRow: number;
    viewportRows: number;
    terminalElement: HTMLElement | null;
  }>();

  /** Copy command output text to clipboard */
  async function copyBlockOutput(block: TerminalCommandBlock) {
    if (!terminalElement) return;

    // Build output text from the block's command + exit info
    let text = `$ ${block.commandText}\n`;
    // We can't easily extract output from xterm buffer here,
    // so we copy the command text and exit code as a summary
    if (block.exitCode !== null) {
      text += `[exit code: ${block.exitCode}]`;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API may fail
    }
  }

  /** Blocks that are visible in the current viewport */
  const visibleBlocks = $derived.by(() => {
    if (!blocks.length || cellHeight <= 0) return [];

    const vpBottom = viewportTopRow + viewportRows;

    return blocks
      .map((block: TerminalCommandBlock) => {
        const blockStart = block.startRow;
        // For in-progress blocks, extend to viewport bottom
        const blockEnd = block.endRow >= 0 ? block.endRow : vpBottom;

        // Check if block overlaps viewport
        if (blockEnd < viewportTopRow || blockStart > vpBottom) {
          return null;
        }

        // Calculate pixel positions relative to viewport
        const topRow = Math.max(blockStart, viewportTopRow);
        const bottomRow = Math.min(blockEnd, vpBottom);
        const topPx = (topRow - viewportTopRow) * cellHeight;
        const heightPx = (bottomRow - topRow) * cellHeight;

        // Header is above the output area (at the command line)
        const headerTopPx = (blockStart - viewportTopRow) * cellHeight;
        const isHeaderVisible = blockStart >= viewportTopRow && blockStart <= vpBottom;

        return {
          block,
          topPx,
          heightPx,
          headerTopPx,
          isHeaderVisible,
          isRunning: block.exitCode === null,
        };
      })
      .filter(Boolean) as Array<{
      block: TerminalCommandBlock;
      topPx: number;
      heightPx: number;
      headerTopPx: number;
      isHeaderVisible: boolean;
      isRunning: boolean;
    }>;
  });
</script>

{#if visibleBlocks.length > 0}
  <div class="command-block-overlay" aria-hidden="true">
    {#each visibleBlocks as { block, headerTopPx, isHeaderVisible, isRunning }}
      {#if isHeaderVisible}
        <div
          class="command-block"
          class:collapsed={block.collapsed}
          class:running={isRunning}
          class:success={block.exitCode === 0}
          class:failure={block.exitCode !== null && block.exitCode !== 0}
          style="top: {headerTopPx}px"
        >
          <!-- Block header -->
          <div class="block-header">
            <button
              class="collapse-toggle"
              onclick={() => terminalStore.toggleBlockCollapse(sessionId, block.id)}
              title={block.collapsed ? 'Expand output' : 'Collapse output'}
              aria-label={block.collapsed ? 'Expand command output' : 'Collapse command output'}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                class="chevron"
                class:rotated={!block.collapsed}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <span class="command-text" title={block.commandText}>
              <span class="prompt-symbol">$</span>
              {block.commandText || '...'}
            </span>

            <!-- Exit code badge -->
            {#if block.exitCode !== null}
              <span
                class="exit-badge"
                class:exit-success={block.exitCode === 0}
                class:exit-failure={block.exitCode !== 0}
                title={block.exitCode === 0 ? 'Success' : `Exit code ${block.exitCode}`}
              >
                {#if block.exitCode === 0}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                {:else}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span class="exit-code-num">{block.exitCode}</span>
                {/if}
              </span>
            {:else}
              <span class="running-indicator" title="Running...">
                <span class="running-dot"></span>
              </span>
            {/if}

            <!-- Copy button -->
            <button
              class="copy-btn"
              onclick={() => copyBlockOutput(block)}
              title="Copy command"
              aria-label="Copy command to clipboard"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .command-block-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 5;
    overflow: hidden;
  }

  .command-block {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
  }

  .block-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 8px;
    height: 20px;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 85%, transparent);
    border-left: 2px solid transparent;
    border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0;
    font-family: var(--font-family-mono, monospace);
    font-size: 11px;
    line-height: 1;
    transition: background var(--transition), border-color var(--transition);
  }

  .command-block.success .block-header {
    border-left-color: var(--accent-secondary, #00ff88);
  }

  .command-block.failure .block-header {
    border-left-color: var(--accent-error, #ff3344);
  }

  .command-block.running .block-header {
    border-left-color: var(--accent-primary, #00b4ff);
  }

  .block-header:hover {
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 95%, transparent);
  }

  .collapse-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    flex-shrink: 0;
    transition: color var(--transition), background var(--transition);
  }

  .collapse-toggle:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .chevron {
    transition: transform 0.15s ease;
  }

  .chevron.rotated {
    transform: rotate(90deg);
  }

  .command-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary, #8b949e);
  }

  .prompt-symbol {
    color: var(--accent-primary, #00b4ff);
    margin-right: 4px;
    font-weight: 600;
  }

  .exit-badge {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px;
    border-radius: var(--radius-sm, 4px);
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .exit-badge.exit-success {
    color: var(--accent-secondary, #00ff88);
    background: color-mix(in srgb, var(--accent-secondary, #00ff88) 12%, transparent);
  }

  .exit-badge.exit-failure {
    color: var(--accent-error, #ff3344);
    background: color-mix(in srgb, var(--accent-error, #ff3344) 12%, transparent);
  }

  .exit-code-num {
    font-size: 9px;
  }

  .running-indicator {
    display: flex;
    align-items: center;
    padding: 1px 4px;
    flex-shrink: 0;
  }

  .running-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary, #00b4ff);
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  .copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 16px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--transition), color var(--transition), background var(--transition);
  }

  .block-header:hover .copy-btn {
    opacity: 1;
  }

  .copy-btn:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }
</style>
