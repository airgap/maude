/**
 * Ambient FX types — adapted from lyku/ambient-fx for Maude hyperthemes
 */

export interface AmbientThemeColors {
  particleColor1: string;
  particleColor2: string;
  particleColor3: string;
  glowColor: string;
  backgroundColor: string;
}

export interface ParticleConfig {
  count: number;
  sizeMin: number;
  sizeMax: number;
  speedMin: number;
  speedMax: number;
  opacity: number;
  drift: number;
  blur: number;
}

/**
 * Base interface for all ambient effects
 */
export interface AmbientEffect {
  init(width: number, height: number): void;
  resize(width: number, height: number): void;
  update(deltaTime: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  destroy(): void;
  /** Feed page scroll offset for parallax / sphere rotation */
  setScrollOffset?(offset: number): void;
  /** Feed pointer position for interactive constellation reveal */
  setPointerPosition?(x: number, y: number): void;
}

/**
 * Hypertheme ambient effect configurations
 */
export const HYPERTHEME_EFFECTS: Record<
  string,
  { type: string; config: ParticleConfig; colors: AmbientThemeColors }
> = {
  arcane: {
    type: 'sigil',
    config: {
      count: 40,
      sizeMin: 3,
      sizeMax: 8,
      speedMin: 0.3,
      speedMax: 1.5,
      opacity: 0.7,
      drift: 50,
      blur: 1,
    },
    colors: {
      particleColor1: 'rgba(139, 92, 246, 0.7)',
      particleColor2: 'rgba(167, 139, 250, 0.6)',
      particleColor3: 'rgba(34, 211, 238, 0.55)',
      glowColor: 'rgba(139, 92, 246, 0.8)',
      backgroundColor: '#0a0612',
    },
  },
  ethereal: {
    type: 'motes',
    config: {
      count: 80,
      sizeMin: 1,
      sizeMax: 4,
      speedMin: 0.1,
      speedMax: 0.6,
      opacity: 0.6,
      drift: 20,
      blur: 2,
    },
    colors: {
      particleColor1: 'rgba(180, 160, 220, 0.3)',
      particleColor2: 'rgba(160, 200, 220, 0.25)',
      particleColor3: 'rgba(200, 160, 190, 0.2)',
      glowColor: 'rgba(180, 160, 220, 0.4)',
      backgroundColor: '#0c0814',
    },
  },
  astral: {
    type: 'constellation',
    config: {
      count: 150,
      sizeMin: 2,
      sizeMax: 6,
      speedMin: 0,
      speedMax: 0.5,
      opacity: 0.9,
      drift: 0,
      blur: 0,
    },
    colors: {
      particleColor1: 'rgba(255, 255, 255, 0.95)',
      particleColor2: 'rgba(147, 197, 253, 0.9)',
      particleColor3: 'rgba(251, 191, 36, 0.8)',
      glowColor: 'rgba(96, 165, 250, 0.6)',
      backgroundColor: '#020817',
    },
  },
  'astral-midnight': {
    type: 'constellation',
    config: {
      count: 150,
      sizeMin: 2,
      sizeMax: 6,
      speedMin: 0,
      speedMax: 0.5,
      opacity: 0.95,
      drift: 0,
      blur: 0,
    },
    colors: {
      particleColor1: 'rgba(255, 255, 255, 0.95)',
      particleColor2: 'rgba(180, 200, 255, 0.9)',
      particleColor3: 'rgba(100, 150, 255, 0.8)',
      glowColor: 'rgba(80, 120, 200, 0.4)',
      backgroundColor: '#000000',
    },
  },
};
