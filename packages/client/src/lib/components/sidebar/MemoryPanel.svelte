<script lang="ts">
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  interface MemoryFile {
    path: string;
    content: string;
    type: string;
    lastModified: number;
  }

  let files = $state<MemoryFile[]>([]);
  let editingFile = $state<MemoryFile | null>(null);
  let editContent = $state('');
  let saving = $state(false);

  onMount(async () => {
    try {
      const res = await api.memory.list();
      files = res.data;
    } catch {}
  });

  function startEdit(file: MemoryFile) {
    editingFile = file;
    editContent = file.content;
  }

  async function save() {
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
    <h3>Memory</h3>
  </div>

  {#if editingFile}
    <div class="edit-view">
      <div class="edit-header">
        <span class="edit-file truncate">{fileName(editingFile.path)}</span>
        <div class="edit-actions">
          <button class="btn-sm" onclick={() => (editingFile = null)}>Cancel</button>
          <button class="btn-sm primary" onclick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <textarea class="edit-textarea" bind:value={editContent}></textarea>
    </div>
  {:else}
    <div class="memory-files">
      {#each files as file}
        <button class="memory-item" onclick={() => startEdit(file)}>
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
    padding: 4px 4px 8px;
  }
  .memory-header h3 {
    font-size: 13px;
    font-weight: 600;
  }

  .memory-files {
    overflow-y: auto;
  }

  .memory-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px;
    border-radius: var(--radius-sm);
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
    border-radius: 3px;
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
  }

  .btn-sm {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    transition: all var(--transition);
  }
  .btn-sm:hover {
    background: var(--bg-active);
  }
  .btn-sm.primary {
    background: var(--accent-primary);
    color: var(--text-on-accent);
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
