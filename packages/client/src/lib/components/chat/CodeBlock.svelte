<script lang="ts">
  import { api } from '$lib/api/client';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';

  let {
    code,
    language = 'text',
    filePath = '',
  } = $props<{
    code: string;
    language?: string;
    filePath?: string;
  }>();
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  async function openInEditor() {
    if (!filePath) return;
    try {
      const res = await api.files.read(filePath);
      const fileName = filePath.split('/').pop() ?? filePath;
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      const langMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'cpp', cpp: 'cpp',
        css: 'css', html: 'html', svelte: 'html', json: 'json', md: 'markdown',
        sql: 'sql', sh: 'shell', yaml: 'yaml', yml: 'yaml', toml: 'toml',
      };
      primaryPaneStore.openFileTab(filePath, res.data.content, langMap[ext] ?? language ?? 'text');
    } catch {
      // Silently ignore
    }
  }
</script>

<div class="code-block" data-language={language}>
  <div class="code-header">
    <span class="language-label">{language}</span>
    <div class="code-actions">
      {#if filePath}
        <button class="code-action-btn" onclick={openInEditor} title="Open in editor">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open
        </button>
      {/if}
      <button class="code-action-btn" onclick={copy}>
        {#if copied}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Copied
        {:else}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        {/if}
      </button>
    </div>
  </div>
  <pre><code>{code}</code></pre>
</div>

<style>
  .code-block {
    border-radius: var(--radius);
    border: 1px solid var(--border-primary);
    overflow: hidden;
    font-size: 13px;
  }

  .code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
  }

  .language-label {
    font-size: 11px;
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .code-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .code-action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .code-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  pre {
    padding: 12px;
    overflow-x: auto;
    margin: 0;
    background: var(--bg-code);
  }

  code {
    font-family: var(--font-family);
    font-size: 13px;
    line-height: 1.5;
    background: none;
    padding: 0;
  }
</style>
