<script lang="ts">
  import { commentaryStore } from '$lib/stores/commentary.svelte';
  import { api } from '$lib/api/client';

  interface Props {
    workspaceId: string | null | undefined;
  }

  let { workspaceId }: Props = $props();

  let ttsEnabled = $derived(commentaryStore.ttsEnabled);
  let ttsVolume = $derived(commentaryStore.ttsVolume);
  let ttsPaused = $derived(commentaryStore.ttsPaused);

  async function toggleTts() {
    if (ttsEnabled) {
      commentaryStore.disableTts();
    } else {
      commentaryStore.enableTts(ttsVolume);
    }
    await saveTtsSettings();
  }

  let volumeSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleVolumeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const volume = parseFloat(target.value);
    commentaryStore.setTtsVolume(volume);
    // Debounce saving to avoid too many requests
    if (volumeSaveTimeout !== null) {
      clearTimeout(volumeSaveTimeout);
    }
    volumeSaveTimeout = setTimeout(() => saveTtsSettings(), 500);
  }

  function toggleTtsPause() {
    if (ttsPaused) {
      commentaryStore.resumeTts();
    } else {
      commentaryStore.pauseTts();
    }
  }

  async function saveTtsSettings() {
    if (workspaceId) {
      try {
        await api.workspaces.update(workspaceId, {
          settings: {
            commentaryTtsEnabled: ttsEnabled,
            commentaryTtsVolume: ttsVolume,
          },
        });
      } catch (err) {
        console.error('[commentary-tts] Failed to save TTS settings:', err);
      }
    }
  }
</script>

<div class="tts-controls">
  <!-- TTS Toggle Button -->
  <button
    class="tts-btn"
    class:active={ttsEnabled}
    onclick={toggleTts}
    title={ttsEnabled ? 'Disable text-to-speech' : 'Enable text-to-speech'}
  >
    {#if ttsEnabled}
      <!-- Volume On Icon -->
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    {:else}
      <!-- Muted Icon -->
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>
    {/if}
  </button>

  <!-- TTS Volume Slider (only visible when TTS is enabled) -->
  {#if ttsEnabled}
    <div class="volume-control" title={`Volume: ${Math.round(ttsVolume * 100)}%`}>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={ttsVolume}
        oninput={handleVolumeChange}
        class="volume-slider"
      />
    </div>

    <!-- TTS Pause/Resume Button (only visible when TTS is enabled) -->
    <button
      class="pause-btn"
      onclick={toggleTtsPause}
      title={ttsPaused ? 'Resume text-to-speech' : 'Pause text-to-speech'}
    >
      {#if ttsPaused}
        <!-- Play Icon -->
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      {:else}
        <!-- Pause Icon -->
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      {/if}
    </button>
  {/if}
</div>

<style>
  .tts-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tts-btn,
  .pause-btn {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .tts-btn:hover,
  .pause-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .tts-btn.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  .volume-control {
    display: flex;
    align-items: center;
  }

  .volume-slider {
    width: 60px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border-secondary);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .volume-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  .volume-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-primary);
    border: none;
    cursor: pointer;
    transition: all var(--transition);
  }

  .volume-slider::-moz-range-thumb:hover {
    transform: scale(1.2);
  }

  /* Animations */
  .volume-control {
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
</style>
