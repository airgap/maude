/**
 * Ambient FX — Visual effects for hyperthemes
 *
 * Each magic hypertheme gets a unique effect system:
 * - Arcane: Rotating sigil circles with Elder Futhark runes (Canvas2D)
 * - Ethereal: Floating luminous motes (Canvas2D)
 * - Astral: Real star catalog with constellations, nebulae, galaxies (WebGL)
 *
 * Constellation themes use WebGL by default (AmbientBackground.svelte handles
 * the WebGLRenderer directly). The Canvas2D ConstellationEffect serves as
 * fallback if WebGL is unavailable.
 *
 * Tech and Study hyperthemes use CSS-only effects (no canvas needed).
 */

export { SigilEffect } from './sigil';
export { MotesEffect } from './motes';
export { StarsEffect } from './stars';
export { ConstellationEffect } from './constellation';
export { WebGLRenderer } from './webgl-renderer';
export { HYPERTHEME_EFFECTS } from './types';
export type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

import type { AmbientEffect } from './types';
import { HYPERTHEME_EFFECTS } from './types';
import { SigilEffect } from './sigil';
import { MotesEffect } from './motes';
import { StarsEffect } from './stars';
import { ConstellationEffect } from './constellation';

/**
 * Create the appropriate effect for a hypertheme
 */
export function createEffect(hyperthemeId: string): AmbientEffect | null {
  const config = HYPERTHEME_EFFECTS[hyperthemeId];
  if (!config) return null;

  switch (config.type) {
    case 'sigil':
      return new SigilEffect(config.config, config.colors);
    case 'motes':
      return new MotesEffect(config.config, config.colors);
    case 'stars':
      return new StarsEffect(config.config, config.colors);
    case 'constellation':
      return new ConstellationEffect(config.config, config.colors);
    default:
      return null;
  }
}

/**
 * Check if a hypertheme has canvas-based ambient effects
 */
export function hasAmbientEffects(hyperthemeId: string): boolean {
  return hyperthemeId in HYPERTHEME_EFFECTS;
}
