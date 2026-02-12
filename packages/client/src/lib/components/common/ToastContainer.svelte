<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
</script>

{#if uiStore.toasts.length > 0}
  <div class="toast-container">
    {#each uiStore.toasts as toast (toast.id)}
      <div class="toast toast-{toast.type}">
        <span class="toast-message">{toast.message}</span>
        <button class="toast-dismiss" onclick={() => uiStore.dismissToast(toast.id)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 48px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2000;
    max-width: 400px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    color: var(--text-primary);
    animation: slideIn 200ms ease;
  }

  .toast-info { border-left: 3px solid var(--accent-info); }
  .toast-success { border-left: 3px solid var(--accent-secondary); }
  .toast-error { border-left: 3px solid var(--accent-error); }
  .toast-warning { border-left: 3px solid var(--accent-warning); }

  .toast-message { flex: 1; }

  .toast-dismiss {
    color: var(--text-tertiary);
    padding: 2px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .toast-dismiss:hover { background: var(--bg-hover); color: var(--text-primary); }

  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
