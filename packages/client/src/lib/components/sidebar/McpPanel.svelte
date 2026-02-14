<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';

  interface McpServer {
    name: string;
    transport: string;
    command?: string;
    url?: string;
    status: string;
    scope: string;
  }

  const PRESETS = [
    {
      name: 'filesystem',
      label: 'Filesystem',
      desc: 'Read/write local files',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/'],
    },
    {
      name: 'github',
      label: 'GitHub',
      desc: 'Repos, issues, PRs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
    {
      name: 'postgres',
      label: 'PostgreSQL',
      desc: 'Query databases',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    },
    {
      name: 'brave-search',
      label: 'Brave Search',
      desc: 'Web search',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
    },
    {
      name: 'memory',
      label: 'Memory',
      desc: 'Knowledge graph memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    {
      name: 'puppeteer',
      label: 'Puppeteer',
      desc: 'Browser automation',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  ];

  let servers = $state<McpServer[]>([]);
  let loading = $state(true);
  let showAdd = $state(false);
  let addForm = $state({
    name: '',
    transport: 'stdio' as 'stdio' | 'sse' | 'http',
    command: '',
    args: '',
    url: '',
    env: '',
  });

  async function loadServers() {
    try {
      const res = await api.mcp.listServers();
      servers = res.data;
    } catch {
      /* */
    }
    loading = false;
  }

  async function addServer() {
    if (!addForm.name) return;
    try {
      await api.mcp.addServer({
        name: addForm.name,
        transport: addForm.transport,
        command: addForm.command || undefined,
        args: addForm.args ? addForm.args.split(/\s+/).filter(Boolean) : undefined,
        url: addForm.url || undefined,
        env: addForm.env ? JSON.parse(addForm.env) : undefined,
      });
      addForm = { name: '', transport: 'stdio', command: '', args: '', url: '', env: '' };
      showAdd = false;
      await loadServers();
      uiStore.toast('MCP server added', 'success');
    } catch (e) {
      uiStore.toast(`Failed: ${e}`, 'error');
    }
  }

  async function installPreset(preset: (typeof PRESETS)[0]) {
    try {
      await api.mcp.addServer({
        name: preset.name,
        transport: preset.transport,
        command: preset.command,
        args: preset.args,
        env: preset.env,
      });
      await loadServers();
      uiStore.toast(`${preset.label} added`, 'success');
    } catch {
      uiStore.toast(`Failed to add ${preset.label}`, 'error');
    }
  }

  async function removeServer(name: string) {
    try {
      await api.mcp.removeServer(name);
      servers = servers.filter((s) => s.name !== name);
      uiStore.toast('Server removed', 'info');
    } catch {
      uiStore.toast('Failed to remove server', 'error');
    }
  }

  onMount(loadServers);

  let installedNames = $derived(new Set(servers.map((s) => s.name)));
</script>

<div class="mcp-panel">
  <div class="panel-header">
    <h3>MCP Servers</h3>
    <button class="add-btn" onclick={() => (showAdd = !showAdd)} title="Add custom server">+</button
    >
  </div>

  {#if loading}
    <div class="empty">Loading...</div>
  {:else}
    {#if servers.length > 0}
      <div class="server-list">
        {#each servers as server (server.name)}
          <div class="server-item">
            <div class="server-info">
              <span class="server-name">{server.name}</span>
              <span class="server-transport">{server.transport}</span>
            </div>
            <div class="server-meta">
              {#if server.command}
                <span class="server-cmd">{server.command}</span>
              {:else if server.url}
                <span class="server-cmd">{server.url}</span>
              {/if}
            </div>
            <div class="server-actions">
              <span class="status-dot" class:connected={server.status === 'connected'}></span>
              <button class="remove-btn" onclick={() => removeServer(server.name)} title="Remove">
                &times;
              </button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">No MCP servers configured</div>
    {/if}

    {#if showAdd}
      <div class="add-form">
        <input bind:value={addForm.name} placeholder="Server name" class="form-input" />
        <select bind:value={addForm.transport} class="form-input">
          <option value="stdio">stdio</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
        {#if addForm.transport === 'stdio'}
          <input bind:value={addForm.command} placeholder="Command (e.g. npx)" class="form-input" />
          <input
            bind:value={addForm.args}
            placeholder="Args (space-separated)"
            class="form-input"
          />
        {:else}
          <input bind:value={addForm.url} placeholder="URL" class="form-input" />
        {/if}
        <input
          bind:value={addForm.env}
          placeholder={'Env JSON (e.g. {"KEY":"val"})'}
          class="form-input"
        />
        <button class="save-btn" onclick={addServer}>Add Server</button>
      </div>
    {/if}

    <div class="presets-section">
      <h4 class="section-title">Quick Add</h4>
      <div class="preset-grid">
        {#each PRESETS as preset}
          <button
            class="preset-btn"
            disabled={installedNames.has(preset.name)}
            onclick={() => installPreset(preset)}
            title={preset.desc}
          >
            <span class="preset-name">{preset.label}</span>
            <span class="preset-desc">{preset.desc}</span>
            {#if installedNames.has(preset.name)}
              <span class="preset-installed">Installed</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .mcp-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
  }
  .panel-header h3 {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-secondary);
    margin: 0;
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
  }
  .add-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .empty {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .server-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .server-item {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    position: relative;
  }
  .server-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .server-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .server-transport {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 1px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
  }
  .server-meta {
    margin-top: 2px;
  }
  .server-cmd {
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
    word-break: break-all;
  }
  .server-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    background: var(--text-tertiary);
  }
  .status-dot.connected {
    background: var(--accent-secondary);
    box-shadow: 0 0 4px var(--accent-secondary);
  }
  .remove-btn {
    font-size: 14px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    line-height: 1;
    padding: 0 2px;
  }
  .remove-btn:hover {
    color: var(--accent-error);
  }
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
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
  .save-btn {
    font-size: 11px;
    padding: 4px 12px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
  }
  .save-btn:hover {
    opacity: 0.9;
  }
  .presets-section {
    margin-top: 8px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
    margin: 0 0 6px 8px;
  }
  .preset-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .preset-btn {
    display: flex;
    flex-direction: column;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    text-align: left;
    cursor: pointer;
    transition: all var(--transition);
    position: relative;
  }
  .preset-btn:hover:not(:disabled) {
    border-color: var(--accent-primary);
  }
  .preset-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .preset-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .preset-desc {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .preset-installed {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: 9px;
    color: var(--accent-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style>
