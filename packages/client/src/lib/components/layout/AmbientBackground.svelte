<!--
  AmbientBackground — Canvas-based ambient effects for magic hyperthemes.
  Renders behind all UI elements with pointer-events: none.

  Activated for: arcane (sigils), ethereal (motes), astral (stars)
  Inactive for: tech, study (CSS-only effects)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { createEffect, hasAmbientEffects, type AmbientEffect } from '$lib/ambient-fx';
  import { HYPERTHEME_EFFECTS } from '$lib/ambient-fx/types';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let activeEffect: AmbientEffect | null = null;
  let animationId: number | null = null;
  let lastTime = 0;
  let currentHypertheme = '';
  let mounted = false;

  function initEffect(hyperthemeId: string) {
    // Destroy previous effect
    if (activeEffect) {
      activeEffect.destroy();
      activeEffect = null;
    }
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    currentHypertheme = hyperthemeId;

    if (!hasAmbientEffects(hyperthemeId) || !canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    activeEffect = createEffect(hyperthemeId);
    if (activeEffect) {
      activeEffect.init(width, height);
      lastTime = performance.now();
      console.log(`[AmbientBackground] Started ${hyperthemeId} effect at ${width}x${height}`);
      tick();
    } else {
      console.warn(`[AmbientBackground] No effect created for ${hyperthemeId}`);
    }
  }

  function tick() {
    if (!activeEffect || !ctx || !canvas) return;

    const now = performance.now();
    const deltaTime = now - lastTime;
    lastTime = now;

    // Clear canvas
    const config = HYPERTHEME_EFFECTS[currentHypertheme];
    if (config) {
      ctx.fillStyle = config.colors.backgroundColor;
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    } else {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }

    activeEffect.update(deltaTime);
    activeEffect.render(ctx);

    animationId = requestAnimationFrame(tick);
  }

  function handleResize() {
    if (!canvas || !ctx || !activeEffect) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    activeEffect.resize(width, height);
  }

  onMount(() => {
    mounted = true;
    ctx = canvas.getContext('2d');
    initEffect(settingsStore.hypertheme);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);

    return () => {
      mounted = false;
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
      if (activeEffect) {
        activeEffect.destroy();
      }
      resizeObserver.disconnect();
    };
  });

  // React to hypertheme changes
  $effect(() => {
    const ht = settingsStore.hypertheme;
    if (mounted && ht !== currentHypertheme) {
      initEffect(ht);
    }
  });

  // Determine if we should show the canvas
  let isActive = $derived(hasAmbientEffects(settingsStore.hypertheme));
</script>

<canvas bind:this={canvas} class="ambient-canvas" class:active={isActive} aria-hidden="true"
></canvas>

<style>
  .ambient-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    transition: opacity 1s ease;
  }
  .ambient-canvas.active {
    opacity: 1;
  }
</style>
