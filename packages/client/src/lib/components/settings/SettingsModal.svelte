<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import type { ThemeId, CliProvider } from '@maude/shared';
  import { MONO_FONTS, SANS_FONTS, findFont } from '$lib/config/fonts';

  const cliProviders: { id: CliProvider; label: string; desc: string }[] = [
    { id: 'claude', label: 'Claude Code', desc: 'Anthropic Claude CLI' },
    { id: 'kiro', label: 'Kiro CLI', desc: 'AWS Kiro CLI' },
  ];

  let activeTab = $state<
    'general' | 'appearance' | 'editor' | 'permissions' | 'security' | 'mcp' | 'keybindings'
  >('general');

  // --- BYOK state ---
  let apiKeyStatus = $state<Record<string, boolean>>({});
  let apiKeyInputs = $state<Record<string, string>>({});
  let apiKeySaving = $state<Record<string, boolean>>({});

  const apiProviders = [
    { id: 'anthropic', label: 'Anthropic', desc: 'Claude models' },
    { id: 'openai', label: 'OpenAI', desc: 'GPT models' },
    { id: 'google', label: 'Google', desc: 'Gemini models' },
  ];

  async function loadApiKeyStatus() {
    try {
      const res = await api.settings.apiKeysStatus();
      apiKeyStatus = res.data;
    } catch {}
  }

  async function saveApiKey(provider: string) {
    const key = apiKeyInputs[provider]?.trim();
    if (!key) return;
    apiKeySaving = { ...apiKeySaving, [provider]: true };
    try {
      await api.settings.setApiKey(provider, key);
      apiKeyInputs = { ...apiKeyInputs, [provider]: '' };
      await loadApiKeyStatus();
      uiStore.toast(`${provider} API key saved`, 'success');
    } catch {
      uiStore.toast(`Failed to save ${provider} API key`, 'error');
    }
    apiKeySaving = { ...apiKeySaving, [provider]: false };
  }

  // --- Budget state ---
  let budgetValue = $state<string>('');
  let budgetLoading = $state(false);

  async function loadBudget() {
    try {
      const res = await api.settings.getBudget();
      budgetValue = res.data.budgetUsd != null ? String(res.data.budgetUsd) : '';
    } catch {}
  }

  async function saveBudget() {
    budgetLoading = true;
    try {
      const val = budgetValue.trim() ? parseFloat(budgetValue) : null;
      await api.settings.setBudget(val);
      settingsStore.update({ sessionBudgetUsd: val });
      uiStore.toast(val ? `Budget set to $${val.toFixed(2)}` : 'Budget limit removed', 'success');
    } catch {
      uiStore.toast('Failed to save budget', 'error');
    }
    budgetLoading = false;
  }

  // --- Sandbox state ---
  let sandboxEnabled = $state(false);
  let sandboxPaths = $state<string[]>([]);
  let sandboxNewPath = $state('');
  let sandboxLoading = $state(false);

  async function loadSandbox() {
    try {
      const res = await api.projects.getSandbox(settingsStore.projectPath);
      sandboxEnabled = res.data.enabled;
      sandboxPaths = res.data.allowedPaths;
    } catch {}
  }

  async function saveSandbox() {
    sandboxLoading = true;
    try {
      await api.projects.updateSandbox({
        projectPath: settingsStore.projectPath,
        enabled: sandboxEnabled,
        allowedPaths: sandboxPaths,
      });
      uiStore.toast('Sandbox settings saved', 'success');
    } catch {
      uiStore.toast('Failed to save sandbox settings', 'error');
    }
    sandboxLoading = false;
  }

  function addSandboxPath() {
    const p = sandboxNewPath.trim();
    if (p && !sandboxPaths.includes(p)) {
      sandboxPaths = [...sandboxPaths, p];
      sandboxNewPath = '';
    }
  }

  function removeSandboxPath(path: string) {
    sandboxPaths = sandboxPaths.filter((p) => p !== path);
  }

  // --- Snippet import state ---
  let snippetLanguage = $state('javascript');
  let snippetFileInput: HTMLInputElement;

  const supportedLanguages = [
    'javascript',
    'typescript',
    'python',
    'rust',
    'go',
    'java',
    'cpp',
    'css',
    'html',
    'json',
    'markdown',
    'sql',
    'shell',
    'xml',
  ];

  function handleSnippetImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const count = settingsStore.importSnippets(json, snippetLanguage);
        uiStore.toast(`Imported ${count} snippets for ${snippetLanguage}`, 'success');
      } catch {
        uiStore.toast('Invalid snippet JSON file', 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  // --- Theme import state ---
  let themeFileInput: HTMLInputElement;

  function handleThemeImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const id = settingsStore.importTheme(json);
        settingsStore.setTheme(id);
        uiStore.toast('Theme imported and applied', 'success');
      } catch {
        uiStore.toast('Invalid theme JSON file', 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  const themes: { id: ThemeId; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'dark-colorblind', label: 'Dark (Colorblind)' },
    { id: 'light-colorblind', label: 'Light (Colorblind)' },
    { id: 'dark-ansi', label: 'Dark (ANSI)' },
    { id: 'light-ansi', label: 'Light (ANSI)' },
    { id: 'monokai', label: 'Monokai' },
    { id: 'dracula', label: 'Dracula' },
    { id: 'nord', label: 'Nord' },
    { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
    { id: 'gruvbox-light', label: 'Gruvbox Light' },
    { id: 'solarized-dark', label: 'Solarized Dark' },
    { id: 'solarized-light', label: 'Solarized Light' },
    { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
    { id: 'catppuccin-latte', label: 'Catppuccin Latte' },
    { id: 'tokyo-night', label: 'Tokyo Night' },
    { id: 'rose-pine', label: 'Rosé Pine' },
    { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn' },
    { id: 'synthwave', label: "Synthwave '84" },
    { id: 'github-dark', label: 'GitHub Dark' },
    { id: 'github-light', label: 'GitHub Light' },
    { id: 'one-dark', label: 'One Dark' },
    { id: 'everforest', label: 'Everforest' },
  ];

  const cloudModels = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ];

  let ollamaAvailable = $state(false);
  let ollamaModels = $state<Array<{ name: string; size: number }>>([]);
  let models = $state(cloudModels);

  onMount(async () => {
    try {
      const status = await api.settings.ollamaStatus();
      ollamaAvailable = status.data.available;
      if (ollamaAvailable) {
        const res = await api.settings.ollamaModels();
        ollamaModels = res.data;
        models = [
          ...cloudModels,
          ...ollamaModels.map((m) => ({
            id: `ollama:${m.name}`,
            label: `${m.name} (local)`,
          })),
        ];
      }
    } catch {
      /* Ollama not available */
    }
    // Pre-load security data
    loadApiKeyStatus();
    loadBudget();
    loadSandbox();
  });

  const permModes = [
    { id: 'plan', label: 'Plan', desc: 'Read-only, plan before executing' },
    { id: 'safe', label: 'Safe', desc: 'Prompts for all modifications' },
    { id: 'fast', label: 'Fast', desc: 'Auto-approves safe commands' },
    { id: 'unrestricted', label: 'Unrestricted', desc: 'All tools auto-approved' },
  ];

  function close() {
    uiStore.closeModal();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Settings</h2>
      <button class="close-btn" onclick={close}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <nav class="settings-tabs">
        {#each ['general', 'appearance', 'editor', 'permissions', 'security', 'mcp', 'keybindings'] as tab}
          <button
            class="settings-tab"
            class:active={activeTab === tab}
            onclick={() => (activeTab = tab as any)}
          >
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
            <select
              value={settingsStore.model}
              onchange={(e) => settingsStore.setModel((e.target as HTMLSelectElement).value)}
            >
              {#each models as m}<option value={m.id}>{m.label}</option>{/each}
            </select>
          </div>
          <div class="setting-group">
            <label class="setting-label">Auto-scroll</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.autoScroll}
                onchange={() => settingsStore.update({ autoScroll: !settingsStore.autoScroll })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Show thinking blocks</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showThinkingBlocks}
                onchange={() =>
                  settingsStore.update({ showThinkingBlocks: !settingsStore.showThinkingBlocks })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Show tool details</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showToolDetails}
                onchange={() =>
                  settingsStore.update({ showToolDetails: !settingsStore.showToolDetails })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Auto-memory</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.autoMemoryEnabled}
                onchange={() =>
                  settingsStore.update({ autoMemoryEnabled: !settingsStore.autoMemoryEnabled })}
              />
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
                    <div class="tp-body">
                      <div class="tp-sidebar"></div>
                      <div class="tp-main"></div>
                    </div>
                  </div>
                  <span>{theme.label}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Custom imported themes -->
          {#if Object.keys(settingsStore.customThemes).length > 0}
            <div class="setting-group">
              <label class="setting-label">Imported Themes</label>
              <div class="theme-grid">
                {#each Object.entries(settingsStore.customThemes) as [id, ct]}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="theme-option"
                    class:active={settingsStore.theme === id}
                    onclick={() => settingsStore.setTheme(id)}
                    role="button"
                    tabindex="0"
                  >
                    <div class="theme-swatch">
                      <div
                        class="swatch-half"
                        style="background: {ct.cssVars['--bg-primary'] || '#1e1e1e'}"
                      ></div>
                      <div
                        class="swatch-half"
                        style="background: {ct.cssVars['--accent-primary'] || '#007acc'}"
                      ></div>
                    </div>
                    <span>{ct.name}</span>
                    <button
                      class="delete-theme-btn"
                      onclick={(e) => {
                        e.stopPropagation();
                        settingsStore.deleteCustomTheme(id);
                      }}
                      title="Delete theme">x</button
                    >
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <div class="setting-group">
            <input
              type="file"
              accept=".json"
              style="display:none"
              bind:this={themeFileInput}
              onchange={handleThemeImport}
            />
            <button class="btn-secondary" onclick={() => themeFileInput.click()}>
              Import VS Code Theme
            </button>
          </div>

          <div class="setting-group">
            <label class="setting-label">Font size: {settingsStore.fontSize}px</label>
            <input
              type="range"
              min="10"
              max="24"
              value={settingsStore.fontSize}
              oninput={(e) =>
                settingsStore.update({ fontSize: Number((e.target as HTMLInputElement).value) })}
            />
          </div>

          <div class="setting-group">
            <label class="setting-label">Code Font</label>
            <select
              class="font-select"
              value={settingsStore.fontFamily}
              onchange={(e) =>
                settingsStore.update({ fontFamily: (e.target as HTMLSelectElement).value })}
              style="font-family: {findFont(settingsStore.fontFamily)?.family || 'monospace'}"
            >
              {#each MONO_FONTS as font (font.id)}
                <option value={font.id}>{font.label}{!font.googleFont ? ' (local)' : ''}</option>
              {/each}
            </select>
            <div
              class="font-preview mono"
              style="font-family: {findFont(settingsStore.fontFamily)?.family || 'monospace'}"
            >
              const maude = "Hello, World!"; // 0O1lI
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">UI Font</label>
            <select
              class="font-select"
              value={settingsStore.fontFamilySans}
              onchange={(e) =>
                settingsStore.update({ fontFamilySans: (e.target as HTMLSelectElement).value })}
              style="font-family: {findFont(settingsStore.fontFamilySans)?.family || 'sans-serif'}"
            >
              {#each SANS_FONTS as font (font.id)}
                <option value={font.id}>{font.label}{!font.googleFont ? ' (local)' : ''}</option>
              {/each}
            </select>
            <div
              class="font-preview sans"
              style="font-family: {findFont(settingsStore.fontFamilySans)?.family || 'sans-serif'}"
            >
              The quick brown fox jumps over the lazy dog
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Compact messages</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.compactMessages}
                onchange={() =>
                  settingsStore.update({ compactMessages: !settingsStore.compactMessages })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Show budget in status bar</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showBudgetDisplay}
                onchange={() =>
                  settingsStore.update({ showBudgetDisplay: !settingsStore.showBudgetDisplay })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        {:else if activeTab === 'editor'}
          <div class="setting-group">
            <label class="setting-label">Import VS Code Snippets</label>
            <p class="setting-desc">Import snippet JSON files from VS Code to use in the editor.</p>
            <div class="snippet-import-row">
              <select bind:value={snippetLanguage}>
                {#each supportedLanguages as lang}
                  <option value={lang}>{lang}</option>
                {/each}
              </select>
              <input
                type="file"
                accept=".json"
                style="display:none"
                bind:this={snippetFileInput}
                onchange={handleSnippetImport}
              />
              <button class="btn-secondary" onclick={() => snippetFileInput.click()}>
                Import Snippets
              </button>
            </div>
          </div>

          {#if Object.keys(settingsStore.customSnippets).length > 0}
            <div class="setting-group">
              <label class="setting-label">Imported Snippets</label>
              <div class="snippet-list">
                {#each Object.entries(settingsStore.customSnippets) as [lang, snippets]}
                  <div class="snippet-row">
                    <span class="snippet-lang">{lang}</span>
                    <span class="snippet-count"
                      >{snippets.length} snippet{snippets.length !== 1 ? 's' : ''}</span
                    >
                    <button class="btn-danger-sm" onclick={() => settingsStore.clearSnippets(lang)}>
                      Clear
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
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
        {:else if activeTab === 'security'}
          <!-- API Keys (BYOK) -->
          <div class="setting-group">
            <label class="setting-label">API Keys</label>
            <p class="setting-desc">
              Bring your own API keys. Keys are stored server-side and never sent back to the
              client.
            </p>
            <div class="api-keys-list">
              {#each apiProviders as provider}
                <div class="api-key-row">
                  <div class="api-key-info">
                    <span class="api-key-name">{provider.label}</span>
                    <span class="api-key-desc">{provider.desc}</span>
                    {#if apiKeyStatus[`${provider.id}Configured`]}
                      <span class="api-key-badge configured">Configured</span>
                    {:else}
                      <span class="api-key-badge not-configured">Not set</span>
                    {/if}
                  </div>
                  <div class="api-key-input-row">
                    <input
                      type="password"
                      class="api-key-input"
                      placeholder={apiKeyStatus[`${provider.id}Configured`]
                        ? '••••••••'
                        : `Enter ${provider.label} API key`}
                      value={apiKeyInputs[provider.id] || ''}
                      oninput={(e) => {
                        apiKeyInputs = {
                          ...apiKeyInputs,
                          [provider.id]: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') saveApiKey(provider.id);
                      }}
                    />
                    <button
                      class="btn-secondary"
                      onclick={() => saveApiKey(provider.id)}
                      disabled={apiKeySaving[provider.id] || !apiKeyInputs[provider.id]?.trim()}
                    >
                      {apiKeySaving[provider.id] ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <!-- Budget -->
          <div class="setting-group">
            <label class="setting-label">Session Budget</label>
            <p class="setting-desc">Set a maximum spend per session. Leave empty for no limit.</p>
            <div class="budget-row">
              <span class="budget-prefix">$</span>
              <input
                type="number"
                class="budget-input"
                placeholder="No limit"
                step="0.50"
                min="0"
                value={budgetValue}
                oninput={(e) => {
                  budgetValue = (e.target as HTMLInputElement).value;
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') saveBudget();
                }}
              />
              <button class="btn-secondary" onclick={saveBudget} disabled={budgetLoading}>
                {budgetLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <!-- Sandbox -->
          <div class="setting-group">
            <label class="setting-label">Filesystem Sandbox</label>
            <p class="setting-desc">Restrict agent file access to specific directories.</p>
            <div class="sandbox-toggle-row">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={sandboxEnabled}
                  onchange={() => {
                    sandboxEnabled = !sandboxEnabled;
                  }}
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="sandbox-status">{sandboxEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            {#if sandboxEnabled}
              <div class="sandbox-paths">
                <label class="setting-label" style="font-size: 12px;">Allowed Paths</label>
                {#each sandboxPaths as path}
                  <div class="sandbox-path-row">
                    <code class="sandbox-path">{path}</code>
                    <button class="btn-danger-sm" onclick={() => removeSandboxPath(path)}>x</button>
                  </div>
                {/each}
                <div class="sandbox-add-row">
                  <input
                    type="text"
                    class="sandbox-path-input"
                    placeholder="/path/to/allow"
                    value={sandboxNewPath}
                    oninput={(e) => {
                      sandboxNewPath = (e.target as HTMLInputElement).value;
                    }}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') addSandboxPath();
                    }}
                  />
                  <button class="btn-secondary" onclick={addSandboxPath}>Add</button>
                </div>
              </div>
              <button
                class="btn-primary"
                style="margin-top: 10px;"
                onclick={saveSandbox}
                disabled={sandboxLoading}
              >
                {sandboxLoading ? 'Saving...' : 'Save Sandbox Config'}
              </button>
            {/if}
          </div>
        {:else if activeTab === 'mcp'}
          <div class="setting-group">
            <p class="mcp-info">
              MCP servers can be configured to extend Claude's capabilities with custom tools and
              resources.
            </p>
            <button class="btn-primary" onclick={() => uiStore.openModal('mcp-manager')}
              >Manage MCP Servers</button
            >
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
  .modal-header h2 {
    font-size: 16px;
    font-weight: 700;
  }
  .close-btn {
    color: var(--text-tertiary);
    padding: 4px;
    border-radius: var(--radius-sm);
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .modal-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

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
  .settings-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .settings-tab.active {
    background: var(--bg-active);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .settings-content {
    flex: 1;
    padding: 16px 20px;
    overflow-y: auto;
  }

  .setting-group {
    margin-bottom: 20px;
  }
  .setting-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  select,
  input[type='range'] {
    width: 100%;
  }

  /* Toggle */
  .toggle {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    cursor: pointer;
  }
  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-slider {
    position: absolute;
    inset: 0;
    background: var(--bg-tertiary);
    border-radius: 11px;
    transition: background var(--transition);
  }
  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    left: 2px;
    bottom: 2px;
    background: var(--text-primary);
    border-radius: 50%;
    transition: transform var(--transition);
  }
  .toggle input:checked + .toggle-slider {
    background: var(--accent-primary);
  }
  .toggle input:checked + .toggle-slider::before {
    transform: translateX(18px);
  }

  /* Theme grid */
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
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
  .theme-option:hover {
    border-color: var(--border-primary);
  }
  .theme-option.active {
    border-color: var(--accent-primary);
  }
  .theme-preview {
    width: 100%;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .tp-bar {
    height: 6px;
    background: var(--bg-tertiary);
  }
  .tp-body {
    flex: 1;
    display: flex;
  }
  .tp-sidebar {
    width: 30%;
    background: var(--bg-secondary);
  }
  .tp-main {
    flex: 1;
    background: var(--bg-primary);
  }

  /* CLI Provider */
  .provider-options {
    display: flex;
    gap: 8px;
  }
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
  .provider-option:hover {
    border-color: var(--border-primary);
  }
  .provider-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }
  .provider-name {
    font-size: 13px;
    font-weight: 600;
  }
  .provider-desc {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* Permission modes */
  .perm-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .perm-option {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: all var(--transition);
  }
  .perm-option:hover {
    border-color: var(--border-primary);
  }
  .perm-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }
  .perm-name {
    font-size: 13px;
    font-weight: 600;
  }
  .perm-desc {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* MCP */
  .mcp-info {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .btn-primary {
    padding: 8px 16px;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 600;
  }

  /* Keybindings */
  .keybindings-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .keybinding-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-secondary);
  }
  .kb-action {
    font-size: 13px;
    color: var(--text-primary);
  }
  .kb-keys {
    font-size: 12px;
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
  }

  /* Snippets */
  .setting-desc {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-bottom: 10px;
  }
  .snippet-import-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .snippet-import-row select {
    flex: 1;
    padding: 6px 8px;
    font-size: 13px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
  }
  .snippet-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .snippet-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .snippet-lang {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-primary);
    min-width: 90px;
  }
  .snippet-count {
    font-size: 12px;
    color: var(--text-secondary);
    flex: 1;
  }
  .btn-secondary {
    padding: 6px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
  }
  .btn-secondary:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .btn-danger-sm {
    padding: 3px 10px;
    background: transparent;
    border: 1px solid var(--accent-error);
    color: var(--accent-error);
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-danger-sm:hover {
    background: var(--accent-error);
    color: var(--bg-primary);
  }

  /* Custom theme swatches */
  .theme-swatch {
    width: 100%;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: flex;
  }
  .swatch-half {
    flex: 1;
  }
  .delete-theme-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 18px;
    height: 18px;
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    padding: 0;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .theme-option {
    position: relative;
  }
  .theme-option:hover .delete-theme-btn {
    opacity: 1;
  }
  .delete-theme-btn:hover {
    background: var(--accent-error);
    color: white;
    border-color: var(--accent-error);
  }

  /* API Keys */
  .api-keys-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .api-key-row {
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .api-key-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .api-key-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .api-key-desc {
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .api-key-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 8px;
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-left: auto;
  }
  .api-key-badge.configured {
    color: var(--accent-secondary);
    border: 1px solid var(--accent-secondary);
  }
  .api-key-badge.not-configured {
    color: var(--text-tertiary);
    border: 1px solid var(--border-secondary);
  }
  .api-key-input-row {
    display: flex;
    gap: 6px;
  }
  .api-key-input {
    flex: 1;
    padding: 6px 10px;
    font-size: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .api-key-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Budget */
  .budget-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .budget-prefix {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-secondary);
  }
  .budget-input {
    width: 120px;
    padding: 6px 10px;
    font-size: 13px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .budget-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Sandbox */
  .sandbox-toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .sandbox-status {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 600;
  }
  .sandbox-paths {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .sandbox-path-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .sandbox-path {
    flex: 1;
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sandbox-add-row {
    display: flex;
    gap: 6px;
  }
  .sandbox-path-input {
    flex: 1;
    padding: 6px 10px;
    font-size: 12px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .sandbox-path-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Font picker */
  .font-select {
    width: 100%;
    padding: 8px 10px;
    font-size: 13px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    cursor: pointer;
  }
  .font-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .font-preview {
    margin-top: 8px;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.5;
  }
  .font-preview.mono {
    font-size: 13px;
    letter-spacing: 0.3px;
  }
</style>
