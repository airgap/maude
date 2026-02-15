/**
 * Motes Effect — Floating luminous particles for Ethereal hypertheme
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
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 180, g: 160, b: 220 };
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

    this.motes = Array.from({ length: this.config.count }, (_, i) => {
      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);
      const baseSize =
        this.config.sizeMin + Math.random() * (this.config.sizeMax - this.config.sizeMin);

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

      // Draw glow
      const gradient = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, mote.size * 3);
      gradient.addColorStop(0, `rgba(${mote.r}, ${mote.g}, ${mote.b}, ${mote.opacity * 0.6})`);
      gradient.addColorStop(0.4, `rgba(${mote.r}, ${mote.g}, ${mote.b}, ${mote.opacity * 0.2})`);
      gradient.addColorStop(1, `rgba(${mote.r}, ${mote.g}, ${mote.b}, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.size * 3, 0, Math.PI * 2);
      ctx.fill();

      // Draw core
      ctx.fillStyle = `rgba(${mote.r}, ${mote.g}, ${mote.b}, ${mote.opacity})`;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  destroy(): void {
    this.motes = [];
  }
}
