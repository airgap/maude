<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import { desktopNotifications } from '$lib/notifications/desktop-notifications';
  import type {
    ThemeId,
    CliProvider,
    PermissionRule,
    PermissionRulePreset,
    TerminalCommandPolicy,
    AgentProfile,
    AgentProfileCreateInput,
  } from '@e/shared';
  import { PERMISSION_PRESETS } from '@e/shared';
  import { profilesStore } from '$lib/stores/profiles.svelte';
  import { MONO_FONTS, SANS_FONTS, findFont } from '$lib/config/fonts';
  import { HYPERTHEMES } from '$lib/config/hyperthemes';

  const cliProviders: { id: CliProvider; label: string; desc: string }[] = [
    { id: 'claude', label: 'Claude Code', desc: 'Anthropic Claude CLI' },
    { id: 'kiro', label: 'Kiro CLI', desc: 'AWS Kiro CLI' },
    { id: 'gemini-cli', label: 'Gemini CLI', desc: 'Google Gemini CLI' },
    { id: 'copilot', label: 'Copilot CLI', desc: 'GitHub Copilot CLI' },
  ];

  // Check if the profiles tab was requested via localStorage flag
  function getInitialTab():
    | 'general'
    | 'appearance'
    | 'audio'
    | 'editor'
    | 'permissions'
    | 'security'
    | 'mcp'
    | 'keybindings'
    | 'profiles' {
    if (typeof localStorage !== 'undefined') {
      const tab = localStorage.getItem('e-settings-tab');
      if (tab) {
        localStorage.removeItem('e-settings-tab');
        return tab as any;
      }
    }
    return 'general';
  }

  let activeTab = $state<
    | 'general'
    | 'appearance'
    | 'audio'
    | 'editor'
    | 'permissions'
    | 'security'
    | 'mcp'
    | 'keybindings'
    | 'profiles'
  >(getInitialTab());

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
      const res = await api.workspaces.getSandbox(settingsStore.workspacePath);
      sandboxEnabled = res.data.enabled;
      sandboxPaths = res.data.allowedPaths;
    } catch {}
  }

  async function saveSandbox() {
    sandboxLoading = true;
    try {
      await api.workspaces.updateSandbox({
        workspacePath: settingsStore.workspacePath,
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
    { id: 'goth', label: 'Redrum' },
    { id: 'sakura-light', label: 'Sakura Light' },
    { id: 'sakura', label: 'Sakura Dark' },
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
    let combined = [...cloudModels];

    // Ollama local models
    try {
      const status = await api.settings.ollamaStatus();
      ollamaAvailable = status.data.available;
      if (ollamaAvailable) {
        const res = await api.settings.ollamaModels();
        ollamaModels = res.data;
        combined = [
          ...combined,
          ...ollamaModels.map((m) => ({
            id: `ollama:${m.name}`,
            label: `${m.name} (local)`,
          })),
        ];
      }
    } catch {
      /* Ollama not available */
    }

    // Pre-load security data so we know which keys are set before fetching remote models
    await loadApiKeyStatus();

    // OpenAI models (only if key is configured)
    if (apiKeyStatus['openai']) {
      try {
        const res = await api.settings.openaiModels();
        if (res.data?.length) {
          combined = [
            ...combined,
            ...res.data.map((m) => ({ id: `openai:${m.id}`, label: `${m.name} (OpenAI)` })),
          ];
        }
      } catch {
        /* OpenAI not available */
      }
    }

    // Google Gemini models (only if key is configured)
    if (apiKeyStatus['google']) {
      try {
        const res = await api.settings.geminiModels();
        if (res.data?.length) {
          combined = [
            ...combined,
            ...res.data.map((m) => ({ id: `gemini:${m.id}`, label: `${m.name} (Gemini)` })),
          ];
        }
      } catch {
        /* Gemini not available */
      }
    }

    models = combined;
    loadBudget();
    loadSandbox();
    loadPermissionRules();
    profilesStore.load();
  });

  const permModes = [
    { id: 'plan', label: 'Plan', desc: 'Read-only, plan before executing' },
    { id: 'safe', label: 'Safe', desc: 'Prompts for all modifications' },
    { id: 'fast', label: 'Fast', desc: 'Auto-approves safe commands' },
    { id: 'unrestricted', label: 'Yolo', desc: 'All tools auto-approved — no prompts, ever' },
  ];

  const terminalPolicies: { id: TerminalCommandPolicy; label: string; desc: string }[] = [
    { id: 'off', label: 'Off', desc: 'Terminal commands are blocked' },
    { id: 'auto', label: 'Auto', desc: 'Follows the general permission mode' },
    { id: 'turbo', label: 'Turbo', desc: 'All terminal commands auto-approved' },
    { id: 'custom', label: 'Custom', desc: 'Use per-tool rules for Bash' },
  ];

  // --- Permission rules state ---
  let permRules = $state<PermissionRule[]>([]);
  let permRulesLoading = $state(false);
  let permRulesScope = $state<'global' | 'project' | 'session'>('global');
  let newRuleType = $state<'allow' | 'deny' | 'ask'>('allow');
  let newRuleTool = $state('');
  let newRulePattern = $state('');
  let editingRuleId = $state<string | null>(null);

  const builtinToolNames = [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'WebFetch',
    'WebSearch',
    'NotebookEdit',
    '*',
  ];

  async function loadPermissionRules() {
    permRulesLoading = true;
    try {
      const res = await api.settings.getPermissionRules({
        scope: permRulesScope,
        workspacePath: permRulesScope === 'project' ? settingsStore.workspacePath : undefined,
      });
      permRules = res.data;
    } catch {
      permRules = [];
    }
    permRulesLoading = false;
  }

  async function addPermissionRule() {
    if (!newRuleTool.trim()) return;
    try {
      const res = await api.settings.createPermissionRule({
        type: newRuleType,
        tool: newRuleTool.trim(),
        pattern: newRulePattern.trim() || undefined,
        scope: permRulesScope,
        workspacePath: permRulesScope === 'project' ? settingsStore.workspacePath : undefined,
      });
      permRules = [...permRules, res.data];
      newRuleTool = '';
      newRulePattern = '';
      uiStore.toast('Permission rule added', 'success');
    } catch {
      uiStore.toast('Failed to add rule', 'error');
    }
  }

  async function deleteRule(ruleId: string) {
    try {
      await api.settings.deletePermissionRule(ruleId);
      permRules = permRules.filter((r) => r.id !== ruleId);
      uiStore.toast('Rule removed', 'success');
    } catch {
      uiStore.toast('Failed to delete rule', 'error');
    }
  }

  async function applyPreset(presetId: string) {
    try {
      const res = await api.settings.applyPermissionPreset({
        presetId,
        scope: permRulesScope,
        workspacePath: permRulesScope === 'project' ? settingsStore.workspacePath : undefined,
      });
      permRules = res.data;
      uiStore.toast('Preset applied', 'success');
    } catch {
      uiStore.toast('Failed to apply preset', 'error');
    }
  }

  // --- Agent Profiles state ---
  let showProfileForm = $state(false);
  let editingProfile = $state<AgentProfile | null>(null);
  let profileFormName = $state('');
  let profileFormDescription = $state('');
  let profileFormPermissionMode = $state<'plan' | 'safe' | 'fast' | 'unrestricted'>('unrestricted');
  let profileFormAllowedTools = $state('');
  let profileFormDisallowedTools = $state('');
  let profileFormSystemPrompt = $state('');
  let profileFormSaving = $state(false);

  function openNewProfileForm() {
    editingProfile = null;
    profileFormName = '';
    profileFormDescription = '';
    profileFormPermissionMode = 'unrestricted';
    profileFormAllowedTools = '';
    profileFormDisallowedTools = '';
    profileFormSystemPrompt = '';
    showProfileForm = true;
  }

  function openEditProfileForm(profile: AgentProfile) {
    editingProfile = profile;
    profileFormName = profile.name;
    profileFormDescription = profile.description ?? '';
    profileFormPermissionMode = profile.permissionMode as any;
    profileFormAllowedTools = profile.allowedTools.join(', ');
    profileFormDisallowedTools = profile.disallowedTools.join(', ');
    profileFormSystemPrompt = profile.systemPrompt ?? '';
    showProfileForm = true;
  }

  function closeProfileForm() {
    showProfileForm = false;
    editingProfile = null;
  }

  function parseToolList(str: string): string[] {
    return str
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveProfile() {
    if (!profileFormName.trim()) return;
    profileFormSaving = true;
    try {
      const input: AgentProfileCreateInput = {
        name: profileFormName.trim(),
        description: profileFormDescription.trim() || undefined,
        permissionMode: profileFormPermissionMode,
        allowedTools: parseToolList(profileFormAllowedTools),
        disallowedTools: parseToolList(profileFormDisallowedTools),
        systemPrompt: profileFormSystemPrompt.trim() || undefined,
      };
      if (editingProfile) {
        await profilesStore.update(editingProfile.id, input);
        uiStore.toast('Profile updated', 'success');
      } else {
        await profilesStore.create(input);
        uiStore.toast('Profile created', 'success');
      }
      closeProfileForm();
    } catch {
      uiStore.toast('Failed to save profile', 'error');
    }
    profileFormSaving = false;
  }

  async function deleteProfile(id: string) {
    try {
      await profilesStore.delete(id);
      uiStore.toast('Profile deleted', 'success');
    } catch {
      uiStore.toast('Failed to delete profile', 'error');
    }
  }

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
        {#each ['general', 'appearance', 'audio', 'editor', 'permissions', 'profiles', 'security', 'mcp', 'keybindings'] as tab}
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
            <p class="setting-hint">Choose which coding agent CLI powers your sessions</p>
            <div class="provider-grid">
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
            <label class="setting-label">Send with Enter</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.sendWithEnter}
                onchange={() =>
                  settingsStore.update({ sendWithEnter: !settingsStore.sendWithEnter })}
              />
              <span class="toggle-slider"></span>
            </label>
            <p class="setting-desc">When off, use Ctrl+Enter to send</p>
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
            <label class="setting-label">Visual Style</label>
            <div class="hypertheme-grid">
              {#each HYPERTHEMES as ht}
                <button
                  class="hypertheme-option"
                  class:active={settingsStore.hypertheme === ht.id}
                  onclick={() => settingsStore.setHypertheme(ht.id)}
                >
                  <span class="ht-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={ht.icon} /></svg></span>
                  <span class="ht-label">{ht.label}</span>
                </button>
              {/each}
            </div>
          </div>

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
              min="12"
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
              const e = "Hello, World!"; // 0O1lI
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
            <label class="setting-label">Auto-compact context</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.autoCompaction}
                onchange={() =>
                  settingsStore.update({ autoCompaction: !settingsStore.autoCompaction })}
              />
              <span class="toggle-slider"></span>
            </label>
            <p class="setting-desc">
              Automatically compact conversation history when context window exceeds 95%
            </p>
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
          <div class="setting-group">
            <label class="setting-label">Startup tips</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showStartupTips}
                onchange={() =>
                  settingsStore.update({ showStartupTips: !settingsStore.showStartupTips })}
              />
              <span class="toggle-slider"></span>
            </label>
            <p class="setting-desc">
              Show a rotating tip on each startup to help you discover features and shortcuts
            </p>
          </div>

          <div class="setting-group">
            <label class="setting-label">Streaming Animations</label>
            <div class="streaming-options">
              <div class="streaming-option-row">
                <span class="streaming-option-label">Header indicator</span>
                <select
                  value={settingsStore.streamingIndicator}
                  onchange={(e) =>
                    settingsStore.update({
                      streamingIndicator: (e.target as HTMLSelectElement).value as any,
                    })}
                >
                  <option value="dots">Dots</option>
                  <option value="spinner">Spinner</option>
                  <option value="pulse">Pulse</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div class="streaming-option-row">
                <span class="streaming-option-label">Progress bar</span>
                <select
                  value={settingsStore.streamingProgressBar}
                  onchange={(e) =>
                    settingsStore.update({
                      streamingProgressBar: (e.target as HTMLSelectElement).value as any,
                    })}
                >
                  <option value="rainbow">Rainbow</option>
                  <option value="accent">Accent</option>
                  <option value="pulse">Pulse</option>
                  <option value="neon">Neon</option>
                  <option value="cylon">Cylon</option>
                  <option value="matrix">Matrix</option>
                  <option value="comet">Comet</option>
                  <option value="helix">Helix</option>
                  <option value="fire">Fire</option>
                  <option value="ocean">Ocean</option>
                  <option value="electric">Electric</option>
                  <option value="candy">Candy</option>
                  <option value="vapor">Vapor</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div class="streaming-option-row">
                <span class="streaming-option-label">Text cursor</span>
                <select
                  value={settingsStore.streamingCursor}
                  onchange={(e) =>
                    settingsStore.update({
                      streamingCursor: (e.target as HTMLSelectElement).value as any,
                    })}
                >
                  <option value="block">Block &#x258A;</option>
                  <option value="line">Line |</option>
                  <option value="underscore">Underscore _</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </div>
        {:else if activeTab === 'audio'}
          <div class="setting-group">
            <label class="setting-label">Sound effects</label>
            <div class="audio-toggle-row">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={settingsStore.soundEnabled}
                  onchange={() =>
                    settingsStore.update({ soundEnabled: !settingsStore.soundEnabled })}
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-toggle-label">
                {settingsStore.soundEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p class="setting-desc">Generative audio chirps for each stream event type</p>
          </div>

          <div class="setting-group" class:muted={!settingsStore.soundEnabled}>
            <label class="setting-label">
              Volume — {settingsStore.soundVolume}%
            </label>
            <div class="volume-row">
              <span class="volume-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /></svg></span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={settingsStore.soundVolume}
                disabled={!settingsStore.soundEnabled}
                oninput={(e) =>
                  settingsStore.update({
                    soundVolume: Number((e.target as HTMLInputElement).value),
                  })}
              />
              <span class="volume-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg></span>
            </div>
          </div>

          <div class="setting-group" class:muted={!settingsStore.soundEnabled}>
            <label class="setting-label">Sound style</label>
            <div class="sound-style-row">
              {#each [{ value: 'melodic', label: 'Melodic', desc: 'Warm additive synthesis — marimba, vibraphone, bells' }, { value: 'classic', label: 'Classic', desc: 'Original oscillator chirps — the vintage E sound' }, { value: 'whimsy', label: 'Whimsy', desc: 'Music box, toy piano, kalimba & rubber-duck squeaks' }, { value: 'slot-machine', label: 'Slot Machine', desc: 'Casino coins, reel clicks, lever pulls & jackpot bells' }, { value: 'forest', label: 'Forest', desc: 'Woodland flutes, owl hoots, raindrops & fairy sparkles' }, { value: 'wind-chime', label: 'Wind Chime', desc: 'Shimmering tubes, crystal tinkles, bamboo knocks & bell chimes' }] as opt}
                <button
                  class="sound-style-btn"
                  class:active={settingsStore.soundStyle === opt.value}
                  disabled={!settingsStore.soundEnabled}
                  onclick={() =>
                    settingsStore.update({
                      soundStyle: opt.value as 'classic' | 'melodic' | 'whimsy' | 'slot-machine' | 'forest' | 'wind-chime',
                    })}
                >
                  <span class="sound-style-name">{opt.label}</span>
                  <span class="sound-style-desc">{opt.desc}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Desktop notifications</label>
            <p class="setting-desc">
              OS-level notifications when events occur while this tab is in the background.
              {#if desktopNotifications.isSupported}
                {#if desktopNotifications.permission === 'granted'}
                  <span class="notify-status granted">Permitted</span>
                {:else if desktopNotifications.permission === 'denied'}
                  <span class="notify-status denied">Blocked — enable in browser settings</span>
                {:else}
                  <button
                    class="btn-secondary notify-request-btn"
                    onclick={async () => {
                      const result = await desktopNotifications.requestPermission();
                      if (result === 'granted') {
                        uiStore.toast('Desktop notifications enabled', 'success');
                      } else if (result === 'denied') {
                        uiStore.toast('Notifications blocked by browser', 'error');
                      }
                    }}>Enable notifications</button
                  >
                {/if}
              {:else}
                <span class="notify-status denied">Not supported in this browser</span>
              {/if}
            </p>
            <div class="notify-options">
              <div class="notify-option-row">
                <span class="notify-option-label">On completion</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.notifyOnCompletion}
                    onchange={() =>
                      settingsStore.update({
                        notifyOnCompletion: !settingsStore.notifyOnCompletion,
                      })}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="notify-option-row">
                <span class="notify-option-label">On failure</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.notifyOnFailure}
                    onchange={() =>
                      settingsStore.update({ notifyOnFailure: !settingsStore.notifyOnFailure })}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="notify-option-row">
                <span class="notify-option-label">On approval needed</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.notifyOnApproval}
                    onchange={() =>
                      settingsStore.update({ notifyOnApproval: !settingsStore.notifyOnApproval })}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <div class="setting-group" class:muted={!settingsStore.soundEnabled}>
            <label class="setting-label">Event sounds</label>
            <div class="chirp-legend">
              {#each [{ event: 'Response start', desc: 'Ascending tone when Claude begins responding' }, { event: 'Text block', desc: 'Soft click as a new text block opens' }, { event: 'Streaming text', desc: 'Gentle trickle while text flows (throttled)' }, { event: 'Thinking', desc: 'Low hum when extended thinking begins' }, { event: 'Tool call', desc: 'Mechanical blip on each tool invocation' }, { event: 'Tool success', desc: 'Bright major-third chord on completion' }, { event: 'Tool error', desc: 'Descending sawtooth on tool failure' }, { event: 'Approval needed', desc: 'Sustained chime awaiting your approval' }, { event: 'Question asked', desc: 'Three-note rising arpeggio with upward lilt — the classic "huh?" contour' }, { event: 'Response done', desc: 'Resolved interval when the response completes' }, { event: 'Error', desc: 'Warning buzz on stream error' }, { event: 'Cancelled', desc: 'Soft fade when you stop the response' }] as row}
                <div class="chirp-row">
                  <span class="chirp-event">{row.event}</span>
                  <span class="chirp-desc">{row.desc}</span>
                </div>
              {/each}
            </div>
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

          <!-- Terminal Command Policy -->
          <div class="setting-group">
            <label class="setting-label">Terminal command policy</label>
            <p class="setting-desc">Independent control for Bash/terminal tool execution</p>
            <div class="perm-options terminal-policy-options">
              {#each terminalPolicies as pol}
                <button
                  class="perm-option terminal-policy-option"
                  class:active={settingsStore.terminalCommandPolicy === pol.id}
                  onclick={() => settingsStore.setTerminalCommandPolicy(pol.id)}
                >
                  <span class="perm-name">{pol.label}</span>
                  <span class="perm-desc">{pol.desc}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Permission Rules Editor -->
          <div class="setting-group">
            <label class="setting-label">Permission rules</label>
            <p class="setting-desc">
              Fine-grained allow/deny/ask rules per tool. Rules override the general permission
              mode.
            </p>

            <!-- Scope selector -->
            <div class="perm-scope-row">
              {#each [{ id: 'global', label: 'Global' }, { id: 'project', label: 'Project' }, { id: 'session', label: 'Session' }] as s}
                <button
                  class="perm-scope-btn"
                  class:active={permRulesScope === s.id}
                  onclick={() => {
                    permRulesScope = s.id as any;
                    loadPermissionRules();
                  }}
                >
                  {s.label}
                </button>
              {/each}
            </div>

            <!-- Presets -->
            <div class="perm-presets-row">
              <span class="perm-presets-label">Presets:</span>
              {#each PERMISSION_PRESETS as preset}
                <button
                  class="perm-preset-btn"
                  title={preset.description}
                  onclick={() => applyPreset(preset.id)}
                >
                  {preset.name}
                </button>
              {/each}
            </div>

            <!-- Add rule form -->
            <div class="perm-add-rule">
              <select class="perm-rule-select" bind:value={newRuleType}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
                <option value="ask">Ask</option>
              </select>
              <select class="perm-rule-select perm-tool-select" bind:value={newRuleTool}>
                <option value="" disabled>Tool...</option>
                {#each builtinToolNames as t}
                  <option value={t}>{t === '*' ? '* (all)' : t}</option>
                {/each}
              </select>
              <input
                type="text"
                class="perm-pattern-input"
                placeholder="Pattern (optional, e.g. rm -rf *)"
                bind:value={newRulePattern}
                onkeydown={(e) => {
                  if (e.key === 'Enter') addPermissionRule();
                }}
              />
              <button
                class="btn-secondary perm-add-btn"
                onclick={addPermissionRule}
                disabled={!newRuleTool.trim()}
              >
                Add
              </button>
            </div>

            <!-- Rules list -->
            {#if permRulesLoading}
              <div class="perm-rules-loading">Loading...</div>
            {:else if permRules.length === 0}
              <div class="perm-rules-empty">
                No rules configured for this scope. Add rules above or apply a preset.
              </div>
            {:else}
              <div class="perm-rules-list">
                {#each permRules as rule (rule.id)}
                  <div class="perm-rule-row">
                    <span
                      class="perm-rule-type"
                      class:allow={rule.type === 'allow'}
                      class:deny={rule.type === 'deny'}
                      class:ask={rule.type === 'ask'}
                    >
                      {rule.type}
                    </span>
                    <span class="perm-rule-tool">{rule.tool}</span>
                    {#if rule.pattern}
                      <span class="perm-rule-pattern">{rule.pattern}</span>
                    {/if}
                    <span class="perm-rule-scope-badge">{rule.scope}</span>
                    <button
                      class="btn-danger-sm perm-rule-delete"
                      onclick={() => deleteRule(rule.id)}>x</button
                    >
                  </div>
                {/each}
              </div>
            {/if}
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
                <label class="setting-label" style="font-size: var(--fs-sm);">Allowed Paths</label>
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
            <button class="btn-primary" onclick={() => { uiStore.closeModal(); uiStore.setSidebarTab('mcp'); }}
              >Manage MCP Servers</button
            >
          </div>
        {:else if activeTab === 'profiles'}
          <div class="profiles-section">
            <div class="profiles-header">
              <div>
                <p class="setting-desc">
                  Agent profiles bundle permission mode, allowed/disallowed tools, and an optional
                  system prompt override. Select a profile from the top bar or via <kbd
                    >Ctrl+Shift+,</kbd
                  >.
                </p>
              </div>
              <button class="btn-secondary" onclick={openNewProfileForm}>+ New Profile</button>
            </div>

            <div class="profiles-list">
              {#each profilesStore.profiles as profile (profile.id)}
                <div class="profile-card" class:built-in={profile.isBuiltIn}>
                  <div class="profile-card-left">
                    <div class="profile-card-name">
                      {profile.name}
                      {#if profile.isBuiltIn}
                        <span class="built-in-badge">built-in</span>
                      {/if}
                    </div>
                    {#if profile.description}
                      <div class="profile-card-desc">{profile.description}</div>
                    {/if}
                    <div class="profile-card-meta">
                      <span class="meta-chip mode-{profile.permissionMode}"
                        >{profile.permissionMode}</span
                      >
                      {#if profile.allowedTools.length > 0}
                        <span class="meta-chip allow-chip"
                          >allow: {profile.allowedTools.slice(0, 3).join(', ')}{profile.allowedTools
                            .length > 3
                            ? ' +' + (profile.allowedTools.length - 3)
                            : ''}</span
                        >
                      {/if}
                      {#if profile.disallowedTools.length > 0}
                        <span class="meta-chip deny-chip"
                          >deny: {profile.disallowedTools.slice(0, 3).join(', ')}{profile
                            .disallowedTools.length > 3
                            ? ' +' + (profile.disallowedTools.length - 3)
                            : ''}</span
                        >
                      {/if}
                    </div>
                  </div>
                  <div class="profile-card-actions">
                    {#if !profile.isBuiltIn}
                      <button class="btn-secondary" onclick={() => openEditProfileForm(profile)}
                        >Edit</button
                      >
                      <button class="btn-danger-sm" onclick={() => deleteProfile(profile.id)}
                        >Delete</button
                      >
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            {#if showProfileForm}
              <div class="profile-form-overlay">
                <div class="profile-form">
                  <div class="profile-form-header">
                    <h3>{editingProfile ? 'Edit Profile' : 'New Profile'}</h3>
                    <button class="close-btn" onclick={closeProfileForm}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div class="profile-form-body">
                    <div class="setting-group">
                      <label class="setting-label">Name <span class="required">*</span></label>
                      <input type="text" bind:value={profileFormName} placeholder="My Profile" />
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Description</label>
                      <input
                        type="text"
                        bind:value={profileFormDescription}
                        placeholder="Short description (optional)"
                      />
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Permission Mode</label>
                      <div class="perm-options">
                        {#each permModes as mode}
                          <button
                            class="perm-option"
                            class:active={profileFormPermissionMode === mode.id}
                            onclick={() => (profileFormPermissionMode = mode.id as any)}
                          >
                            <span class="perm-name">{mode.label}</span>
                            <span class="perm-desc">{mode.desc}</span>
                          </button>
                        {/each}
                      </div>
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Allowed Tools</label>
                      <input
                        type="text"
                        bind:value={profileFormAllowedTools}
                        placeholder="Read, Glob, Grep (comma-separated, * for all)"
                      />
                      <p class="setting-desc">
                        Tools that are always allowed. Use * to allow all tools.
                      </p>
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Disallowed Tools</label>
                      <input
                        type="text"
                        bind:value={profileFormDisallowedTools}
                        placeholder="Write, Edit, Bash (comma-separated, * for all)"
                      />
                      <p class="setting-desc">
                        Tools that are always blocked. Use * to block all tools.
                      </p>
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">System Prompt Override</label>
                      <textarea
                        bind:value={profileFormSystemPrompt}
                        placeholder="Optional: override the system prompt when this profile is active"
                        rows="4"
                      ></textarea>
                    </div>

                    <div class="profile-form-footer">
                      <button class="btn-secondary" onclick={closeProfileForm}>Cancel</button>
                      <button
                        class="btn-primary"
                        onclick={saveProfile}
                        disabled={profileFormSaving || !profileFormName.trim()}
                      >
                        {profileFormSaving
                          ? 'Saving...'
                          : editingProfile
                            ? 'Update Profile'
                            : 'Create Profile'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
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
    font-size: var(--fs-lg);
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
    font-size: var(--fs-base);
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
    font-size: var(--fs-base);
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
    width: 44px;
    height: 24px;
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
    border-radius: 12px;
    transition: background var(--transition);
  }
  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 20px;
    height: 20px;
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
    transform: translateX(20px);
  }

  /* Hypertheme grid */
  .hypertheme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .hypertheme-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 6px;
    border: 2px solid var(--border-secondary);
    border-radius: var(--radius);
    transition: all var(--transition);
    text-align: center;
  }
  .hypertheme-option:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .hypertheme-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }
  .ht-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }
  .hypertheme-option.active .ht-icon {
    color: var(--accent-primary);
  }
  .ht-label {
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-primary);
  }
  .ht-desc {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    line-height: 1.2;
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
    font-size: var(--fs-xs);
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
  .provider-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .provider-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: all var(--transition);
    cursor: pointer;
    background: var(--bg-primary);
  }
  .provider-option:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .provider-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }
  .provider-name {
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .provider-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .setting-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin: 0 0 8px 0;
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
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .perm-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  /* MCP */
  .mcp-info {
    font-size: var(--fs-base);
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .btn-primary {
    padding: 8px 16px;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-radius: var(--radius-sm);
    font-size: var(--fs-base);
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
    font-size: var(--fs-base);
    color: var(--text-primary);
  }
  .kb-keys {
    font-size: var(--fs-sm);
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
  }

  /* Snippets */
  .setting-desc {
    font-size: var(--fs-sm);
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
    font-size: var(--fs-base);
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
    font-size: var(--fs-base);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
    color: var(--text-primary);
    min-width: 90px;
  }
  .snippet-count {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    flex: 1;
  }
  .btn-secondary {
    padding: 6px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
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
    font-size: var(--fs-xs);
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
    width: 24px;
    height: 24px;
    font-size: var(--fs-xs);
    line-height: 24px;
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
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
  }
  .api-key-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .api-key-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 8px;
    border-radius: var(--radius-sm);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
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
    font-size: var(--fs-sm);
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
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-secondary);
  }
  .budget-input {
    width: 120px;
    padding: 6px 10px;
    font-size: var(--fs-base);
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
    font-size: var(--fs-sm);
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
    font-size: var(--fs-sm);
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
    font-size: var(--fs-sm);
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

  /* Streaming animation options */
  .streaming-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .streaming-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .streaming-option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .streaming-option-row select {
    width: 130px;
    padding: 4px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
  }
  .streaming-option-row select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Font picker */
  .font-select {
    width: 100%;
    padding: 8px 10px;
    font-size: var(--fs-base);
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
    font-size: var(--fs-md);
    line-height: 1.5;
  }
  .font-preview.mono {
    font-size: var(--fs-base);
    letter-spacing: 0.3px;
  }

  /* Audio tab */
  .audio-toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .audio-toggle-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .volume-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .volume-row input[type='range'] {
    flex: 1;
  }
  .volume-icon {
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    user-select: none;
  }
  .muted {
    opacity: 0.4;
    pointer-events: none;
  }
  .sound-style-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .sound-style-btn {
    flex: 1 1 calc(50% - 4px);
    min-width: 140px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .sound-style-btn:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
  }
  .sound-style-btn.active {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-tertiary));
  }
  .sound-style-btn:disabled {
    cursor: not-allowed;
  }
  .sound-style-name {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
  }
  .sound-style-btn.active .sound-style-name {
    color: var(--accent-primary);
  }
  .sound-style-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .chirp-legend {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .chirp-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border-secondary);
  }
  .chirp-row:last-child {
    border-bottom: none;
  }
  .chirp-row:nth-child(even) {
    background: var(--bg-tertiary);
  }
  .chirp-event {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-primary);
    min-width: 130px;
    flex-shrink: 0;
  }
  .chirp-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  /* Desktop notifications */
  .notify-status {
    font-size: var(--fs-xs);
    font-weight: 600;
    margin-left: 4px;
  }
  .notify-status.granted {
    color: var(--accent-secondary);
  }
  .notify-status.denied {
    color: var(--accent-error);
  }
  .notify-request-btn {
    margin-left: 4px;
    padding: 2px 10px;
    font-size: var(--fs-xs);
  }
  .notify-options {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .notify-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-secondary);
  }
  .notify-option-row:last-child {
    border-bottom: none;
  }
  .notify-option-row:nth-child(even) {
    background: var(--bg-tertiary);
  }
  .notify-option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  /* Terminal command policy */
  .terminal-policy-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .terminal-policy-option {
    padding: 8px 10px;
  }

  /* Permission rules scope selector */
  .perm-scope-row {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
    padding: 2px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .perm-scope-btn {
    flex: 1;
    padding: 5px 10px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    text-align: center;
  }
  .perm-scope-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .perm-scope-btn.active {
    color: var(--accent-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  /* Presets row */
  .perm-presets-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .perm-presets-label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .perm-preset-btn {
    padding: 3px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .perm-preset-btn:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  /* Add rule form */
  .perm-add-rule {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
    align-items: center;
  }
  .perm-rule-select {
    padding: 5px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    min-width: 70px;
  }
  .perm-tool-select {
    min-width: 100px;
  }
  .perm-pattern-input {
    flex: 1;
    padding: 5px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .perm-pattern-input:focus,
  .perm-rule-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .perm-add-btn {
    padding: 5px 12px;
    font-size: var(--fs-sm);
    white-space: nowrap;
  }

  /* Rules list */
  .perm-rules-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .perm-rule-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-secondary);
    font-size: var(--fs-sm);
  }
  .perm-rule-row:last-child {
    border-bottom: none;
  }
  .perm-rule-row:nth-child(even) {
    background: var(--bg-tertiary);
  }
  .perm-rule-type {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .perm-rule-type.allow {
    color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 15%, transparent);
  }
  .perm-rule-type.deny {
    color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 15%, transparent);
  }
  .perm-rule-type.ask {
    color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 15%, transparent);
  }
  .perm-rule-tool {
    font-weight: 600;
    color: var(--text-primary);
    flex-shrink: 0;
  }
  .perm-rule-pattern {
    font-family: var(--font-family);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .perm-rule-scope-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .perm-rule-delete {
    flex-shrink: 0;
    margin-left: auto;
  }
  .perm-rules-loading,
  .perm-rules-empty {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    padding: 16px 0;
    text-align: center;
  }

  /* ── Agent Profiles ── */
  .profiles-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .profiles-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .profiles-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .profile-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    transition: border-color var(--transition);
  }
  .profile-card.built-in {
    border-color: var(--border-primary);
  }
  .profile-card:hover {
    border-color: var(--accent-primary);
  }
  .profile-card-left {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .profile-card-name {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .built-in-badge {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .profile-card-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .profile-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .meta-chip {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .allow-chip {
    color: var(--accent-success, #4ade80);
    border-color: color-mix(in srgb, var(--accent-success, #4ade80) 30%, transparent);
  }
  .deny-chip {
    color: var(--accent-danger, #f87171);
    border-color: color-mix(in srgb, var(--accent-danger, #f87171) 30%, transparent);
  }
  .profile-card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  /* Profile form overlay */
  .profile-form-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
  }
  .profile-form {
    width: 540px;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg, var(--radius));
    box-shadow: var(--shadow-xl, var(--shadow-lg));
  }
  .profile-form-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-secondary);
  }
  .profile-form-header h3 {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .profile-form-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .profile-form-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 8px;
  }
  .required {
    color: var(--accent-danger, #f87171);
  }
  .btn-primary {
    padding: 7px 18px;
    font-size: var(--fs-base);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    border: none;
    cursor: pointer;
    transition: all var(--transition);
  }
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
