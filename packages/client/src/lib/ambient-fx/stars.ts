/**
 * Stars Effect — Twinkling star field for Astral hypertheme
 */
import type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

interface Star {
  x: number;
  y: number;
  size: number;
  r: number;
  g: number;
  b: number;
  baseOpacity: number;
  opacity: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 200, g: 210, b: 230 };
}

export class StarsEffect implements AmbientEffect {
  private stars: Star[] = [];
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

    this.stars = Array.from({ length: this.config.count }, (_, i) => {
      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);

      return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: this.config.sizeMin + Math.random() * (this.config.sizeMax - this.config.sizeMin),
        r,
        g,
        b,
        baseOpacity: 0.3 + Math.random() * 0.6,
        opacity: 0,
        twinkleSpeed: 0.5 + Math.random() * 2.0,
        twinklePhase: Math.random() * Math.PI * 2,
      };
    });
  }

  resize(width: number, height: number): void {
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.width = width;
    this.height = height;
    for (const s of this.stars) {
      s.x *= scaleX;
      s.y *= scaleY;
    }
  }

  update(deltaTime: number): void {
    this.time += deltaTime * 0.001;

    for (const star of this.stars) {
      const twinkle = Math.sin(this.time * star.twinkleSpeed + star.twinklePhase);
      star.opacity = star.baseOpacity * (0.4 + 0.6 * (twinkle * 0.5 + 0.5));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const star of this.stars) {
      if (star.opacity < 0.05) continue;

      // Draw glow for larger stars
      if (star.size > 1.5) {
        const gradient = ctx.createRadialGradient(
          star.x,
          star.y,
          0,
          star.x,
          star.y,
          star.size * 2.5,
        );
        gradient.addColorStop(0, `rgba(${star.r}, ${star.g}, ${star.b}, ${star.opacity * 0.3})`);
        gradient.addColorStop(1, `rgba(${star.r}, ${star.g}, ${star.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw star core
      ctx.fillStyle = `rgba(${star.r}, ${star.g}, ${star.b}, ${star.opacity})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  destroy(): void {
    this.stars = [];
  }
}
