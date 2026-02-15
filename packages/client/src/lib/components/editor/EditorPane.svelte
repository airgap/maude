<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import EditorTabBar from './EditorTabBar.svelte';
  import EditorBreadcrumb from './EditorBreadcrumb.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import TerminalPanel from './TerminalPanel.svelte';

  let resizingTerminal = $state(false);
  let startY = 0;
  let startHeight = 0;

  function onTerminalResizeStart(e: MouseEvent) {
    resizingTerminal = true;
    startY = e.clientY;
    startHeight = terminalStore.panelHeight;
    document.addEventListener('mousemove', onTerminalResizeMove);
    document.addEventListener('mouseup', onTerminalResizeEnd);
  }

  function onTerminalResizeMove(e: MouseEvent) {
    if (!resizingTerminal) return;
    const delta = startY - e.clientY;
    terminalStore.setPanelHeight(startHeight + delta);
  }

  function onTerminalResizeEnd() {
    resizingTerminal = false;
    document.removeEventListener('mousemove', onTerminalResizeMove);
    document.removeEventListener('mouseup', onTerminalResizeEnd);
  }
</script>

<div class="editor-pane" class:resizing-terminal={resizingTerminal}>
  <div class="editor-area">
    {#if editorStore.hasOpenTabs}
      <EditorTabBar />
      <EditorBreadcrumb />
      {#if editorStore.activeTab}
        {#key editorStore.activeTabId}
          <CodeEditor tab={editorStore.activeTab} />
        {/key}
      {/if}
    {:else}
      <div class="empty-state">
        <div class="empty-icon">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <p class="empty-text">Open a file from the sidebar</p>
        <p class="empty-hint">Click a file or use Ctrl+P to quick open</p>
      </div>
    {/if}
  </div>

  {#if terminalStore.isOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="terminal-resize-handle" onmousedown={onTerminalResizeStart}></div>
    <TerminalPanel />
  {/if}
</div>

<style>
  .editor-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-code);
  }

  .editor-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .terminal-resize-handle {
    height: 3px;
    cursor: row-resize;
    background: transparent;
    flex-shrink: 0;
    transition: background var(--transition);
  }
  .terminal-resize-handle:hover,
  .resizing-terminal .terminal-resize-handle {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-tertiary);
  }

  .empty-icon {
    opacity: 0.3;
    margin-bottom: 8px;
  }

  .empty-text {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .empty-hint {
    font-size: 12px;
    opacity: 0.6;
  }
</style>
