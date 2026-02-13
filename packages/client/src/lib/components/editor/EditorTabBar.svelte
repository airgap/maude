<script lang="ts">
  import { editorStore, type EditorTab } from '$lib/stores/editor.svelte';

  function closeTab(e: MouseEvent, tab: EditorTab) {
    e.stopPropagation();
    if (editorStore.isDirty(tab.id)) {
      if (!confirm(`${tab.fileName} has unsaved changes. Close anyway?`)) return;
    }
    editorStore.closeTab(tab.id);
  }
</script>

<div class="tab-bar">
  <div class="tabs-scroll">
    {#each editorStore.tabs as tab (tab.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="editor-tab"
        class:active={tab.id === editorStore.activeTabId}
        class:preview={tab.id === editorStore.previewTabId}
        class:dirty={editorStore.isDirty(tab.id)}
        onclick={() => editorStore.setActiveTab(tab.id)}
        ondblclick={() => {
          // Double-click makes preview tab permanent
          if (tab.id === editorStore.previewTabId) {
            editorStore.openFile(tab.filePath, false);
          }
        }}
        title={tab.filePath}
        role="tab"
        tabindex="0"
        aria-selected={tab.id === editorStore.activeTabId}
      >
        <span class="tab-name" class:italic={tab.id === editorStore.previewTabId}>
          {tab.fileName}
        </span>
        {#if editorStore.isDirty(tab.id)}
          <span class="dirty-dot"></span>
        {/if}
        <button class="tab-close" onclick={(e) => closeTab(e, tab)} title="Close">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    height: 34px;
    overflow: hidden;
  }

  .tabs-scroll {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    flex: 1;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  .editor-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 12px;
    color: var(--text-secondary);
    border-right: 1px solid var(--border-secondary);
    background: transparent;
    white-space: nowrap;
    transition: all var(--transition);
    position: relative;
    min-width: 0;
    flex-shrink: 0;
  }
  .editor-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .editor-tab.active {
    background: var(--bg-code);
    color: var(--text-primary);
    border-bottom: 1px solid var(--accent-primary);
    margin-bottom: -1px;
  }
  .editor-tab.preview .tab-name {
    font-style: italic;
  }

  .tab-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    opacity: 0;
    transition: all var(--transition);
    flex-shrink: 0;
  }
  .editor-tab:hover .tab-close {
    opacity: 1;
  }
  .editor-tab.dirty .tab-close {
    opacity: 0;
  }
  .editor-tab.dirty:hover .tab-close {
    opacity: 1;
  }
  .editor-tab.dirty:hover .dirty-dot {
    display: none;
  }
  .tab-close:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }
</style>
