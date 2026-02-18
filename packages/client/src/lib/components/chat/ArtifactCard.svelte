<script lang="ts">
  import type { Artifact } from '@e/shared';
  import { artifactsStore } from '$lib/stores/artifacts.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';

  let { artifact }: { artifact: Artifact } = $props();

  let expanded = $state(false);
  let renderedContent = $state('');

  $effect(() => {
    if (expanded && artifact.content) {
      // Render plan/walkthrough as markdown, show diff/screenshot raw
      if (artifact.type === 'plan' || artifact.type === 'walkthrough') {
        renderMarkdown(artifact.content).then((html) => {
          renderedContent = html;
        });
      } else {
        renderedContent = '';
      }
    }
  });

  function toggleExpand() {
    expanded = !expanded;
  }

  async function togglePin() {
    await artifactsStore.togglePin(artifact.id);
  }

  const typeIcons: Record<string, string> = {
    plan: '📋',
    diff: '📝',
    screenshot: '🖼',
    walkthrough: '🚶',
  };

  const typeLabels: Record<string, string> = {
    plan: 'Plan',
    diff: 'Diff',
    screenshot: 'Screenshot',
    walkthrough: 'Walkthrough',
  };
</script>

<div class="artifact-card" class:expanded>
  <!-- Header row -->
  <button class="artifact-header" onclick={toggleExpand}>
    <span class="artifact-icon">{typeIcons[artifact.type] ?? '📄'}</span>
    <span class="artifact-type-badge">{typeLabels[artifact.type] ?? artifact.type}</span>
    <span class="artifact-title">{artifact.title}</span>
    <span class="artifact-chevron" class:rotated={expanded}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </span>
  </button>

  <!-- Pin button -->
  <button
    class="artifact-pin-btn"
    class:pinned={artifact.pinned}
    onclick={togglePin}
    title={artifact.pinned ? 'Unpin artifact' : 'Pin artifact'}
  >
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill={artifact.pinned ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
      <circle cx="12" cy="10" r="3"></circle>
    </svg>
  </button>

  <!-- Expandable body -->
  {#if expanded}
    <div class="artifact-body">
      {#if artifact.type === 'diff'}
        <pre class="artifact-diff">{artifact.content}</pre>
      {:else if artifact.type === 'plan' || artifact.type === 'walkthrough'}
        {#if renderedContent}
          <div class="prose artifact-prose">{@html renderedContent}</div>
        {:else}
          <pre class="artifact-raw">{artifact.content}</pre>
        {/if}
      {:else}
        <pre class="artifact-raw">{artifact.content}</pre>
      {/if}
    </div>
  {/if}
</div>

<style>
  .artifact-card {
    position: relative;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color var(--transition);
  }

  .artifact-card:hover {
    border-color: var(--border-primary);
  }

  .artifact-card.expanded {
    border-color: var(--accent-primary);
  }

  .artifact-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    transition: background var(--transition);
    padding-right: 32px; /* room for pin button */
  }

  .artifact-header:hover {
    background: var(--bg-hover);
  }

  .artifact-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .artifact-type-badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: var(--radius-sm);
    padding: 1px 6px;
    flex-shrink: 0;
  }

  .artifact-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .artifact-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
    display: flex;
    align-items: center;
  }

  .artifact-chevron.rotated {
    transform: rotate(180deg);
  }

  .artifact-pin-btn {
    position: absolute;
    top: 6px;
    right: 8px;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .artifact-pin-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .artifact-pin-btn.pinned {
    color: var(--accent-primary);
  }

  .artifact-body {
    border-top: 1px solid var(--border-secondary);
    padding: 12px;
    max-height: 400px;
    overflow-y: auto;
  }

  .artifact-diff {
    font-family: var(--font-family-mono, monospace);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }

  .artifact-raw {
    font-family: var(--font-family-mono, monospace);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  .artifact-prose {
    font-family: var(--font-family-sans);
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-primary);
  }

  .artifact-prose :global(p) {
    margin-bottom: 8px;
  }
  .artifact-prose :global(p:last-child) {
    margin-bottom: 0;
  }
  .artifact-prose :global(ul),
  .artifact-prose :global(ol) {
    padding-left: 18px;
    margin-bottom: 8px;
  }
  .artifact-prose :global(li) {
    margin-bottom: 3px;
  }
  .artifact-prose :global(h1),
  .artifact-prose :global(h2),
  .artifact-prose :global(h3) {
    margin: 12px 0 6px;
    color: var(--accent-primary);
    font-size: 1em;
    font-weight: 700;
  }
  .artifact-prose :global(code) {
    font-family: var(--font-family-mono, monospace);
    font-size: 11px;
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .artifact-prose :global(pre) {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px;
    overflow-x: auto;
    margin: 8px 0;
  }
</style>
