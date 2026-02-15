/**
 * Ambient FX — Canvas-based visual effects for hyperthemes
 *
 * Each magic hypertheme gets a unique particle/effect system:
 * - Arcane: Rotating sigil circles with Elder Futhark runes
 * - Ethereal: Floating luminous motes
 * - Astral: Twinkling star field
 *
 * Tech and Study hyperthemes use CSS-only effects (no canvas needed).
 */

export { SigilEffect } from './sigil';
export { MotesEffect } from './motes';
export { StarsEffect } from './stars';
export { HYPERTHEME_EFFECTS } from './types';
export type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

import type { AmbientEffect } from './types';
import { HYPERTHEME_EFFECTS } from './types';
import { SigilEffect } from './sigil';
import { MotesEffect } from './motes';
import { StarsEffect } from './stars';

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
