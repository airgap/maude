<!--
  AmbientBackground — Canvas-based ambient effects for magic hyperthemes.
  Renders behind all UI elements with pointer-events: none.

  Activated for: arcane (sigils), ethereal (motes), astral (constellations)
  Inactive for: tech, study (CSS-only effects)

  Constellation themes use WebGL for GPU-accelerated star projection,
  nebulae, galaxies, and interactive constellation reveal on pointer hover.
  Other themes use Canvas2D.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { scrollStore } from '$lib/stores/scroll.svelte';
  import { createEffect, hasAmbientEffects, type AmbientEffect } from '$lib/ambient-fx';
  import { HYPERTHEME_EFFECTS } from '$lib/ambient-fx/types';
  import { WebGLRenderer } from '$lib/ambient-fx/webgl-renderer';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let activeEffect: AmbientEffect | null = null;
  let webglRenderer: WebGLRenderer | null = null;
  let animationId: number | null = null;
  let lastTime = 0;
  let currentHypertheme = '';
  let mounted = false;
  let usingWebGL = false;

  // Pointer tracking for interactive constellation reveal
  let pointerX = -1000;
  let pointerY = -1000;

  // Target ~24fps for Canvas2D effects (decorative, don't need 60fps)
  // WebGL runs at full rAF rate since GPU does the work
  const CANVAS2D_FRAME_INTERVAL = 1000 / 24;

  function isConstellationType(hyperthemeId: string): boolean {
    const config = HYPERTHEME_EFFECTS[hyperthemeId];
    return config?.type === 'constellation';
  }

  function destroyCurrent() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (activeEffect) {
      activeEffect.destroy();
      activeEffect = null;
    }
    if (webglRenderer) {
      webglRenderer.destroy();
      webglRenderer = null;
    }
    usingWebGL = false;
    ctx = null;
  }

  function initEffect(hyperthemeId: string) {
    destroyCurrent();
    currentHypertheme = hyperthemeId;

    if (!hasAmbientEffects(hyperthemeId) || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    if (isConstellationType(hyperthemeId)) {
      // ── WebGL path (constellations) ──────────────────────────────
      const renderer = new WebGLRenderer(hyperthemeId);
      const success = renderer.init(canvas, width * dpr, height * dpr);

      if (success) {
        webglRenderer = renderer;
        usingWebGL = true;
        lastTime = performance.now();
        tickWebGL();
        return;
      }
      // WebGL failed — fall through to Canvas2D
      console.warn('[AmbientBackground] WebGL failed, falling back to Canvas2D');
    }

    // ── Canvas2D path (sigils, motes, or WebGL fallback) ─────────
    ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    activeEffect = createEffect(hyperthemeId);
    if (activeEffect) {
      activeEffect.init(width, height);
      lastTime = performance.now();
      tickCanvas2D();
    }
  }

  // ── WebGL animation loop ────────────────────────────────────────
  function tickWebGL() {
    if (!webglRenderer || !canvas) return;

    animationId = requestAnimationFrame(tickWebGL);

    const now = performance.now();
    const elapsed = now - lastTime;
    lastTime = now;

    const deltaTime = Math.min(elapsed, 100);

    // Feed scroll and pointer
    webglRenderer.setScrollOffset(scrollStore.rawOffset);
    webglRenderer.setPointerPosition(pointerX, pointerY);

    // Update and render
    webglRenderer.update(deltaTime);
    webglRenderer.render();
  }

  // ── Canvas2D animation loop ─────────────────────────────────────
  function tickCanvas2D() {
    if (!activeEffect || !ctx || !canvas) return;

    animationId = requestAnimationFrame(tickCanvas2D);

    const now = performance.now();
    const elapsed = now - lastTime;
    if (elapsed < CANVAS2D_FRAME_INTERVAL) return;
    lastTime = now - (elapsed % CANVAS2D_FRAME_INTERVAL);

    const deltaTime = Math.min(elapsed, 100);

    if (activeEffect.setScrollOffset) {
      activeEffect.setScrollOffset(scrollStore.rawOffset);
    }
    if (activeEffect.setPointerPosition) {
      activeEffect.setPointerPosition(pointerX, pointerY);
    }

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
  }

  function handleResize() {
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    if (usingWebGL && webglRenderer) {
      webglRenderer.resize(width * dpr, height * dpr);
    } else if (ctx && activeEffect) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      activeEffect.resize(width, height);
    }
  }

  onMount(() => {
    mounted = true;
    initEffect(settingsStore.hypertheme);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);

    // Track pointer for interactive constellation reveal
    function onPointerMove(e: PointerEvent) {
      pointerX = e.clientX;
      pointerY = e.clientY;
    }
    function onPointerLeave() {
      pointerX = -1000;
      pointerY = -1000;
    }
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerleave', onPointerLeave);

    return () => {
      mounted = false;
      destroyCurrent();
      resizeObserver.disconnect();
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
    };
  });

  // React to hypertheme changes
  $effect(() => {
    const ht = settingsStore.hypertheme;
    if (mounted && ht !== currentHypertheme) {
      initEffect(ht);
    }
  });

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
    /* GPU acceleration — composites on its own layer */
    will-change: transform;
    transform: translateZ(0);
    contain: strict;
  }
  .ambient-canvas.active {
    opacity: 1;
  }
</style>
