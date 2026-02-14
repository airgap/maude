<script lang="ts">
  import { onMount } from 'svelte';
  import { renderMarkdownPartial } from '$lib/utils/markdown';

  interface Props {
    text: string;
    streaming?: boolean;
  }

  let { text, streaming = false }: Props = $props();

  let displayText = $state('');
  let mounted = $state(false);
  let animationKey = $state(0);

  // Just update display text instantly - CSS will handle the animation
  $effect(() => {
    if (!streaming || !mounted) {
      displayText = text;
      return;
    }

    // Update immediately when new text arrives
    displayText = text;
    // Trigger re-animation by changing key
    animationKey++;
  });

  onMount(() => {
    mounted = true;
    displayText = text;
  });
</script>

<div class="streaming-text-wrapper" class:active={streaming} data-key={animationKey}>
  <div class="prose" class:streaming={streaming}>
    {@html renderMarkdownPartial(displayText)}
  </div>
  {#if streaming}
    <span class="cursor">▊</span>
  {/if}
</div>

<style>
  .streaming-text-wrapper {
    position: relative;
    display: inline-block;
  }

  .streaming-text-wrapper.active .prose {
    display: inline;
  }

  /* Streaming text reveal animation */
  .prose.streaming {
    animation: textPulseIn 0.2s ease-out;
    position: relative;
  }

  /* Add a subtle glow wave effect to streaming text */
  .prose.streaming::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(0, 180, 255, 0.1) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: textGlowWave 1.5s ease-in-out infinite;
    pointer-events: none;
    z-index: 1;
  }

  .cursor {
    display: inline-block;
    margin-left: 2px;
    color: var(--accent-primary);
    animation: cursorBlink 0.8s step-end infinite, cursorGlow 2s ease-in-out infinite;
    text-shadow: 0 0 8px rgba(0, 180, 255, 0.8);
    font-weight: bold;
  }

  @keyframes textPulseIn {
    0% {
      opacity: 0.7;
      transform: translateY(2px);
      filter: blur(1px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
      filter: blur(0);
    }
  }

  @keyframes textGlowWave {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  @keyframes cursorBlink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }

  @keyframes cursorGlow {
    0%,
    100% {
      text-shadow: 0 0 8px rgba(0, 180, 255, 0.8), 0 0 12px rgba(0, 180, 255, 0.4);
      transform: scaleY(1);
    }
    50% {
      text-shadow: 0 0 16px rgba(0, 180, 255, 1), 0 0 24px rgba(0, 180, 255, 0.6),
        0 0 32px rgba(0, 255, 255, 0.3);
      transform: scaleY(1.1);
    }
  }

  .prose {
    line-height: 1.7;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    font-size: 14px;
    font-weight: 500;
    position: relative;
    z-index: 2;
  }
</style>
