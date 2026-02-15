<script lang="ts">
  import { searchStore } from '$lib/stores/search.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { projectStore } from '$lib/stores/projects.svelte';

  let searchInput: HTMLInputElement;
  let debounceTimer: ReturnType<typeof setTimeout>;
  let collapsedFiles = $state<Set<string>>(new Set());

  function getRootPath(): string {
    return (
      projectStore.activeProject?.path ||
      conversationStore.active?.projectPath ||
      settingsStore.projectPath ||
      '.'
    );
  }

  function onInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchStore.setQuery(value);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchStore.search(getRootPath());
    }, 300);
  }

  function toggleRegex() {
    searchStore.setIsRegex(!searchStore.isRegex);
    if (searchStore.query) {
      searchStore.search(getRootPath());
    }
  }

  function toggleFile(path: string) {
    const next = new Set(collapsedFiles);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedFiles = next;
  }

  function openMatch(file: string, line: number) {
    editorStore.openFile(file, false);
  }

  function highlightContent(content: string, matchStart: number, matchEnd: number): string {
    const before = content.slice(0, matchStart).replace(/</g, '&lt;');
    const match = content.slice(matchStart, matchEnd).replace(/</g, '&lt;');
    const after = content.slice(matchEnd).replace(/</g, '&lt;');
    return `${before}<mark>${match}</mark>${after}`;
  }
</script>

<div class="search-panel">
  <div class="search-header">
    <h3>Search</h3>
  </div>

  <div class="search-input-row">
    <input
      bind:this={searchInput}
      type="text"
      class="search-input"
      placeholder="Search files..."
      value={searchStore.query}
      oninput={onInput}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          clearTimeout(debounceTimer);
          searchStore.search(getRootPath());
        }
      }}
    />
    <button
      class="regex-toggle"
      class:active={searchStore.isRegex}
      onclick={toggleRegex}
      title="Use regex">.*</button
    >
  </div>

  {#if searchStore.loading}
    <div class="search-status">Searching...</div>
  {:else if searchStore.error}
    <div class="search-status error">{searchStore.error}</div>
  {:else if searchStore.query && searchStore.results.length === 0}
    <div class="search-status">No results found</div>
  {:else if searchStore.results.length > 0}
    <div class="search-summary">
      {searchStore.totalMatches} match{searchStore.totalMatches !== 1 ? 'es' : ''} in {searchStore.fileCount}
      file{searchStore.fileCount !== 1 ? 's' : ''}
      {#if searchStore.truncated}<span class="truncated">(truncated)</span>{/if}
    </div>

    <div class="search-results">
      {#each [...searchStore.groupedResults()] as [filePath, matches]}
        <div class="file-group">
          <button class="file-header" onclick={() => toggleFile(filePath)}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              {#if collapsedFiles.has(filePath)}
                <path d="M9 18l6-6-6-6" />
              {:else}
                <path d="M6 9l6 6 6-6" />
              {/if}
            </svg>
            <span class="file-name">{filePath}</span>
            <span class="match-count">{matches.length}</span>
          </button>

          {#if !collapsedFiles.has(filePath)}
            <div class="file-matches">
              {#each matches as match}
                <button
                  class="match-item"
                  onclick={() => openMatch(match.file, match.line)}
                  title="Line {match.line}"
                >
                  <span class="line-num">{match.line}</span>
                  <span class="match-content"
                    >{@html highlightContent(
                      match.content.trim(),
                      match.matchStart - (match.content.length - match.content.trimStart().length),
                      match.matchEnd - (match.content.length - match.content.trimStart().length),
                    )}</span
                  >
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-panel {
    padding: 8px;
  }
  .search-header {
    padding: 4px 4px 8px;
  }
  .search-header h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
  }

  .search-input-row {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .search-input {
    flex: 1;
    font-size: 12px;
    padding: 6px 8px;
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
  }
  .search-input:focus {
    border-color: var(--accent-primary);
  }

  .regex-toggle {
    font-size: 11px;
    font-family: var(--font-family-mono, monospace);
    padding: 4px 8px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .regex-toggle:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }
  .regex-toggle.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }

  .search-status {
    padding: 12px 8px;
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
  }
  .search-status.error {
    color: var(--accent-error);
  }

  .search-summary {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 2px 4px 6px;
  }
  .truncated {
    color: var(--accent-warning);
  }

  .search-results {
    overflow-y: auto;
  }

  .file-group {
    margin-bottom: 2px;
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    text-align: left;
    border-radius: var(--radius-sm);
    transition: background var(--transition);
  }
  .file-header:hover {
    background: var(--bg-hover);
  }
  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .match-count {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
  }

  .file-matches {
    padding-left: 8px;
  }
  .match-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 2px 6px;
    font-size: 11px;
    text-align: left;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: background var(--transition);
    font-family: var(--font-family-mono, monospace);
  }
  .match-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .line-num {
    flex-shrink: 0;
    color: var(--text-tertiary);
    min-width: 28px;
    text-align: right;
  }
  .match-content {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .match-content :global(mark) {
    background: rgba(255, 170, 0, 0.3);
    color: var(--text-primary);
    border-radius: 1px;
    padding: 0 1px;
  }
</style>
