<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import WorkspaceTabBar from './WorkspaceTabBar.svelte';

  const models = [
    { id: 'claude-opus-4-6', label: 'Opus 4.6' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ];

  function togglePlanMode() {
    if (!conversationStore.active) return;
    conversationStore.setPlanMode(!conversationStore.active.planMode);
  }
</script>

<header class="topbar">
  <div class="topbar-left">
    <button
      class="icon-btn"
      onclick={() => uiStore.toggleSidebar()}
      title="Toggle sidebar (Ctrl+/)"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
    </button>
    <span class="brand">Maude</span>
    <WorkspaceTabBar />
  </div>

  <div class="topbar-center">
    {#if conversationStore.active}
      <span class="conv-title truncate">{conversationStore.active.title}</span>
    {/if}
  </div>

  <div class="topbar-right">
    {#if conversationStore.active?.planMode}
      <span class="plan-badge">PLAN MODE</span>
    {/if}

    <button
      class="plan-toggle"
      class:active={conversationStore.active?.planMode}
      onclick={togglePlanMode}
      title="Toggle plan mode (Shift+Tab x2)"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>

    <select
      class="model-select"
      value={settingsStore.model}
      onchange={(e) => settingsStore.setModel((e.target as HTMLSelectElement).value)}
    >
      {#each models as m}
        <option value={m.id}>{m.label}</option>
      {/each}
    </select>

    <div
      class="context-meter"
      title="Context usage: {streamStore.tokenUsage.input + streamStore.tokenUsage.output} tokens"
    >
      <div
        class="context-meter-fill"
        style:width="{Math.min(
          100,
          ((streamStore.tokenUsage.input + streamStore.tokenUsage.output) / 200000) * 100,
        )}%"
      ></div>
    </div>

    <button class="icon-btn" onclick={() => uiStore.openModal('settings')} title="Settings">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        />
      </svg>
    </button>
  </div>
</header>

<style>
  .topbar {
    height: var(--topbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--bg-glass);
    border-bottom: var(--ht-separator);
    gap: 12px;
    flex-shrink: 0;
    z-index: 10;
    position: relative;
  }
  /* Topbar accent overlay — varies per hypertheme */
  .topbar::after {
    content: '';
    position: absolute;
    inset: 0;
    /* Tech default: scanlines */
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      var(--border-secondary) 2px,
      var(--border-secondary) 4px
    );
    pointer-events: none;
  }

  :global([data-hypertheme='arcane']) .topbar::after {
    background: linear-gradient(180deg, transparent 90%, var(--border-primary) 100%);
  }

  :global([data-hypertheme='ethereal']) .topbar::after {
    background: linear-gradient(180deg, transparent 92%, var(--border-secondary) 100%);
  }

  :global([data-hypertheme='study']) .topbar::after {
    background: none;
    border-bottom: 1px double var(--border-primary);
  }

  :global([data-hypertheme='astral']) .topbar::after {
    background:
      radial-gradient(0.5px 0.5px at 10% 50%, var(--border-primary), transparent),
      radial-gradient(0.5px 0.5px at 30% 30%, var(--border-secondary), transparent),
      radial-gradient(0.5px 0.5px at 50% 70%, var(--border-primary), transparent),
      radial-gradient(0.5px 0.5px at 70% 40%, var(--border-secondary), transparent),
      radial-gradient(0.5px 0.5px at 90% 60%, var(--border-primary), transparent);
  }

  .topbar-left,
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .topbar-center {
    flex: 1;
    text-align: center;
    min-width: 0;
  }

  .brand {
    font-weight: 700;
    font-size: 17px;
    letter-spacing: var(--ht-brand-spacing);
    text-transform: var(--ht-brand-transform);
    color: var(--accent-primary);
    text-shadow: var(--shadow-glow-sm);
  }

  .conv-title {
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .icon-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .model-select {
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    text-transform: var(--ht-label-transform);
  }
  .model-select:hover {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .plan-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: var(--radius);
    background: var(--accent-warning);
    color: var(--text-on-accent);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    animation: hudBlink 3s infinite;
  }

  .plan-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .plan-toggle:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
    border-color: var(--border-primary);
  }
  .plan-toggle.active {
    color: var(--accent-warning);
    background: var(--bg-hover);
    border-color: var(--border-primary);
  }

  .context-meter {
    width: 64px;
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    overflow: hidden;
    position: relative;
    border: 1px solid var(--border-secondary);
  }
  .context-meter-fill {
    height: 100%;
    background: var(--accent-primary);
    border-radius: var(--radius-sm);
    transition: width 500ms linear;
    box-shadow: var(--shadow-glow-sm);
  }
</style>
