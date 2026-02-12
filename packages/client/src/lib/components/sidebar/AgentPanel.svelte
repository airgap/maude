<script lang="ts">
  import { api } from '$lib/api/client';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { onMount } from 'svelte';

  interface Agent {
    id: string;
    type: string;
    description: string;
    status: string;
    spawnedAt: number;
    completedAt?: number;
    result?: string;
    error?: string;
  }

  let agents = $state<Agent[]>([]);
  let pollInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    loadAgents();
    pollInterval = setInterval(loadAgents, 5000);
    return () => clearInterval(pollInterval);
  });

  async function loadAgents() {
    try {
      const res = await api.agents.list(streamStore.sessionId ?? undefined);
      agents = res.data;
    } catch {}
  }

  async function cancelAgent(id: string) {
    await api.agents.cancel(id);
    loadAgents();
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'running':
        return 'var(--accent-primary)';
      case 'completed':
        return 'var(--accent-secondary)';
      case 'error':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function elapsed(from: number, to?: number): string {
    const ms = (to || Date.now()) - from;
    if (ms < 1000) return '<1s';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  }
</script>

<div class="agent-panel">
  <div class="agent-header">
    <h3>Agents</h3>
    <span class="agent-count">{agents.filter((a) => a.status === 'running').length} active</span>
  </div>

  <div class="agent-list">
    {#each agents as agent (agent.id)}
      <div class="agent-item">
        <div class="agent-item-header">
          <span class="agent-dot" style:background={statusColor(agent.status)}></span>
          <span class="agent-type">{agent.type}</span>
          <span class="agent-time">{elapsed(agent.spawnedAt, agent.completedAt)}</span>
          {#if agent.status === 'running'}
            <button class="cancel-btn" onclick={() => cancelAgent(agent.id)}>Cancel</button>
          {/if}
        </div>
        <div class="agent-desc truncate">{agent.description}</div>
        {#if agent.error}
          <div class="agent-error">{agent.error}</div>
        {/if}
      </div>
    {:else}
      <div class="empty">No agents running</div>
    {/each}
  </div>
</div>

<style>
  .agent-panel {
    padding: 8px;
  }
  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 4px 8px;
  }
  .agent-header h3 {
    font-size: 13px;
    font-weight: 600;
  }
  .agent-count {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .agent-list {
    overflow-y: auto;
  }

  .agent-item {
    padding: 8px;
    border-radius: var(--radius-sm);
    margin-bottom: 4px;
    background: var(--bg-tertiary);
  }

  .agent-item-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .agent-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .agent-type {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .agent-time {
    font-size: 10px;
    color: var(--text-tertiary);
    margin-left: auto;
  }
  .agent-desc {
    font-size: 11px;
    color: var(--text-secondary);
  }
  .agent-error {
    font-size: 11px;
    color: var(--accent-error);
    margin-top: 4px;
  }

  .cancel-btn {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--accent-error);
    color: var(--text-on-accent);
  }

  .empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
