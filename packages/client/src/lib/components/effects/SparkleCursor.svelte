<script lang="ts">
  import { onMount } from 'svelte';

  interface Sparkle {
    el: HTMLElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    rotation: number;
    rotationSpeed: number;
  }

  const POOL_SIZE = 50;
  const SPAWN_INTERVAL = 40;
  const CLICK_BURST = 8;

  let container: HTMLElement;
  let cursorEl: HTMLElement;

  onMount(() => {
    const sparkles: Sparkle[] = [];
    const pool: HTMLElement[] = [];
    let mouseX = -100;
    let mouseY = -100;
    let lastSpawn = 0;
    let lastMoveX = 0;
    let lastMoveY = 0;
    let animId: number;
    let isHoveringClickable = false;

    // Hide the system cursor globally
    document.documentElement.style.cursor = 'none';
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { cursor: none !important; }';
    document.head.appendChild(style);

    // Pre-create sparkle pool
    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'sparkle';
      el.innerHTML = '✦';
      el.style.display = 'none';
      container.appendChild(el);
      pool.push(el);
    }

    function spawnSparkle(x: number, y: number, burst = false) {
      const el = pool.find((p) => p.style.display === 'none');
      if (!el) return;

      const angle = Math.random() * Math.PI * 2;
      const speed = burst ? 1.5 + Math.random() * 3 : 0.3 + Math.random() * 1;
      const size = burst ? 10 + Math.random() * 14 : 6 + Math.random() * 10;
      const maxLife = burst ? 40 + Math.random() * 30 : 25 + Math.random() * 20;

      const sparkle: Sparkle = {
        el,
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (burst ? 1.5 : 0.8),
        life: maxLife,
        maxLife,
        size,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
      };

      const colors = [
        'var(--accent-primary)',
        'var(--accent-secondary)',
        'var(--accent-warning)',
        '#fff',
      ];
      const color = colors[Math.floor(Math.random() * colors.length)];

      el.style.display = 'block';
      el.style.color = color;
      el.style.fontSize = `${size}px`;
      el.style.textShadow = `0 0 ${size * 0.6}px currentColor`;

      sparkles.push(sparkle);
    }

    function update() {
      // Update main cursor position with scale for Wizard's Study when hovering clickable
      const isStudyTheme = document.documentElement.getAttribute('data-hypertheme') === 'study';
      const scale = isStudyTheme && isHoveringClickable ? 1.25 : 1;
      cursorEl.style.transform = `translate(${mouseX}px, ${mouseY}px) scale(${scale})`;

      // Update trail sparkles
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i];
        s.life--;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.03;
        s.rotation += s.rotationSpeed;
        s.vx *= 0.98;

        const progress = 1 - s.life / s.maxLife;
        const scale = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
        const opacity = Math.max(0, scale);

        s.el.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.rotation}deg) scale(${opacity})`;
        s.el.style.opacity = String(opacity);

        if (s.life <= 0) {
          s.el.style.display = 'none';
          sparkles.splice(i, 1);
        }
      }

      animId = requestAnimationFrame(update);
    }

    function onMouseMove(e: MouseEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;

      // Check if hovering over a clickable element
      const target = e.target as HTMLElement;
      isHoveringClickable =
        target?.tagName === 'BUTTON' ||
        target?.tagName === 'A' ||
        target?.tagName === 'SELECT' ||
        target?.role === 'button' ||
        (target as HTMLInputElement)?.type === 'checkbox' ||
        (target as HTMLInputElement)?.type === 'radio' ||
        target?.classList?.contains('clickable') ||
        target?.closest(
          'button, a, [role="button"], select, input[type="checkbox"], input[type="radio"], .clickable',
        ) !== null;

      const dx = mouseX - lastMoveX;
      const dy = mouseY - lastMoveY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const now = performance.now();
      if (dist > 4 && now - lastSpawn > SPAWN_INTERVAL) {
        spawnSparkle(mouseX, mouseY);
        lastSpawn = now;
        lastMoveX = mouseX;
        lastMoveY = mouseY;
      }
    }

    function onClick(e: MouseEvent) {
      for (let i = 0; i < CLICK_BURST; i++) {
        spawnSparkle(e.clientX, e.clientY, true);
      }
      // Click flash on main cursor
      cursorEl.classList.add('click');
      setTimeout(() => cursorEl.classList.remove('click'), 300);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('click', onClick);
    animId = requestAnimationFrame(update);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('click', onClick);
      cancelAnimationFrame(animId);
      document.documentElement.style.cursor = '';
      style.remove();
    };
  });
</script>

<div class="sparkle-container" bind:this={container}>
  <div class="cursor-sparkle" bind:this={cursorEl}>
    <span class="star star-main">✦</span>
    <span class="star star-orbit-1">✦</span>
    <span class="star star-orbit-2">✧</span>
  </div>
</div>

<style>
  .sparkle-container {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 99999;
    overflow: hidden;
  }

  .sparkle-container :global(.sparkle) {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform, opacity;
    line-height: 1;
    user-select: none;
  }

  .cursor-sparkle {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform;
    /* offset so the center of the main star is at the cursor tip */
    margin-left: -10px;
    margin-top: -10px;
    /* anchor scale at the cursor point (center of main star) */
    transform-origin: 10px 10px;
  }

  .star {
    position: absolute;
    line-height: 1;
    user-select: none;
  }

  /* Main sparkle — pulses and slowly rotates at cursor point */
  .star-main {
    font-size: var(--fs-2xl);
    color: var(--accent-primary);
    text-shadow:
      0 0 8px var(--accent-primary),
      0 0 16px var(--accent-primary);
    animation:
      cursor-pulse 1.5s ease-in-out infinite,
      cursor-spin 4s linear infinite;
    filter: drop-shadow(0 0 3px var(--accent-primary));
  }

  /* Small orbiting sparkle 1 */
  .star-orbit-1 {
    font-size: 9px;
    color: var(--accent-secondary);
    text-shadow: 0 0 6px var(--accent-secondary);
    animation: orbit-1 2.5s linear infinite;
    transform-origin: 10px 10px;
  }

  /* Small orbiting sparkle 2 */
  .star-orbit-2 {
    font-size: 7px;
    color: var(--accent-warning);
    text-shadow: 0 0 4px var(--accent-warning);
    animation: orbit-2 3.2s linear infinite reverse;
    transform-origin: 10px 10px;
  }

  /* Click flash — scales up and goes white */
  .cursor-sparkle :global(.click .star-main) {
    animation: click-flash 0.3s ease-out;
  }

  @keyframes cursor-pulse {
    0%,
    100% {
      opacity: 0.85;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  @keyframes cursor-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes orbit-1 {
    from {
      transform: rotate(0deg) translateX(11px) rotate(0deg) scale(1);
    }
    25% {
      transform: rotate(90deg) translateX(11px) rotate(-90deg) scale(0.7);
    }
    50% {
      transform: rotate(180deg) translateX(11px) rotate(-180deg) scale(1);
    }
    75% {
      transform: rotate(270deg) translateX(11px) rotate(-270deg) scale(0.7);
    }
    to {
      transform: rotate(360deg) translateX(11px) rotate(-360deg) scale(1);
    }
  }

  @keyframes orbit-2 {
    from {
      transform: rotate(0deg) translateX(15px) rotate(0deg) scale(1);
    }
    25% {
      transform: rotate(90deg) translateX(15px) rotate(-90deg) scale(0.6);
    }
    50% {
      transform: rotate(180deg) translateX(15px) rotate(-180deg) scale(1);
    }
    75% {
      transform: rotate(270deg) translateX(15px) rotate(-270deg) scale(0.6);
    }
    to {
      transform: rotate(360deg) translateX(15px) rotate(-360deg) scale(1);
    }
  }

  @keyframes click-flash {
    0% {
      transform: scale(1);
      color: var(--accent-primary);
    }
    30% {
      transform: scale(2);
      color: #fff;
      text-shadow:
        0 0 20px #fff,
        0 0 40px var(--accent-primary);
    }
    100% {
      transform: scale(1);
      color: var(--accent-primary);
    }
  }
</style>
