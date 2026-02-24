<script lang="ts">
  import { onMount } from 'svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { canvasStore } from '$lib/stores/canvas.svelte';
  import CanvasRenderer from '../canvas/CanvasRenderer.svelte';

  let expandedId = $state<string | null>(null);
  let fullscreenId = $state<string | null>(null);

  const conversationId = $derived(conversationStore.activeId);
  const canvases = $derived(canvasStore.current);

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function openFullscreen(id: string) {
    fullscreenId = id;
  }

  function closeFullscreen() {
    fullscreenId = null;
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Update canvas store when conversation changes
  $effect(() => {
    canvasStore.setConversation(conversationId);
  });
</script>

<div class="canvas-panel">
  <div class="panel-header">
    <span class="panel-title">Canvas</span>
    <span class="panel-count">{canvases.length}</span>
  </div>

  <div class="canvas-list">
    {#if !conversationId}
      <div class="empty-state">Open a conversation to see canvas visualizations.</div>
    {:else if canvases.length === 0}
      <div class="empty-state">
        No canvas content yet. Agents can push visual content using the <code>canvas_push</code> tool
        to create diagrams, charts, UI previews, and data visualizations.
      </div>
    {:else}
      {#each canvases as canvas (canvas.id)}
        <div class="canvas-item" class:expanded={expandedId === canvas.id}>
          <!-- Header row -->
          <div class="canvas-item-header">
            <button class="canvas-expand-btn" onclick={() => toggleExpand(canvas.id)}>
              <span class="canvas-icon">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <line x1="9" y1="21" x2="9" y2="9"></line>
                </svg>
              </span>
              <span class="canvas-type-badge">{canvas.contentType}</span>
              <span class="canvas-name">{canvas.title || 'Untitled Canvas'}</span>
              <span class="canvas-chevron" class:rotated={expandedId === canvas.id}>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </span>
            </button>
            <div class="canvas-actions">
              <button
                class="canvas-action-btn"
                onclick={() => openFullscreen(canvas.id)}
                title="Open fullscreen"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
                  ></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- Meta row -->
          <div class="canvas-meta">
            <span class="canvas-date">{formatDate(canvas.lastUpdated)}</span>
          </div>

          <!-- Preview -->
          {#if expandedId === canvas.id}
            <div class="canvas-preview">
              <CanvasRenderer
                contentType={canvas.contentType}
                content={canvas.content}
                canvasId={canvas.id}
              />
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- Fullscreen modal -->
{#if fullscreenId}
  {@const canvas = canvases.find((c) => c.id === fullscreenId)}
  {#if canvas}
    <div class="canvas-fullscreen-overlay" onclick={closeFullscreen}>
      <div class="canvas-fullscreen-modal" onclick={(e) => e.stopPropagation()}>
        <div class="canvas-fullscreen-header">
          <h2>{canvas.title || 'Canvas'}</h2>
          <button class="canvas-close-btn" onclick={closeFullscreen}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="canvas-fullscreen-content">
          <CanvasRenderer
            contentType={canvas.contentType}
            content={canvas.content}
            canvasId={canvas.id}
          />
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .canvas-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 8px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }

  .panel-count {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 10px;
    padding: 0 6px;
    min-width: 18px;
    text-align: center;
  }

  .canvas-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .empty-state {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 24px 16px;
    line-height: 1.6;
  }

  .empty-state code {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    background: var(--bg-tertiary);
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--accent-primary);
  }

  .canvas-item {
    border-bottom: 1px solid var(--border-secondary);
    transition: background var(--transition);
  }

  .canvas-item:hover {
    background: var(--bg-hover);
  }

  .canvas-item.expanded {
    background: var(--bg-hover);
  }

  .canvas-item-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 0 0;
  }

  .canvas-expand-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    padding: 8px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    min-width: 0;
  }

  .canvas-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .canvas-type-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .canvas-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .canvas-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
    display: flex;
    align-items: center;
  }

  .canvas-chevron.rotated {
    transform: rotate(180deg);
  }

  .canvas-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .canvas-action-btn {
    width: 20px;
    height: 20px;
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

  .canvas-action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-secondary);
  }

  .canvas-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 6px;
  }

  .canvas-date {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .canvas-preview {
    padding: 10px;
    max-height: 300px;
    overflow: auto;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    margin: 0 10px 10px;
  }

  /* Fullscreen modal */
  .canvas-fullscreen-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .canvas-fullscreen-modal {
    background: var(--bg-primary);
    border-radius: var(--radius-lg);
    width: 90%;
    max-width: 1200px;
    height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }

  .canvas-fullscreen-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-secondary);
  }

  .canvas-fullscreen-header h2 {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .canvas-close-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-secondary);
    transition: all var(--transition);
  }

  .canvas-close-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-primary);
    color: var(--text-primary);
  }

  .canvas-fullscreen-content {
    flex: 1;
    overflow: auto;
    padding: 20px;
  }
</style>
