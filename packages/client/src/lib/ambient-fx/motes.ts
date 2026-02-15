/**
 * Motes Effect — Floating luminous particles for Ethereal hypertheme
 *
 * Performance optimization: pre-renders each mote's glow to an offscreen
 * canvas sprite at init time, then uses drawImage() instead of creating
 * new radial gradients every frame.
 */
import type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

interface Mote {
  x: number;
  y: number;
  size: number;
  baseSize: number;
  speed: number;
  opacity: number;
  baseOpacity: number;
  r: number;
  g: number;
  b: number;
  angle: number;
  drift: number;
  phase: number;
  phaseSpeed: number;
  /** Pre-rendered glow sprite */
  sprite: OffscreenCanvas;
  spriteSize: number;
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 180, g: 160, b: 220 };
}

/**
 * Pre-render a mote's glow + core to an offscreen canvas.
 * The sprite includes the radial gradient glow and bright center dot.
 */
function createMoteSprite(
  r: number,
  g: number,
  b: number,
  maxSize: number,
): { canvas: OffscreenCanvas; size: number } {
  const glowRadius = maxSize * 3;
  const dim = Math.ceil(glowRadius * 2) + 2;
  const oc = new OffscreenCanvas(dim, dim);
  const ctx = oc.getContext('2d')!;
  const cx = dim / 2;
  const cy = dim / 2;

  // Glow
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.6)`);
  gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.2)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, dim, dim);

  // Core
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
  ctx.beginPath();
  ctx.arc(cx, cy, maxSize * 0.5, 0, Math.PI * 2);
  ctx.fill();

  return { canvas: oc, size: dim };
}

export class MotesEffect implements AmbientEffect {
  private motes: Mote[] = [];
  private width = 0;
  private height = 0;
  private time = 0;

  constructor(
    private config: ParticleConfig,
    private colors: AmbientThemeColors,
  ) {}

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;

    const colorStrings = [
      this.colors.particleColor1,
      this.colors.particleColor2,
      this.colors.particleColor3,
    ];

    // Pre-render sprites per color
    const spriteCache = new Map<string, { canvas: OffscreenCanvas; size: number }>();

    this.motes = Array.from({ length: this.config.count }, (_, i) => {
      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);
      const baseSize =
        this.config.sizeMin + Math.random() * (this.config.sizeMax - this.config.sizeMin);

      // Get or create sprite for this color at max size
      const spriteKey = `${r},${g},${b}`;
      let spriteData = spriteCache.get(spriteKey);
      if (!spriteData) {
        spriteData = createMoteSprite(r, g, b, this.config.sizeMax);
        spriteCache.set(spriteKey, spriteData);
      }

      return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: baseSize,
        baseSize,
        speed: this.config.speedMin + Math.random() * (this.config.speedMax - this.config.speedMin),
        opacity: 0,
        baseOpacity: 0.2 + Math.random() * 0.5,
        r,
        g,
        b,
        angle: Math.random() * Math.PI * 2,
        drift: (Math.random() - 0.5) * this.config.drift,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.3 + Math.random() * 0.7,
        sprite: spriteData.canvas,
        spriteSize: spriteData.size,
      };
    });
  }

  resize(width: number, height: number): void {
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.width = width;
    this.height = height;
    for (const m of this.motes) {
      m.x *= scaleX;
      m.y *= scaleY;
    }
  }

  update(deltaTime: number): void {
    this.time += deltaTime * 0.001;

    for (const mote of this.motes) {
      // Gentle floating motion
      mote.angle += (Math.random() - 0.5) * 0.02;
      mote.x += Math.cos(mote.angle) * mote.speed + Math.sin(this.time * 0.3 + mote.phase) * 0.1;
      mote.y += Math.sin(mote.angle) * mote.speed - 0.15; // Slight upward drift

      // Pulsing opacity
      mote.opacity =
        mote.baseOpacity * (0.5 + 0.5 * Math.sin(this.time * mote.phaseSpeed + mote.phase));

      // Breathing size
      mote.size =
        mote.baseSize * (0.8 + 0.4 * Math.sin(this.time * mote.phaseSpeed * 0.7 + mote.phase));

      // Wrap around
      if (mote.x < -10) mote.x = this.width + 10;
      if (mote.x > this.width + 10) mote.x = -10;
      if (mote.y < -10) mote.y = this.height + 10;
      if (mote.y > this.height + 10) mote.y = -10;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const mote of this.motes) {
      if (mote.opacity < 0.02) continue;

      // Draw pre-rendered sprite with current opacity and size scaling
      const scale = mote.size / this.config.sizeMax;
      const drawSize = mote.spriteSize * scale;
      ctx.globalAlpha = mote.opacity;
      ctx.drawImage(
        mote.sprite,
        mote.x - drawSize * 0.5,
        mote.y - drawSize * 0.5,
        drawSize,
        drawSize,
      );
    }
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.motes = [];
  }
}
