<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { taskStore } from '$lib/stores/tasks.svelte';
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

    {#if taskStore.inProgress.length > 0}
      <span class="status-item task-status">
        {taskStore.inProgress[0].activeForm || taskStore.inProgress[0].subject}
      </span>
    {/if}
  </div>

  <div class="statusbar-right">
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

  .task-status {
    color: var(--accent-primary);
    animation: pulse 2s infinite;
    font-weight: 700;
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
