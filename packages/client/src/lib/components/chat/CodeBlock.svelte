<script lang="ts">
  let { code, language = 'text' } = $props<{ code: string; language?: string }>();
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }
</script>

<div class="code-block" data-language={language}>
  <div class="code-header">
    <span class="language-label">{language}</span>
    <button class="copy-btn" onclick={copy}>
      {#if copied}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"><path d="M20 6L9 17l-5-5" /></svg
        >
        Copied
      {:else}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          ><rect x="9" y="9" width="13" height="13" rx="2" /><path
            d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
          /></svg
        >
        Copy
      {/if}
    </button>
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
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .copy-btn:hover {
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
