<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { gitStore } from '$lib/stores/git.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';

  // Client-side pricing table (per million tokens)
  const PRICING: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6': { input: 15.0, output: 75.0 },
    'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
    'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  };
  const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

  function estimateCost(model: string, inputTokens: number, outputTokens: number): string {
    const p = PRICING[model] || DEFAULT_PRICING;
    const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
    return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
  }

  // Accumulate session-wide spend
  let sessionCost = $state(0);
  let lastTrackedTokens = $state({ input: 0, output: 0 });

  $effect(() => {
    const { input, output } = streamStore.tokenUsage;
    if (input > lastTrackedTokens.input || output > lastTrackedTokens.output) {
      const deltaIn = input - lastTrackedTokens.input;
      const deltaOut = output - lastTrackedTokens.output;
      const p = PRICING[settingsStore.model] || DEFAULT_PRICING;
      sessionCost += (deltaIn / 1_000_000) * p.input + (deltaOut / 1_000_000) * p.output;
      lastTrackedTokens = { input, output };
    }
  });

</script>

<footer class="statusbar">
  {#if streamStore.isStreaming && settingsStore.streamingProgressBar !== 'none'}
    <div class="statusbar-throbber {settingsStore.streamingProgressBar}" aria-hidden="true"></div>
  {/if}
  <div class="statusbar-left">
    <span class="status-item">
      {#if streamStore.isStreaming}
        <span class="status-dot streaming"></span> Streaming
      {:else if streamStore.status === 'tool_pending'}
        <span class="status-dot pending"></span> Tool approval pending
      {:else if streamStore.status === 'error'}
        <span class="status-dot error"></span> Error{#if streamStore.error}: {streamStore.error}{/if}
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

    {#if workStore.inProgressStories.length > 0}
      <span class="status-item task-status">
        {workStore.inProgressStories[0].title}
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
          onclick={() => lspStore.installServer(lang, settingsStore.workspacePath)}
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

    {#if settingsStore.showBudgetDisplay}
      {#if streamStore.tokenUsage.input || streamStore.tokenUsage.output}
        {@const cost = estimateCost(
          settingsStore.model,
          streamStore.tokenUsage.input,
          streamStore.tokenUsage.output,
        )}
        <span
          class="status-item tokens"
          title="Input: {streamStore.tokenUsage.input.toLocaleString()} / Output: {streamStore.tokenUsage.output.toLocaleString()} tokens"
        >
          {streamStore.tokenUsage.input.toLocaleString()}in / {streamStore.tokenUsage.output.toLocaleString()}out
          <span class="cost-badge">${cost}</span>
        </span>
      {/if}

      {#if sessionCost > 0}
        {@const budget = settingsStore.sessionBudgetUsd}
        {@const overBudget = budget && sessionCost >= budget}
        {@const nearBudget = budget && sessionCost >= budget * 0.8 && !overBudget}
        <span
          class="status-item session-cost"
          class:over-budget={overBudget}
          class:near-budget={nearBudget}
          title="Total session spend{budget ? ` (budget: $${budget.toFixed(2)})` : ''}"
        >
          Session: ${sessionCost.toFixed(4)}{budget ? ` / $${budget.toFixed(2)}` : ''}
        </span>
      {/if}
    {/if}

    <button
      class="status-item terminal-toggle"
      class:active={terminalStore.isOpen}
      onclick={() => terminalStore.toggle()}
      title="Toggle terminal (Ctrl+`)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    </button>

    <span class="status-item mode">
      {settingsStore.permissionMode}
    </span>

    <span class="status-item model">
      {settingsStore.model.split('-').slice(1, 3).join(' ')}
    </span>
  </div>
</footer>

<style>
  .statusbar-throbber {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    transform: translateY(-100%);
    pointer-events: none;
  }
  .statusbar-throbber.rainbow {
    background: linear-gradient(
      in oklab 90deg,
      oklch(var(--rainbow-l) 0.2 0),
      oklch(var(--rainbow-l) 0.2 60),
      oklch(var(--rainbow-l) 0.2 120),
      oklch(var(--rainbow-l) 0.2 180),
      oklch(var(--rainbow-l) 0.2 240),
      oklch(var(--rainbow-l) 0.2 300),
      oklch(var(--rainbow-l) 0.2 360)
    );
    background-size: 200% 100%;
    animation: rainbowSlide 2s linear infinite;
  }
  .statusbar-throbber.accent {
    background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
    background-size: 200% 100%;
    animation: accentSlide 1.5s ease-in-out infinite;
  }
  .statusbar-throbber.pulse {
    background: var(--accent-primary);
    animation: barPulse 2s ease-in-out infinite;
  }

  /* ── Neon: breathing neon glow ── */
  .statusbar-throbber.neon {
    background: var(--accent-primary);
    animation: neonBreathe 1.8s ease-in-out infinite;
  }

  /* ── Cylon: Knight Rider scanner ── */
  .statusbar-throbber.cylon {
    background: transparent;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    transform: translateY(-100%);
    overflow: hidden;
  }
  .statusbar-throbber.cylon::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 30%;
    height: 100%;
    background: linear-gradient(90deg, transparent, var(--accent-primary), var(--accent-primary), transparent);
    box-shadow: 0 0 12px var(--accent-primary), 0 0 4px var(--accent-primary);
    animation: cylonScan 1.4s ease-in-out infinite alternate;
  }

  /* ── Matrix: cascading digital green ── */
  .statusbar-throbber.matrix {
    background: repeating-linear-gradient(
      90deg,
      #00220080 0px,
      #00ff41cc 1px,
      #00ff4166 2px,
      #00220080 4px
    );
    background-size: 200% 100%;
    animation: matrixRain 0.8s linear infinite;
    box-shadow: 0 0 8px #00ff4199, 0 0 3px #00ff41cc;
  }

  /* ── Comet: bright dot streaking across ── */
  .statusbar-throbber.comet {
    background: transparent;
    overflow: hidden;
  }
  .statusbar-throbber.comet::after {
    content: '';
    position: absolute;
    top: 0;
    left: -10%;
    width: 10%;
    height: 100%;
    background: linear-gradient(90deg, transparent, var(--accent-primary) 60%, #fff 90%, transparent);
    box-shadow: 0 0 8px var(--accent-primary), 0 0 2px #fff;
    border-radius: 2px;
    animation: cometStreak 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  /* ── Helix: double-strand interweave ── */
  .statusbar-throbber.helix {
    background:
      repeating-linear-gradient(
        90deg,
        var(--accent-primary) 0px,
        transparent 2px,
        transparent 8px,
        var(--accent-primary) 10px
      ),
      repeating-linear-gradient(
        90deg,
        var(--accent-secondary) 4px,
        transparent 6px,
        transparent 12px,
        var(--accent-secondary) 14px
      );
    background-size: 200% 100%, 200% 100%;
    animation: helixSlide 1.5s linear infinite;
    opacity: 0.7;
  }

  /* ── Fire: warm blaze gradient ── */
  .statusbar-throbber.fire {
    background: linear-gradient(
      90deg,
      #ff440080, #ff880080, #ffcc0080, #ff660080, #ff220080, #ff880080
    );
    background-size: 300% 100%;
    animation: fireFlicker 1s ease-in-out infinite;
  }

  /* ── Ocean: deep blue wave ── */
  .statusbar-throbber.ocean {
    background: linear-gradient(
      90deg,
      #001a4d80, #0044aa80, #0088cc80, #00bbff80, #0066dd80, #001a4d80
    );
    background-size: 300% 100%;
    animation: oceanWave 3s ease-in-out infinite;
  }

  /* ── Electric: crackling spark ── */
  .statusbar-throbber.electric {
    background: transparent;
    overflow: hidden;
  }
  .statusbar-throbber.electric::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent 0%, transparent 45%,
      var(--accent-primary) 48%, #fff 50%, var(--accent-primary) 52%,
      transparent 55%, transparent 100%
    );
    background-size: 200% 100%;
    animation: electricSpark 0.4s steps(3) infinite;
    box-shadow: 0 0 4px var(--accent-primary);
  }

  /* ── Candy: pastel barber pole ── */
  .statusbar-throbber.candy {
    background: repeating-linear-gradient(
      -45deg,
      #ff88cc60,
      #ff88cc60 4px,
      #88ccff60 4px,
      #88ccff60 8px,
      #88ff8860 8px,
      #88ff8860 12px,
      #ffcc8860 12px,
      #ffcc8860 16px
    );
    background-size: 200% 100%;
    animation: candyScroll 1s linear infinite;
  }

  /* ── Vapor: vaporwave aesthetic ── */
  .statusbar-throbber.vapor {
    background: linear-gradient(
      90deg,
      #ff71ce80, #01cdfe80, #05ffa180, #b967ff80, #fffb9680, #ff71ce80
    );
    background-size: 300% 100%;
    animation: vaporDrift 5s ease-in-out infinite;
    filter: blur(0.3px) saturate(1.2);
  }

  /* ── Keyframes ── */
  @keyframes rainbowSlide {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }
  @keyframes accentSlide {
    0% {
      background-position: -200% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }
  @keyframes barPulse {
    0%,
    100% {
      opacity: 0.15;
    }
    50% {
      opacity: 0.6;
      box-shadow: 0 0 8px var(--accent-primary);
    }
  }
  @keyframes neonBreathe {
    0%, 100% {
      opacity: 0.2;
      box-shadow: 0 0 2px var(--accent-primary);
    }
    50% {
      opacity: 1;
      box-shadow: 0 0 12px var(--accent-primary), 0 0 24px var(--accent-primary), 0 0 4px #fff;
    }
  }
  @keyframes cylonScan {
    0% { left: -30%; }
    100% { left: 100%; }
  }
  @keyframes matrixRain {
    0% { background-position: 0% 0%; }
    100% { background-position: -4px 0%; }
  }
  @keyframes cometStreak {
    0% { left: -10%; opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 1; }
    100% { left: 110%; opacity: 0; }
  }
  @keyframes helixSlide {
    0% { background-position: 0% 0%, 0% 0%; }
    100% { background-position: 20px 0%, -20px 0%; }
  }
  @keyframes fireFlicker {
    0% { background-position: 0% 0%; opacity: 0.6; }
    25% { opacity: 0.9; }
    50% { background-position: 150% 0%; opacity: 0.5; }
    75% { opacity: 1; }
    100% { background-position: 300% 0%; opacity: 0.6; }
  }
  @keyframes oceanWave {
    0% { background-position: 0% 0%; }
    50% { background-position: 150% 0%; }
    100% { background-position: 300% 0%; }
  }
  @keyframes electricSpark {
    0% { background-position: 0% 0%; opacity: 0.3; }
    33% { background-position: 80% 0%; opacity: 1; }
    66% { background-position: 160% 0%; opacity: 0.2; }
    100% { background-position: 200% 0%; opacity: 0.8; }
  }
  @keyframes candyScroll {
    0% { background-position: 0 0; }
    100% { background-position: 32px 0; }
  }
  @keyframes vaporDrift {
    0% { background-position: 0% 0%; }
    50% { background-position: 150% 0%; }
    100% { background-position: 300% 0%; }
  }

  .statusbar {
    height: var(--statusbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--bg-secondary);
    border-top: var(--ht-separator);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-tertiary);
    flex-shrink: 0;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    position: relative;
    z-index: 1;
  }
  /* Let canvas effects bleed through in magic hyperthemes */
  :global([data-hypertheme='arcane']) .statusbar,
  :global([data-hypertheme='ethereal']) .statusbar,
  :global([data-hypertheme='astral']) .statusbar,
  :global([data-hypertheme='astral-midnight']) .statusbar {
    background: var(--bg-glass);
  }
  :global([data-hypertheme='study']) .statusbar {
    background: transparent;
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
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .status-dot.idle {
    background: var(--text-tertiary);
  }
  .status-dot.streaming {
    background: var(--accent-secondary);
    box-shadow:
      0 0 6px var(--accent-secondary),
      var(--shadow-glow-sm);
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
    font-size: var(--fs-xs);
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
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  .indent-label {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  .lang-label {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    color: var(--text-secondary);
  }


  .tokens {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    letter-spacing: 0.5px;
    color: var(--accent-primary);
  }
  .cost-badge {
    padding: 0 4px;
    background: var(--bg-active);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-size: var(--fs-xxs);
    margin-left: 4px;
  }
  .session-cost {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    letter-spacing: 0.5px;
    color: var(--accent-secondary);
    font-weight: 700;
  }
  .session-cost.near-budget {
    color: var(--accent-warning);
  }
  .session-cost.over-budget {
    color: var(--accent-error);
    animation: pulse 1.2s infinite;
  }

  .terminal-toggle {
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    transition: all var(--transition);
    border: none;
    background: none;
  }
  .terminal-toggle:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .terminal-toggle.active {
    color: var(--accent-primary);
  }

  .mode {
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-secondary);
  }

  .lsp-status {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
  }
  .lsp-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-sm);
  }
  .lsp-dot.connected {
    background: var(--accent-secondary);
    box-shadow: 0 0 4px var(--accent-secondary);
  }
  .lsp-dot.connecting {
    background: var(--accent-warning);
  }
  .lsp-dot.error {
    background: var(--accent-error);
  }

  .lsp-install {
    font-size: var(--fs-xs);
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    font-weight: 700;
  }
  .lsp-install:hover {
    background: var(--accent-primary);
    color: var(--bg-primary);
  }

  .lsp-dismiss {
    font-size: var(--fs-sm);
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

  /* ── Mobile: hide editor-specific clutter, keep stream status ── */
  :global([data-mobile]) .cursor-pos,
  :global([data-mobile]) .indent-label,
  :global([data-mobile]) .lang-label,
  :global([data-mobile]) .lsp-status,
  :global([data-mobile]) .lsp-install,
  :global([data-mobile]) .lsp-dismiss,
  :global([data-mobile]) .tokens,
  :global([data-mobile]) .session-cost,
  :global([data-mobile]) .mode,
  :global([data-mobile]) .model {
    display: none;
  }
  :global([data-mobile]) .task-status {
    max-width: 40vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global([data-mobile]) .statusbar {
    padding: 0 10px;
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
