<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { taskStore } from '$lib/stores/tasks.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { gitStore } from '$lib/stores/git.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';

  const layoutIcons: Record<string, string> = {
    'chat-only': 'Chat',
    'editor-only': 'Editor',
    'split-horizontal': 'Split H',
    'split-vertical': 'Split V',
  };

  function cycleLayout() {
    const modes = ['chat-only', 'split-horizontal', 'editor-only', 'split-vertical'] as const;
    const idx = modes.indexOf(editorStore.layoutMode);
    editorStore.setLayoutMode(modes[(idx + 1) % modes.length]);
  }
</script>

<footer class="statusbar">
  <div class="statusbar-left">
    <span class="status-item">
      {#if streamStore.isStreaming}
        <span class="status-dot streaming"></span> Streaming
      {:else if streamStore.status === 'tool_pending'}
        <span class="status-dot pending"></span> Tool approval pending
      {:else if streamStore.status === 'error'}
        <span class="status-dot error"></span> Error
      {:else}
        <span class="status-dot idle"></span> Ready
      {/if}
    </span>

    {#if gitStore.isRepo && gitStore.branch}
      <span class="status-item git-branch">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle
            cx="6"
            cy="18"
            r="3"
          /><path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        {gitStore.branch}
      </span>
    {/if}

    {#if taskStore.inProgress.length > 0}
      <span class="status-item task-status">
        {taskStore.inProgress[0].activeForm || taskStore.inProgress[0].subject}
      </span>
    {/if}
  </div>

  <div class="statusbar-right">
    {#if editorStore.activeTab}
      <span class="status-item cursor-pos">
        Ln {editorStore.activeTab.cursorLine}, Col {editorStore.activeTab.cursorCol}
      </span>
      <span class="status-item indent-label">
        {#if editorStore.activeTab.editorConfig?.indent_style === 'space'}
          Spaces: {editorStore.activeTab.editorConfig.indent_size ?? 4}
        {:else if editorStore.activeTab.editorConfig?.indent_style === 'tab'}
          Tabs: {editorStore.activeTab.editorConfig.tab_width ??
            editorStore.activeTab.editorConfig.indent_size ??
            4}
        {:else}
          Tab: 4
        {/if}
      </span>
      <span class="status-item lang-label">
        {editorStore.activeTab.language}
      </span>
      {@const lang = editorStore.activeTab.language}
      {@const lspStatus = lspStore.getStatus(lang)}
      {@const lspServerInfo = lspStore.getServerInfo(lang)}
      {#if lspStatus === 'ready'}
        <span class="status-item lsp-status" title="LSP connected">
          <span class="lsp-dot connected"></span> LSP
        </span>
      {:else if lspStatus === 'connecting'}
        <span class="status-item lsp-status" title="LSP connecting">
          <span class="lsp-dot connecting"></span> LSP
        </span>
      {:else if lspStore.isInstalling(lang)}
        <span class="status-item lsp-status" title="Installing language server...">
          <span class="lsp-dot connecting"></span> Installing...
        </span>
      {:else if lspStatus === 'error'}
        <span class="status-item lsp-status" title="LSP error">
          <span class="lsp-dot error"></span> LSP
        </span>
      {:else if lspServerInfo?.installable && !lspServerInfo?.available && !lspStore.isDismissed(lang)}
        <button
          class="status-item lsp-install"
          onclick={() => lspStore.installServer(lang, settingsStore.projectPath)}
          title="Install {lspServerInfo.command} via npm"
        >
          Install LSP
        </button>
        <button
          class="status-item lsp-dismiss"
          onclick={() => lspStore.dismissInstall(lang)}
          title="Dismiss"
        >
          &times;
        </button>
      {:else if lspServerInfo?.systemInstallHint && !lspServerInfo?.available}
        <span class="status-item lsp-status" title={lspServerInfo.systemInstallHint}>
          <span class="lsp-dot error"></span> LSP not found
        </span>
      {/if}
    {/if}

    <button class="status-item layout-toggle" onclick={cycleLayout} title="Toggle layout (Ctrl+\\)">
      {layoutIcons[editorStore.layoutMode]}
    </button>

    {#if streamStore.tokenUsage.input || streamStore.tokenUsage.output}
      <span class="status-item tokens">
        {streamStore.tokenUsage.input.toLocaleString()}in / {streamStore.tokenUsage.output.toLocaleString()}out
      </span>
    {/if}

    <span class="status-item mode">
      {settingsStore.permissionMode}
    </span>

    <span class="status-item model">
      {settingsStore.model.split('-').slice(1, 3).join(' ')}
    </span>
  </div>
</footer>

<style>
  .statusbar {
    height: var(--statusbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-primary);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
    flex-shrink: 0;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    position: relative;
    z-index: 1;
  }

  .statusbar-left,
  .statusbar-right {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 0;
    transition: all var(--transition);
  }
  .status-dot.idle {
    background: var(--text-tertiary);
  }
  .status-dot.streaming {
    background: var(--accent-secondary);
    box-shadow:
      0 0 6px var(--accent-secondary),
      0 0 12px rgba(0, 255, 136, 0.2);
    animation: pulse 1.2s infinite;
  }
  .status-dot.pending {
    background: var(--accent-warning);
    box-shadow: 0 0 6px var(--accent-warning);
    animation: pulse 1.2s infinite;
  }
  .status-dot.error {
    background: var(--accent-error);
    box-shadow: 0 0 6px var(--accent-error);
  }

  .git-branch {
    font-size: 10px;
    color: var(--text-secondary);
    text-transform: none;
  }

  .task-status {
    color: var(--accent-primary);
    animation: pulse 2s infinite;
    font-weight: 700;
  }

  .cursor-pos {
    font-family: var(--font-family);
    font-size: 10px;
    color: var(--text-secondary);
  }

  .indent-label {
    font-size: 10px;
    color: var(--text-secondary);
  }

  .lang-label {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .layout-toggle {
    font-size: 10px;
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-weight: 700;
  }
  .layout-toggle:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .tokens {
    font-family: var(--font-family);
    font-size: 10px;
    letter-spacing: 0.5px;
    color: var(--accent-primary);
  }

  .mode {
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 0;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
  }

  .lsp-status {
    font-size: 10px;
    color: var(--text-secondary);
    text-transform: uppercase;
  }
  .lsp-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 0;
  }
  .lsp-dot.connected {
    background: var(--accent-secondary);
    box-shadow: 0 0 4px var(--accent-secondary);
  }
  .lsp-dot.connecting {
    background: var(--accent-warning);
    animation: pulse 1.2s infinite;
  }
  .lsp-dot.error {
    background: var(--accent-error);
  }

  .lsp-install {
    font-size: 10px;
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--accent-primary);
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-weight: 700;
  }
  .lsp-install:hover {
    background: var(--accent-primary);
    color: var(--bg-primary);
  }

  .lsp-dismiss {
    font-size: 12px;
    padding: 0 4px;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    line-height: 1;
  }
  .lsp-dismiss:hover {
    color: var(--text-primary);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
</style>
