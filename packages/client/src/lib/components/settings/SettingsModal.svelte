<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type { ThemeId, CliProvider } from '@maude/shared';

  const cliProviders: { id: CliProvider; label: string; desc: string }[] = [
    { id: 'claude', label: 'Claude Code', desc: 'Anthropic Claude CLI' },
    { id: 'kiro', label: 'Kiro CLI', desc: 'AWS Kiro CLI' },
  ];

  let activeTab = $state<'general' | 'appearance' | 'permissions' | 'mcp' | 'keybindings'>('general');

  const themes: { id: ThemeId; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'dark-colorblind', label: 'Dark (Colorblind)' },
    { id: 'light-colorblind', label: 'Light (Colorblind)' },
    { id: 'dark-ansi', label: 'Dark (ANSI)' },
    { id: 'light-ansi', label: 'Light (ANSI)' },
  ];

  const models = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ];

  const permModes = [
    { id: 'plan', label: 'Plan', desc: 'Read-only, plan before executing' },
    { id: 'safe', label: 'Safe', desc: 'Prompts for all modifications' },
    { id: 'fast', label: 'Fast', desc: 'Auto-approves safe commands' },
    { id: 'unrestricted', label: 'Unrestricted', desc: 'All tools auto-approved' },
  ];

  function close() { uiStore.closeModal(); }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Settings</h2>
      <button class="close-btn" onclick={close}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <nav class="settings-tabs">
        {#each ['general', 'appearance', 'permissions', 'mcp', 'keybindings'] as tab}
          <button class="settings-tab" class:active={activeTab === tab} onclick={() => activeTab = tab as any}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        {/each}
      </nav>

      <div class="settings-content">
        {#if activeTab === 'general'}
          <div class="setting-group">
            <label class="setting-label">CLI Provider</label>
            <div class="provider-options">
              {#each cliProviders as p}
                <button
                  class="provider-option"
                  class:active={settingsStore.cliProvider === p.id}
                  onclick={() => settingsStore.update({ cliProvider: p.id })}
                >
                  <span class="provider-name">{p.label}</span>
                  <span class="provider-desc">{p.desc}</span>
                </button>
              {/each}
            </div>
          </div>
          <div class="setting-group">
            <label class="setting-label">Model</label>
            <select value={settingsStore.model} onchange={(e) => settingsStore.setModel((e.target as HTMLSelectElement).value)}>
              {#each models as m}<option value={m.id}>{m.label}</option>{/each}
            </select>
          </div>
          <div class="setting-group">
            <label class="setting-label">Auto-scroll</label>
            <label class="toggle">
              <input type="checkbox" checked={settingsStore.autoScroll} onchange={() => settingsStore.update({ autoScroll: !settingsStore.autoScroll })} />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Show thinking blocks</label>
            <label class="toggle">
              <input type="checkbox" checked={settingsStore.showThinkingBlocks} onchange={() => settingsStore.update({ showThinkingBlocks: !settingsStore.showThinkingBlocks })} />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Show tool details</label>
            <label class="toggle">
              <input type="checkbox" checked={settingsStore.showToolDetails} onchange={() => settingsStore.update({ showToolDetails: !settingsStore.showToolDetails })} />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Auto-memory</label>
            <label class="toggle">
              <input type="checkbox" checked={settingsStore.autoMemoryEnabled} onchange={() => settingsStore.update({ autoMemoryEnabled: !settingsStore.autoMemoryEnabled })} />
              <span class="toggle-slider"></span>
            </label>
          </div>

        {:else if activeTab === 'appearance'}
          <div class="setting-group">
            <label class="setting-label">Theme</label>
            <div class="theme-grid">
              {#each themes as theme}
                <button
                  class="theme-option"
                  class:active={settingsStore.theme === theme.id}
                  onclick={() => settingsStore.setTheme(theme.id)}
                >
                  <div class="theme-preview" data-theme={theme.id}>
                    <div class="tp-bar"></div>
                    <div class="tp-body"><div class="tp-sidebar"></div><div class="tp-main"></div></div>
                  </div>
                  <span>{theme.label}</span>
                </button>
              {/each}
            </div>
          </div>
          <div class="setting-group">
            <label class="setting-label">Font size: {settingsStore.fontSize}px</label>
            <input type="range" min="10" max="20" value={settingsStore.fontSize}
              oninput={(e) => settingsStore.update({ fontSize: Number((e.target as HTMLInputElement).value) })} />
          </div>
          <div class="setting-group">
            <label class="setting-label">Compact messages</label>
            <label class="toggle">
              <input type="checkbox" checked={settingsStore.compactMessages} onchange={() => settingsStore.update({ compactMessages: !settingsStore.compactMessages })} />
              <span class="toggle-slider"></span>
            </label>
          </div>

        {:else if activeTab === 'permissions'}
          <div class="setting-group">
            <label class="setting-label">Permission mode</label>
            <div class="perm-options">
              {#each permModes as mode}
                <button
                  class="perm-option"
                  class:active={settingsStore.permissionMode === mode.id}
                  onclick={() => settingsStore.setPermissionMode(mode.id as any)}
                >
                  <span class="perm-name">{mode.label}</span>
                  <span class="perm-desc">{mode.desc}</span>
                </button>
              {/each}
            </div>
          </div>

        {:else if activeTab === 'mcp'}
          <div class="setting-group">
            <p class="mcp-info">MCP servers can be configured to extend Claude's capabilities with custom tools and resources.</p>
            <button class="btn-primary" onclick={() => uiStore.openModal('mcp-manager')}>Manage MCP Servers</button>
          </div>

        {:else if activeTab === 'keybindings'}
          <div class="keybindings-list">
            {#each settingsStore.keybindings as binding}
              <div class="keybinding-row">
                <span class="kb-action">{binding.description || binding.action}</span>
                <kbd class="kb-keys">{binding.keys}</kbd>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }
  .modal-header h2 { font-size: 16px; font-weight: 700; }
  .close-btn { color: var(--text-tertiary); padding: 4px; border-radius: var(--radius-sm); }
  .close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .modal-body { display: flex; flex: 1; min-height: 0; }

  .settings-tabs {
    display: flex;
    flex-direction: column;
    padding: 8px;
    border-right: 1px solid var(--border-secondary);
    min-width: 140px;
  }
  .settings-tab {
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    text-align: left;
    color: var(--text-secondary);
    transition: all var(--transition);
  }
  .settings-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
  .settings-tab.active { background: var(--bg-active); color: var(--accent-primary); font-weight: 600; }

  .settings-content {
    flex: 1;
    padding: 16px 20px;
    overflow-y: auto;
  }

  .setting-group { margin-bottom: 20px; }
  .setting-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }

  select, input[type="range"] { width: 100%; }

  /* Toggle */
  .toggle { position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; inset: 0;
    background: var(--bg-tertiary);
    border-radius: 11px;
    transition: background var(--transition);
  }
  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 18px; height: 18px;
    left: 2px; bottom: 2px;
    background: var(--text-primary);
    border-radius: 50%;
    transition: transform var(--transition);
  }
  .toggle input:checked + .toggle-slider { background: var(--accent-primary); }
  .toggle input:checked + .toggle-slider::before { transform: translateX(18px); }

  /* Theme grid */
  .theme-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .theme-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    border: 2px solid var(--border-secondary);
    border-radius: var(--radius);
    transition: all var(--transition);
    font-size: 11px;
  }
  .theme-option:hover { border-color: var(--border-primary); }
  .theme-option.active { border-color: var(--accent-primary); }
  .theme-preview {
    width: 100%;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .tp-bar { height: 6px; background: var(--bg-tertiary); }
  .tp-body { flex: 1; display: flex; }
  .tp-sidebar { width: 30%; background: var(--bg-secondary); }
  .tp-main { flex: 1; background: var(--bg-primary); }

  /* CLI Provider */
  .provider-options { display: flex; gap: 8px; }
  .provider-option {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: all var(--transition);
  }
  .provider-option:hover { border-color: var(--border-primary); }
  .provider-option.active { border-color: var(--accent-primary); background: var(--bg-active); }
  .provider-name { font-size: 13px; font-weight: 600; }
  .provider-desc { font-size: 11px; color: var(--text-tertiary); }

  /* Permission modes */
  .perm-options { display: flex; flex-direction: column; gap: 6px; }
  .perm-option {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: all var(--transition);
  }
  .perm-option:hover { border-color: var(--border-primary); }
  .perm-option.active { border-color: var(--accent-primary); background: var(--bg-active); }
  .perm-name { font-size: 13px; font-weight: 600; }
  .perm-desc { font-size: 11px; color: var(--text-tertiary); }

  /* MCP */
  .mcp-info { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
  .btn-primary {
    padding: 8px 16px;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 600;
  }

  /* Keybindings */
  .keybindings-list { display: flex; flex-direction: column; gap: 4px; }
  .keybinding-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-secondary);
  }
  .kb-action { font-size: 13px; color: var(--text-primary); }
  .kb-keys {
    font-size: 12px;
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
  }
</style>
