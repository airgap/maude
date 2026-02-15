/**
 * Sigil Effect — 3D magical circles with Elder Futhark runes
 * Adapted from lyku/ambient-fx for Maude's Arcane hypertheme
 */
import type { AmbientEffect, AmbientThemeColors } from './types';

interface SigilRing {
  radius: number;
  rotationSpeed: number;
  segments: number;
  style: 'solid' | 'dashed' | 'dotted';
}

interface SigilRune {
  angle: number;
  radius: number;
  symbol: number;
  wavePhase: number;
}

interface Sigil {
  x: number;
  y: number;
  z: number;
  size: number;
  rotation: number;
  tiltX: number;
  tiltY: number;
  rings: SigilRing[];
  runes: SigilRune[];
  r: number;
  g: number;
  b: number;
  opacity: number;
  pulsePhase: number;
  pulseSpeed: number;
  vx: number;
  vy: number;
  vz: number;
}

interface Fragment {
  x: number;
  y: number;
  z: number;
  type: 'arc' | 'rune';
  rotation: number;
  rotationSpeed: number;
  tiltX: number;
  tiltY: number;
  r: number;
  g: number;
  b: number;
  opacity: number;
  vx: number;
  vy: number;
  arcRadius?: number;
  arcStart?: number;
  arcEnd?: number;
  symbol?: number;
  runeSize?: number;
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 200, g: 150, b: 60 };
}

// Spell sequences for sigil rings — rune indices map to Elder Futhark
const SPELLS = [
  {
    name: 'ward',
    rings: [
      [14, 16, 2, 14, 8, 10, 14, 16, 2, 14, 8, 10, 14, 16, 2, 14],
      [2, 16, 14, 12, 8, 2, 16, 14],
    ],
  },
  {
    name: 'light',
    rings: [
      [15, 22, 5, 7, 0, 15, 22, 5, 7, 0, 15, 22, 5, 7, 0, 15, 22],
      [5, 15, 22, 7, 21, 5, 15, 22],
    ],
  },
  {
    name: 'strength',
    rings: [
      [1, 16, 15, 14, 2, 1, 16, 15, 14, 2, 1, 16, 15, 14, 2, 1, 16, 15],
      [16, 1, 15, 18, 14, 16, 1, 15, 18, 14, 16, 1],
      [1, 2, 16, 15, 1, 2, 16],
    ],
  },
  {
    name: 'wisdom',
    rings: [
      [3, 5, 19, 13, 22, 3, 5, 19, 13, 22, 3, 5, 19, 13, 22, 3, 5, 19],
      [19, 3, 5, 13, 12, 19, 3, 5, 13, 12, 19],
      [3, 13, 19, 5, 3, 13],
    ],
  },
  {
    name: 'prosperity',
    rings: [
      [0, 11, 23, 21, 6, 7, 0, 11, 23, 21, 6, 7, 0, 11, 23, 21, 6, 7, 0, 11],
      [0, 6, 21, 11, 23, 0, 6, 21, 11, 23, 0, 6, 21, 11],
      [11, 0, 23, 7, 21, 11, 0, 23, 7, 21],
      [0, 21, 11, 6, 0, 21],
    ],
  },
  {
    name: 'protection',
    rings: [
      [14, 2, 16, 10, 8, 12, 14, 2, 16, 10, 8, 12, 14, 2, 16, 10, 8, 12, 14, 2],
      [16, 14, 8, 2, 10, 16, 14, 8, 2, 10, 16, 14, 8, 2],
      [14, 12, 2, 8, 16, 14, 12, 2, 8, 16],
      [2, 14, 16, 2, 14, 16],
    ],
  },
];

const ARCHETYPES = [
  { rings: 2, sizeRange: [0.05, 0.08] as const, speedMult: 1.8 },
  { rings: 3, sizeRange: [0.08, 0.12] as const, speedMult: 1.0 },
  { rings: 4, sizeRange: [0.1, 0.15] as const, speedMult: 0.7 },
  { rings: 5, sizeRange: [0.14, 0.2] as const, speedMult: 0.4 },
];

/**
 * Draw an Elder Futhark rune glyph
 */
function drawElderFuthark(
  ctx: CanvasRenderingContext2D,
  runeIndex: number,
  size: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
  lineWidth: number,
): void {
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.lineWidth = lineWidth * 0.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const s = size;
  ctx.beginPath();
  switch (runeIndex % 24) {
    case 0: // ᚠ Fehu
      ctx.moveTo(0, s);
      ctx.lineTo(0, -s);
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.6, -s * 0.4);
      ctx.moveTo(0, -s * 0.2);
      ctx.lineTo(s * 0.6, s * 0.2);
      break;
    case 1: // ᚢ Uruz
      ctx.moveTo(-s * 0.3, s);
      ctx.lineTo(-s * 0.3, -s);
      ctx.lineTo(s * 0.3, -s * 0.2);
      ctx.lineTo(s * 0.3, s);
      break;
    case 2: // ᚦ Thurisaz
      ctx.moveTo(0, s);
      ctx.lineTo(0, -s);
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.5, -s * 0.4);
      ctx.lineTo(0, s * 0.1);
      break;
    case 3: // ᚨ Ansuz
      ctx.moveTo(0, s);
      ctx.lineTo(0, -s);
      ctx.moveTo(0, -s * 0.6);
      ctx.lineTo(s * 0.5, -s * 0.2);
      ctx.moveTo(0, -s * 0.1);
      ctx.lineTo(s * 0.5, s * 0.3);
      break;
    case 4: // ᚱ Raidho
      ctx.moveTo(-s * 0.2, s);
      ctx.lineTo(-s * 0.2, -s);
      ctx.moveTo(-s * 0.2, -s);
      ctx.lineTo(s * 0.4, -s * 0.4);
      ctx.lineTo(-s * 0.2, s * 0.1);
      ctx.moveTo(-s * 0.2, s * 0.1);
      ctx.lineTo(s * 0.4, s);
      break;
    case 5: // ᚲ Kenaz
      ctx.moveTo(-s * 0.3, -s);
      ctx.lineTo(s * 0.3, 0);
      ctx.lineTo(-s * 0.3, s);
      break;
    case 6: // ᚷ Gebo
      ctx.moveTo(-s * 0.5, -s * 0.7);
      ctx.lineTo(s * 0.5, s * 0.7);
      ctx.moveTo(s * 0.5, -s * 0.7);
      ctx.lineTo(-s * 0.5, s * 0.7);
      break;
    case 7: // ᚹ Wunjo
      ctx.moveTo(-s * 0.2, s);
      ctx.lineTo(-s * 0.2, -s);
      ctx.moveTo(-s * 0.2, -s);
      ctx.lineTo(s * 0.4, -s * 0.3);
      ctx.lineTo(-s * 0.2, s * 0.3);
      break;
    case 8: // ᚺ Hagalaz
      ctx.moveTo(-s * 0.4, -s);
      ctx.lineTo(-s * 0.4, s);
      ctx.moveTo(s * 0.4, -s);
      ctx.lineTo(s * 0.4, s);
      ctx.moveTo(-s * 0.4, s * 0.1);
      ctx.lineTo(s * 0.4, -s * 0.4);
      break;
    case 9: // ᚾ Nauthiz
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.moveTo(-s * 0.4, -s * 0.2);
      ctx.lineTo(s * 0.4, s * 0.2);
      break;
    case 10: // ᛁ Isa
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      break;
    case 11: // ᛃ Jera
      ctx.moveTo(s * 0.1, -s);
      ctx.lineTo(s * 0.4, -s * 0.4);
      ctx.lineTo(s * 0.1, 0);
      ctx.moveTo(-s * 0.1, s);
      ctx.lineTo(-s * 0.4, s * 0.4);
      ctx.lineTo(-s * 0.1, 0);
      break;
    case 12: // ᛇ Eihwaz
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.moveTo(0, -s * 0.5);
      ctx.lineTo(s * 0.4, -s * 0.8);
      ctx.moveTo(0, s * 0.5);
      ctx.lineTo(-s * 0.4, s * 0.8);
      break;
    case 13: // ᛈ Perthro
      ctx.moveTo(-s * 0.3, s);
      ctx.lineTo(-s * 0.3, -s);
      ctx.moveTo(-s * 0.3, -s);
      ctx.lineTo(s * 0.3, -s * 0.4);
      ctx.moveTo(-s * 0.3, s);
      ctx.lineTo(s * 0.3, s * 0.4);
      break;
    case 14: // ᛉ Algiz
      ctx.moveTo(0, s);
      ctx.lineTo(0, -s * 0.2);
      ctx.moveTo(0, -s * 0.2);
      ctx.lineTo(-s * 0.5, -s);
      ctx.moveTo(0, -s * 0.2);
      ctx.lineTo(s * 0.5, -s);
      ctx.moveTo(0, -s * 0.2);
      ctx.lineTo(0, -s);
      break;
    case 15: // ᛊ Sowilo
      ctx.moveTo(-s * 0.4, -s);
      ctx.lineTo(s * 0.1, -s * 0.2);
      ctx.lineTo(-s * 0.1, s * 0.2);
      ctx.lineTo(s * 0.4, s);
      break;
    case 16: // ᛏ Tiwaz
      ctx.moveTo(0, s);
      ctx.lineTo(0, -s);
      ctx.moveTo(-s * 0.5, -s);
      ctx.lineTo(0, -s * 0.4);
      ctx.lineTo(s * 0.5, -s);
      break;
    case 17: // ᛒ Berkano
      ctx.moveTo(-s * 0.2, s);
      ctx.lineTo(-s * 0.2, -s);
      ctx.moveTo(-s * 0.2, -s);
      ctx.lineTo(s * 0.3, -s * 0.5);
      ctx.lineTo(-s * 0.2, 0);
      ctx.moveTo(-s * 0.2, 0);
      ctx.lineTo(s * 0.3, s * 0.5);
      ctx.lineTo(-s * 0.2, s);
      break;
    case 18: // ᛖ Ehwaz
      ctx.moveTo(-s * 0.3, s);
      ctx.lineTo(-s * 0.3, -s);
      ctx.moveTo(s * 0.3, s);
      ctx.lineTo(s * 0.3, -s);
      ctx.moveTo(-s * 0.3, 0);
      ctx.lineTo(s * 0.3, -s * 0.4);
      ctx.moveTo(-s * 0.3, s * 0.4);
      ctx.lineTo(s * 0.3, 0);
      break;
    case 19: // ᛗ Mannaz
      ctx.moveTo(-s * 0.4, s);
      ctx.lineTo(-s * 0.4, -s);
      ctx.lineTo(0, -s * 0.3);
      ctx.lineTo(s * 0.4, -s);
      ctx.lineTo(s * 0.4, s);
      ctx.moveTo(-s * 0.4, -s * 0.3);
      ctx.lineTo(0, s * 0.1);
      ctx.lineTo(s * 0.4, -s * 0.3);
      break;
    case 20: // ᛚ Laguz
      ctx.moveTo(-s * 0.2, s);
      ctx.lineTo(-s * 0.2, -s);
      ctx.lineTo(s * 0.4, -s * 0.3);
      break;
    case 21: // ᛝ Ingwaz
      ctx.moveTo(0, -s * 0.7);
      ctx.lineTo(s * 0.5, 0);
      ctx.lineTo(0, s * 0.7);
      ctx.lineTo(-s * 0.5, 0);
      ctx.closePath();
      break;
    case 22: // ᛞ Dagaz
      ctx.moveTo(-s * 0.4, -s * 0.7);
      ctx.lineTo(s * 0.4, -s * 0.7);
      ctx.lineTo(-s * 0.4, s * 0.7);
      ctx.lineTo(s * 0.4, s * 0.7);
      break;
    case 23: // ᛟ Othala
      ctx.moveTo(-s * 0.4, s);
      ctx.lineTo(-s * 0.4, s * 0.1);
      ctx.lineTo(0, -s * 0.7);
      ctx.lineTo(s * 0.4, s * 0.1);
      ctx.lineTo(s * 0.4, s);
      ctx.moveTo(-s * 0.4, s * 0.1);
      ctx.lineTo(s * 0.4, s * 0.1);
      break;
  }
  ctx.stroke();
}

/**
 * Sigil Effect — 3D magical circles with rotating runes
 */
export class SigilEffect implements AmbientEffect {
  private sigils: Sigil[] = [];
  private fragments: Fragment[] = [];
  private width = 0;
  private height = 0;
  private lineWidth = 1;
  private startTime = 0;
  private scrollOffset = 0;

  constructor(
    private config: { count: number },
    private colors: AmbientThemeColors,
  ) {}

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.startTime = performance.now();
    this.lineWidth = 1.5;

    const minDim = Math.min(width, height);
    const sigilCount = this.config.count;

    const colorStrings = [
      this.colors.particleColor1,
      this.colors.particleColor2,
      this.colors.particleColor3,
    ];

    const spellsByRings: Record<number, typeof SPELLS> = {};
    for (const spell of SPELLS) {
      const ringCount = spell.rings.length;
      if (!spellsByRings[ringCount]) spellsByRings[ringCount] = [];
      spellsByRings[ringCount].push(spell);
    }

    this.sigils = Array.from({ length: sigilCount }, (_, i) => {
      const archetype = ARCHETYPES[i % ARCHETYPES.length];
      const numRings = archetype.rings;
      const [sizeMin, sizeMax] = archetype.sizeRange;
      const size = minDim * (sizeMin + Math.random() * (sizeMax - sizeMin));

      const baseSegments = numRings <= 2 ? 6 : numRings <= 4 ? 8 : 12;

      const rings: SigilRing[] = Array.from({ length: numRings }, (_, j) => ({
        radius: numRings === 1 ? 0.8 : 0.25 + (j / (numRings - 1)) * 0.7,
        rotationSpeed: 0.005 * archetype.speedMult * (j % 2 === 0 ? 1 : -1) * (1 + j * 0.15),
        segments: baseSegments * (j % 2 === 0 ? 1 : 2),
        style: (['solid', 'dashed', 'dotted'] as const)[j % 3],
      }));

      let spell = SPELLS[i % SPELLS.length];
      for (let r = numRings; r >= 2; r--) {
        if (spellsByRings[r] && spellsByRings[r].length > 0) {
          spell = spellsByRings[r][i % spellsByRings[r].length];
          break;
        }
      }

      const runes: SigilRune[] = [];
      for (let gap = 0; gap < Math.min(numRings, spell.rings.length); gap++) {
        const innerRingRadius = gap === 0 ? 0 : rings[gap - 1].radius;
        const outerRingRadius = rings[gap].radius;
        const midRadius = (innerRingRadius + outerRingRadius) / 2;

        const spellRingIdx = spell.rings.length - 1 - gap;
        const ringRunes = spell.rings[spellRingIdx] || spell.rings[0];

        const ringDepth = gap / Math.max(1, numRings - 1);
        const wordSizes =
          ringDepth < 0.3 ? [1, 2, 1, 2, 1] : ringDepth < 0.6 ? [2, 3, 2, 2, 3] : [3, 4, 5, 3, 4];

        let runeIdx = 0;
        let wordIdx = 0;
        const totalRunes = ringRunes.length;

        const words: number[][] = [];
        while (runeIdx < totalRunes) {
          const wordSize = Math.min(wordSizes[wordIdx % wordSizes.length], totalRunes - runeIdx);
          words.push(ringRunes.slice(runeIdx, runeIdx + wordSize));
          runeIdx += wordSize;
          wordIdx++;
        }

        const wordGap = 0.08;
        const totalGapSpace = wordGap * words.length;
        const runeSpace = (1 - totalGapSpace) / totalRunes;

        let currentAngle = 0;
        for (const word of words) {
          for (let r = 0; r < word.length; r++) {
            const angle = currentAngle * Math.PI * 2;
            const wavePhase = gap * 0.8 + angle * 0.5;
            runes.push({ angle, radius: midRadius, symbol: word[r], wavePhase });
            currentAngle += runeSpace;
          }
          currentAngle += wordGap;
        }
      }

      const z = 0.2 + Math.random() * 0.7;

      // Grid-based spacing with jitter
      const gridCols = Math.ceil(Math.sqrt((sigilCount * width) / height));
      const gridRows = Math.ceil(sigilCount / gridCols);
      const cellW = width / gridCols;
      const cellH = height / gridRows;
      const gridX = (i % gridCols) * cellW + cellW / 2;
      const gridY = Math.floor(i / gridCols) * cellH + cellH / 2;
      const jitterX = (Math.random() - 0.5) * cellW * 0.8;
      const jitterY = (Math.random() - 0.5) * cellH * 0.8;

      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);

      return {
        x: gridX + jitterX,
        y: gridY + jitterY,
        z,
        size,
        rotation: Math.random() * Math.PI * 2,
        tiltX: 0,
        tiltY: 0,
        rings,
        runes,
        r,
        g,
        b,
        opacity: 0.5 + z * 0.4,
        pulsePhase: (i / sigilCount) * Math.PI * 2,
        pulseSpeed: 0.15 + 0.55 * (1 - (size / minDim - 0.04) / 0.16),
        vx: (Math.random() - 0.5) * 0.3 * archetype.speedMult,
        vy: (Math.random() - 0.5) * 0.3 * archetype.speedMult,
        vz: (Math.random() - 0.5) * 0.002,
      };
    });

    // Create fragments — broken sigil pieces
    const fragmentCount = Math.floor(sigilCount * 0.5);
    this.fragments = Array.from({ length: fragmentCount }, (_, i) => {
      const isArc = Math.random() > 0.4;
      const z = 0.1 + Math.random() * 0.8;
      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);

      const fragment: Fragment = {
        x: Math.random() * width,
        y: Math.random() * height,
        z,
        type: isArc ? 'arc' : 'rune',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.008,
        tiltX: 0,
        tiltY: 0,
        r,
        g,
        b,
        opacity: 0.35 + z * 0.3,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
      };

      if (isArc) {
        fragment.arcRadius = minDim * (0.015 + Math.random() * 0.04);
        const arcLength = (0.08 + Math.random() * 0.17) * Math.PI * 2;
        fragment.arcStart = Math.random() * Math.PI * 2;
        fragment.arcEnd = fragment.arcStart + arcLength;
      } else {
        fragment.symbol = Math.floor(Math.random() * 24);
        fragment.runeSize = minDim * (0.008 + Math.random() * 0.015);
      }

      return fragment;
    });
  }

  resize(width: number, height: number): void {
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.width = width;
    this.height = height;
    for (const s of this.sigils) {
      s.x *= scaleX;
      s.y *= scaleY;
    }
    for (const f of this.fragments) {
      f.x *= scaleX;
      f.y *= scaleY;
    }
  }

  update(deltaTime: number): void {
    this.scrollOffset += deltaTime * 0.01;

    for (const sigil of this.sigils) {
      sigil.x += sigil.vx;
      sigil.y += sigil.vy;
      sigil.z += sigil.vz;

      const buffer = sigil.size;
      if (sigil.x < -buffer) sigil.x = this.width + buffer;
      if (sigil.x > this.width + buffer) sigil.x = -buffer;
      if (sigil.y < -buffer) sigil.y = this.height + buffer;
      if (sigil.y > this.height + buffer) sigil.y = -buffer;

      if (sigil.z < 0.15) {
        sigil.z = 0.15;
        sigil.vz *= -1;
      }
      if (sigil.z > 0.85) {
        sigil.z = 0.85;
        sigil.vz *= -1;
      }
    }

    for (const frag of this.fragments) {
      frag.x += frag.vx;
      frag.y += frag.vy;
      frag.rotation += frag.rotationSpeed;

      if (frag.x < -50) frag.x = this.width + 50;
      if (frag.x > this.width + 50) frag.x = -50;
      if (frag.y < -50) frag.y = this.height + 50;
      if (frag.y > this.height + 50) frag.y = -50;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const time = (performance.now() - this.startTime) * 0.001;

    // Enable glow for all sigil strokes
    ctx.shadowBlur = 6;

    for (const sigil of this.sigils) {
      const { r, g, b } = sigil;
      const depthScale = 0.5 + sigil.z * 0.5;
      const depthAlpha = 0.5 + sigil.z * 0.5;
      const parallaxY = this.scrollOffset * (0.0005 + sigil.z * 0.006);
      const pulse = 0.85 + Math.sin(time * sigil.pulseSpeed + sigil.pulsePhase) * 0.15;
      const alpha = Math.min(1, sigil.opacity * pulse * depthAlpha);
      const scaledSize = sigil.size * depthScale;

      ctx.save();
      ctx.translate(sigil.x, sigil.y - (parallaxY % this.height));
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`;

      const tiltFactor = Math.cos(sigil.tiltX);

      // Trace alpha helper — rotating highlight
      const traceWidth = Math.PI * 0.7;
      const getTraceAlpha = (angle: number, tracePos: number) => {
        let angleDiff = angle - tracePos;
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        else if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (angleDiff <= 0 && angleDiff > -traceWidth) return 1 + angleDiff / traceWidth;
        if (angleDiff > 0 && angleDiff < 0.25) return 0.3 * (1 - angleDiff / 0.25);
        return 0;
      };

      // Draw rings
      for (let ri = 0; ri < sigil.rings.length; ri++) {
        const ring = sigil.rings[ri];
        const ringRadius = ring.radius * scaledSize;
        const traceSpeed = 1.5 / (0.5 + ring.radius);
        const tracePos = (time * traceSpeed + ri * 0.8) % (Math.PI * 2);

        ctx.save();
        ctx.scale(1, Math.max(0.25, Math.abs(tiltFactor)));
        ctx.rotate(sigil.tiltY);
        ctx.lineWidth = this.lineWidth * depthScale;

        const segments = ring.segments;
        for (let s = 0; s < segments; s++) {
          const startAngle = (s / segments) * Math.PI * 2;
          const endAngle = ((s + 0.7) / segments) * Math.PI * 2;
          const midAngle = (startAngle + endAngle) / 2;
          const segAlpha = getTraceAlpha(midAngle, tracePos);
          if (segAlpha < 0.05) continue;

          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.8 * segAlpha})`;
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, startAngle, endAngle);
          ctx.stroke();
        }

        ctx.restore();
      }

      // Draw runes
      ctx.save();
      ctx.scale(1, Math.max(0.25, Math.abs(tiltFactor)));
      const diskRotation = time * 0.08;
      ctx.rotate(diskRotation + sigil.tiltY);

      for (const rune of sigil.runes) {
        const traceSpeed = 1.5 / (0.5 + rune.radius);
        const ringIndex = Math.round(rune.radius * (sigil.rings.length - 1));
        const tracePos = (time * traceSpeed + ringIndex * 0.8) % (Math.PI * 2);
        const traceAlpha = getTraceAlpha(rune.angle, tracePos);
        if (traceAlpha < 0.05) continue;

        const localX = Math.cos(rune.angle) * rune.radius * scaledSize;
        const localY = Math.sin(rune.angle) * rune.radius * scaledSize;

        ctx.save();
        ctx.translate(localX, localY);
        ctx.rotate(rune.angle + Math.PI / 2);

        const traceScale = 0.9 + traceAlpha * 0.3;
        const runeSize = scaledSize * 0.05 * traceScale;
        drawElderFuthark(
          ctx,
          rune.symbol,
          runeSize,
          r,
          g,
          b,
          alpha * 0.9 * traceAlpha,
          this.lineWidth,
        );

        ctx.restore();
      }

      ctx.restore();
      ctx.restore();
    }

    // Render floating fragments
    for (let fi = 0; fi < this.fragments.length; fi++) {
      const frag = this.fragments[fi];

      // Flicker effect
      const flickerSeed = fi * 7.31;
      const flickerCycle = time * 0.5 + flickerSeed;
      const flickerChance =
        Math.sin(flickerCycle * 3.7) * Math.sin(flickerCycle * 5.3) * Math.sin(flickerCycle * 2.1);
      const isFlickering = flickerChance > 0.85;
      const flickerIntensity = isFlickering ? (Math.random() > 0.5 ? 0 : 2.5) : 1;
      if (flickerIntensity === 0) continue;

      const { r: fr, g: fg, b: fb } = frag;
      const depthScale = 0.5 + frag.z * 0.5;
      const depthAlpha = 0.4 + frag.z * 0.6;
      const tiltFactor = Math.cos(frag.tiltX) * Math.cos(frag.tiltY);
      const fragParallaxY = this.scrollOffset * (0.0003 + frag.z * 0.004);

      const alpha = Math.min(
        1,
        frag.opacity * depthAlpha * Math.max(0.2, Math.abs(tiltFactor)) * flickerIntensity,
      );

      ctx.save();
      ctx.translate(frag.x, frag.y - (fragParallaxY % this.height));
      ctx.rotate(frag.rotation);
      ctx.scale(depthScale, depthScale * Math.max(0.3, Math.abs(tiltFactor)));
      ctx.lineWidth = this.lineWidth * 0.8;
      ctx.lineCap = 'round';

      if (
        frag.type === 'arc' &&
        frag.arcRadius &&
        frag.arcStart !== undefined &&
        frag.arcEnd !== undefined
      ) {
        ctx.beginPath();
        ctx.arc(0, 0, frag.arcRadius, frag.arcStart, frag.arcEnd);
        ctx.strokeStyle = `rgba(${fr}, ${fg}, ${fb}, ${alpha * 0.6})`;
        ctx.stroke();
      } else if (frag.type === 'rune' && frag.symbol !== undefined && frag.runeSize) {
        drawElderFuthark(ctx, frag.symbol, frag.runeSize, fr, fg, fb, alpha * 0.7, this.lineWidth);
      }

      ctx.restore();
    }
  }

  destroy(): void {
    this.sigils = [];
    this.fragments = [];
  }
}
