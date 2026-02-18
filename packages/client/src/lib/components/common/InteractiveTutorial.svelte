<script lang="ts">
  import { tutorialStore, TUTORIAL_STEPS } from '$lib/stores/tutorial.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { onMount } from 'svelte';

  let mounted = $state(false);

  onMount(() => {
    mounted = true;
  });

  const step = $derived(tutorialStore.currentStep);
  const stepIndex = $derived(tutorialStore.currentStepIndex);
  const total = $derived(tutorialStore.totalSteps);
  const isFirst = $derived(stepIndex === 0);
  const isLast = $derived(stepIndex === total - 1);
  const progress = $derived(tutorialStore.progress);

  function handleAction(actionId: string) {
    switch (actionId) {
      case 'focus-chat':
        uiStore.focusChatInput();
        break;
      case 'toggle-sidebar':
        uiStore.toggleSidebar();
        break;
      case 'toggle-editor':
        if (editorStore.layoutMode === 'chat-only') {
          editorStore.setLayoutMode('split-horizontal');
        } else {
          editorStore.setLayoutMode('chat-only');
        }
        break;
      case 'open-command-palette':
        uiStore.openModal('command-palette');
        break;
      case 'open-work-panel':
        uiStore.setSidebarTab('work');
        break;
      case 'open-settings':
        uiStore.openModal('settings');
        break;
    }
  }

  function handleNext() {
    if (isLast) {
      tutorialStore.complete();
    } else {
      tutorialStore.next();
    }
  }

  function handlePrev() {
    tutorialStore.prev();
  }

  function handleDismiss() {
    tutorialStore.dismiss();
  }

  function handleFinish() {
    tutorialStore.complete();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!tutorialStore.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleDismiss();
    }
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (!(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        handleNext();
      }
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handlePrev();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if tutorialStore.active && mounted}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tutorial-overlay" onclick={handleDismiss}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tutorial-modal" onclick={(e) => e.stopPropagation()}>
      <!-- Progress bar -->
      <div class="progress-track">
        <div class="progress-fill" style="width: {progress}%"></div>
      </div>

      <!-- Header -->
      <div class="tutorial-header">
        <div class="step-indicator">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={step.icon} />
          </svg>
          <span class="step-number">Step {stepIndex + 1} of {total}</span>
        </div>
        <button class="close-btn" onclick={handleDismiss} title="Dismiss tutorial (Esc)">
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

      <!-- Step nav dots -->
      <div class="step-dots">
        {#each TUTORIAL_STEPS as s, i}
          <button
            class="step-dot"
            class:active={i === stepIndex}
            class:visited={tutorialStore.stepsVisited.includes(s.id)}
            onclick={() => tutorialStore.goToStep(i)}
            title={s.title}
          >
            {#if i === stepIndex}
              <span class="dot-ring"></span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Content -->
      <div class="tutorial-content">
        <h2 class="step-title">{step.title}</h2>
        <p class="step-description">{step.description}</p>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="step-body">{@html step.body}</div>
      </div>

      <!-- Actions -->
      <div class="tutorial-actions">
        <div class="actions-left">
          {#if step.actionLabel && step.actionId}
            <button
              class="try-btn"
              onclick={() => step.actionId && handleAction(step.actionId)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {step.actionLabel}
            </button>
          {/if}
        </div>

        <div class="actions-right">
          {#if !isFirst}
            <button class="nav-btn secondary" onclick={handlePrev}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              Back
            </button>
          {/if}

          {#if !isLast && !isFirst}
            <button class="skip-btn" onclick={handleFinish}>
              Skip All
            </button>
          {/if}

          <button class="nav-btn primary" onclick={handleNext}>
            {#if isLast}
              Get Started
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
            {:else}
              Next
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .tutorial-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 200ms ease;
    padding: 16px;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .tutorial-modal {
    width: 100%;
    max-width: 560px;
    max-height: 85vh;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg, 12px);
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.5),
      0 0 0 1px var(--border-secondary),
      var(--shadow-glow-sm);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 250ms ease;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* ── Progress bar ── */
  .progress-track {
    height: 3px;
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary, var(--accent-primary)));
    border-radius: 0 2px 2px 0;
    transition: width 300ms ease;
  }

  /* ── Header ── */
  .tutorial-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 0;
    flex-shrink: 0;
  }

  .step-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--accent-primary);
  }

  .step-number {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .close-btn {
    padding: 4px;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  /* ── Step dots ── */
  .step-dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px 4px;
    flex-shrink: 0;
  }

  .step-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    transition: all 200ms ease;
    position: relative;
    padding: 0;
    cursor: pointer;
  }

  .step-dot.visited {
    background: color-mix(in srgb, var(--accent-primary) 40%, transparent);
    border-color: color-mix(in srgb, var(--accent-primary) 60%, transparent);
  }

  .step-dot.active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 40%, transparent);
  }

  .dot-ring {
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    animation: dotPulse 2s ease infinite;
  }

  @keyframes dotPulse {
    0%,
    100% {
      opacity: 0.4;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
    }
  }

  /* ── Content ── */
  .tutorial-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    min-height: 0;
  }

  .step-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 4px;
    line-height: 1.3;
  }

  .step-description {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0 0 14px;
    font-weight: 500;
  }

  .step-body {
    font-size: 13px;
    line-height: 1.6;
  }

  .step-body :global(h3) {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 16px 0 6px;
  }
  .step-body :global(p) {
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0 0 8px;
  }
  .step-body :global(ul),
  .step-body :global(ol) {
    color: var(--text-secondary);
    padding-left: 18px;
    margin: 0 0 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .step-body :global(li) {
    line-height: 1.5;
  }
  .step-body :global(strong) {
    color: var(--text-primary);
    font-weight: 600;
  }
  .step-body :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--accent-primary);
  }
  .step-body :global(kbd) {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 1px 6px;
    color: var(--text-primary);
    white-space: nowrap;
  }

  /* ── Actions ── */
  .tutorial-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    flex-shrink: 0;
    gap: 8px;
  }

  .actions-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .actions-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .try-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    cursor: pointer;
  }
  .try-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 600;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    cursor: pointer;
  }

  .nav-btn.secondary {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
  }
  .nav-btn.secondary:hover {
    color: var(--text-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .nav-btn.primary {
    color: var(--bg-primary);
    background: var(--accent-primary);
    border: 1px solid var(--accent-primary);
  }
  .nav-btn.primary:hover {
    filter: brightness(1.1);
    box-shadow: var(--shadow-glow-sm);
  }

  .skip-btn {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    cursor: pointer;
  }
  .skip-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  /* ── Hypertheme variants ── */

  :global([data-hypertheme='arcane']) .tutorial-modal {
    border: 3px double var(--border-primary);
  }

  :global([data-hypertheme='ethereal']) .tutorial-modal {
    border: none;
    border-radius: var(--radius-xl, 16px);
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.4),
      0 0 0 1px var(--border-secondary);
    backdrop-filter: blur(8px);
  }

  :global([data-hypertheme='study']) .tutorial-modal {
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.3),
      0 0 20px rgba(228, 160, 60, 0.06);
  }
</style>
