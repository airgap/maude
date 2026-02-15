<script lang="ts">
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import { projectMemoryStore } from '$lib/stores/project-memory.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type { MemoryCategory } from '@maude/shared';

  type ViewMode = 'files' | 'project';

  interface MemoryFile {
    path: string;
    content: string;
    type: string;
    lastModified: number;
  }

  let viewMode = $state<ViewMode>('project');
  let files = $state<MemoryFile[]>([]);
  let editingFile = $state<MemoryFile | null>(null);
  let editContent = $state('');
  let saving = $state(false);

  // Project memory add form
  let showAddForm = $state(false);
  let addForm = $state({
    key: '',
    content: '',
    category: 'convention' as MemoryCategory,
  });

  // Project memory editing
  let editingMemory = $state<string | null>(null);
  let editMemoryContent = $state('');

  const CATEGORIES: Array<{ value: MemoryCategory | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'convention', label: 'Conventions' },
    { value: 'decision', label: 'Decisions' },
    { value: 'preference', label: 'Preferences' },
    { value: 'pattern', label: 'Patterns' },
    { value: 'context', label: 'Context' },
  ];

  const CATEGORY_COLORS: Record<string, string> = {
    convention: 'var(--accent-primary)',
    decision: 'var(--accent-secondary)',
    preference: 'var(--accent-warning)',
    pattern: 'var(--text-secondary)',
    context: 'var(--text-tertiary)',
  };

  onMount(async () => {
    try {
      const res = await api.memory.list();
      files = res.data;
    } catch {}
    if (settingsStore.projectPath) {
      projectMemoryStore.load(settingsStore.projectPath);
    }
  });

  function startEditFile(file: MemoryFile) {
    editingFile = file;
    editContent = file.content;
  }

  async function saveFile() {
    if (!editingFile) return;
    saving = true;
    try {
      await api.memory.update(editingFile.path, editContent);
      editingFile.content = editContent;
      editingFile = null;
    } finally {
      saving = false;
    }
  }

  async function addMemory() {
    if (!addForm.key || !addForm.content || !settingsStore.projectPath) return;
    const ok = await projectMemoryStore.create({
      projectPath: settingsStore.projectPath,
      category: addForm.category,
      key: addForm.key,
      content: addForm.content,
    });
    if (ok) {
      addForm = { key: '', content: '', category: 'convention' };
      showAddForm = false;
      uiStore.toast('Memory added', 'success');
    }
  }

  async function deleteMemory(id: string) {
    await projectMemoryStore.remove(id);
  }

  async function saveMemoryEdit(id: string) {
    await projectMemoryStore.update(id, { content: editMemoryContent });
    editingMemory = null;
  }

  function typeLabel(type: string): string {
    const labels: Record<string, string> = {
      project: 'Project',
      'project-local': 'Local',
      user: 'User',
      'auto-memory': 'Auto Memory',
      'auto-topic': 'Topic',
      rules: 'Rule',
      skills: 'Skill',
    };
    return labels[type] || type;
  }

  function fileName(path: string): string {
    return path.split('/').pop() || path;
  }
</script>

<div class="memory-panel">
  <div class="memory-header">
    <div class="view-tabs">
      <button
        class="view-tab"
        class:active={viewMode === 'project'}
        onclick={() => (viewMode = 'project')}
      >
        Project Memory
        {#if projectMemoryStore.stats.total > 0}
          <span class="count">{projectMemoryStore.stats.total}</span>
        {/if}
      </button>
      <button
        class="view-tab"
        class:active={viewMode === 'files'}
        onclick={() => (viewMode = 'files')}
      >
        Files
        {#if files.length > 0}
          <span class="count">{files.length}</span>
        {/if}
      </button>
    </div>
  </div>

  {#if viewMode === 'project'}
    <div class="project-memory-view">
      <div class="pm-toolbar">
        <div class="filter-row">
          {#each CATEGORIES as cat}
            <button
              class="filter-chip"
              class:active={projectMemoryStore.filterCategory === cat.value}
              onclick={() => projectMemoryStore.setFilter(cat.value)}
            >
              {cat.label}
            </button>
          {/each}
        </div>
        <button class="add-btn" onclick={() => (showAddForm = !showAddForm)} title="Add memory"
          >+</button
        >
      </div>

      {#if showAddForm}
        <div class="add-form">
          <select bind:value={addForm.category} class="form-input">
            <option value="convention">Convention</option>
            <option value="decision">Decision</option>
            <option value="preference">Preference</option>
            <option value="pattern">Pattern</option>
            <option value="context">Context</option>
          </select>
          <input
            bind:value={addForm.key}
            placeholder="Key (e.g. indent style)"
            class="form-input"
          />
          <textarea
            bind:value={addForm.content}
            placeholder="Description"
            class="form-textarea"
            rows="2"
          ></textarea>
          <button class="save-btn" onclick={addMemory} disabled={!addForm.key || !addForm.content}>
            Add Memory
          </button>
        </div>
      {/if}

      {#if projectMemoryStore.loading}
        <div class="empty">Loading...</div>
      {:else if projectMemoryStore.memories.length === 0}
        <div class="empty">
          {#if !settingsStore.projectPath}
            Set a project path to use project memory
          {:else}
            No memories yet. Add manually or they'll be auto-extracted from conversations.
          {/if}
        </div>
      {:else}
        <div class="memory-list">
          {#each projectMemoryStore.memories as mem (mem.id)}
            <div class="pm-item">
              <div class="pm-header">
                <span
                  class="pm-category"
                  style="color: {CATEGORY_COLORS[mem.category] || 'var(--text-tertiary)'}"
                >
                  {mem.category}
                </span>
                <div class="pm-meta">
                  {#if mem.source === 'auto'}
                    <span class="pm-source">auto</span>
                  {/if}
                  <span
                    class="pm-confidence"
                    title="Confidence: {(mem.confidence * 100).toFixed(0)}%"
                  >
                    {(mem.confidence * 100).toFixed(0)}%
                  </span>
                  {#if mem.timesSeen > 1}
                    <span class="pm-seen" title="Seen {mem.timesSeen} times">x{mem.timesSeen}</span>
                  {/if}
                </div>
              </div>
              <div class="pm-key">{mem.key}</div>
              {#if editingMemory === mem.id}
                <textarea class="form-textarea" bind:value={editMemoryContent} rows="2"></textarea>
                <div class="pm-edit-actions">
                  <button class="btn-sm" onclick={() => (editingMemory = null)}>Cancel</button>
                  <button class="btn-sm primary" onclick={() => saveMemoryEdit(mem.id)}>Save</button
                  >
                </div>
              {:else}
                <div class="pm-content">{mem.content}</div>
              {/if}
              <div class="pm-actions">
                <button
                  class="action-icon"
                  onclick={() => {
                    editingMemory = mem.id;
                    editMemoryContent = mem.content;
                  }}
                  title="Edit"
                >
                  E
                </button>
                <button
                  class="action-icon delete"
                  onclick={() => deleteMemory(mem.id)}
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if editingFile}
    <div class="edit-view">
      <div class="edit-header">
        <span class="edit-file truncate">{fileName(editingFile.path)}</span>
        <div class="edit-actions">
          <button class="btn-sm" onclick={() => (editingFile = null)}>Cancel</button>
          <button class="btn-sm primary" onclick={saveFile} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <textarea class="edit-textarea" bind:value={editContent}></textarea>
    </div>
  {:else}
    <div class="memory-files">
      {#each files as file}
        <button class="memory-item" onclick={() => startEditFile(file)}>
          <div class="memory-item-header">
            <span class="type-badge">{typeLabel(file.type)}</span>
            <span class="file-name truncate">{fileName(file.path)}</span>
          </div>
          <div class="memory-preview truncate">{file.content.slice(0, 100)}</div>
        </button>
      {:else}
        <div class="empty">No memory files found</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .memory-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .memory-header {
    padding: 4px 0 8px;
  }
  .view-tabs {
    display: flex;
    gap: 1px;
    border: 1px solid var(--border-primary);
  }
  .view-tab {
    flex: 1;
    padding: 6px 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: none;
    cursor: pointer;
    transition: all var(--transition);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .view-tab:hover {
    color: var(--text-primary);
  }
  .view-tab.active {
    color: var(--accent-primary);
    background: var(--bg-primary);
  }
  .count {
    font-size: 9px;
    padding: 0 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
  }

  .project-memory-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pm-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .filter-row {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
    flex: 1;
  }
  .filter-chip {
    font-size: 9px;
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-tertiary);
    cursor: pointer;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    transition: all var(--transition);
  }
  .filter-chip:hover {
    color: var(--text-primary);
    border-color: var(--border-secondary);
  }
  .filter-chip.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .add-btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    flex-shrink: 0;
  }
  .add-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .add-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    margin-bottom: 8px;
  }
  .form-input {
    font-size: 12px;
    padding: 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .form-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .form-textarea {
    font-size: 12px;
    padding: 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: var(--font-family);
    resize: vertical;
  }
  .form-textarea:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .save-btn {
    font-size: 11px;
    padding: 4px 12px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    cursor: pointer;
  }
  .save-btn:hover {
    opacity: 0.9;
  }
  .save-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .memory-list {
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pm-item {
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    position: relative;
  }
  .pm-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }
  .pm-category {
    font-size: 9px;
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .pm-meta {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .pm-source {
    font-size: 8px;
    padding: 0 4px;
    background: var(--bg-active);
    border: 1px solid var(--border-primary);
    color: var(--accent-primary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .pm-confidence {
    font-size: 9px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .pm-seen {
    font-size: 9px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .pm-key {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 2px;
  }
  .pm-content {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .pm-actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .pm-item:hover .pm-actions {
    opacity: 1;
  }
  .action-icon {
    font-size: 10px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    font-weight: 700;
  }
  .action-icon:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .action-icon.delete:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }
  .pm-edit-actions {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }

  .memory-files {
    overflow-y: auto;
  }
  .memory-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px;
    transition: background var(--transition);
    margin-bottom: 2px;
  }
  .memory-item:hover {
    background: var(--bg-hover);
  }
  .memory-item-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  .type-badge {
    font-size: 10px;
    padding: 1px 6px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .file-name {
    font-size: 12px;
    color: var(--text-primary);
  }
  .memory-preview {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .edit-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .edit-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .edit-file {
    font-size: 12px;
    font-weight: 600;
  }
  .edit-actions {
    display: flex;
    gap: 4px;
  }
  .edit-textarea {
    flex: 1;
    font-family: var(--font-family);
    font-size: 12px;
    line-height: 1.5;
    resize: none;
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
  }

  .btn-sm {
    font-size: 11px;
    padding: 4px 10px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .btn-sm:hover {
    background: var(--bg-active);
  }
  .btn-sm.primary {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }
  .btn-sm:disabled {
    opacity: 0.5;
  }

  .empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
