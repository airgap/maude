/**
 * Chirp Engine — generative melodic feedback for Claude stream events
 *
 * Pure Web Audio API additive synthesis. Each instrument is modelled
 * via its natural harmonic series with per-partial gains and exponential
 * decay envelopes — no samples, no oscillator types beyond sine.
 *
 * Instrument palette:
 *   Marimba   — warm woody bars, strong fundamental, even harmonics damp fast
 *   Vibraphone — metallic singing bars, brighter partials, motor tremolo optional
 *   Bowl      — singing bowl / bowed glass, slow attack, near-pure fundamental
 *   Plate     — inharmonic struck metal, dense partials, used for errors
 *
 * All events are tuned to a common pentatonic scale so simultaneous
 * chirps always harmonise with each other.
 */

export type ChirpEvent =
  | 'message_start' // New response begins
  | 'text_start' // Text block starts
  | 'text_delta' // Text streaming (throttled)
  | 'thinking_start' // Thinking block
  | 'tool_start' // Tool invocation
  | 'tool_result_ok' // Tool success
  | 'tool_result_error' // Tool error
  | 'tool_approval' // Awaiting user approval
  | 'user_question' // User question prompt
  | 'message_stop' // Response complete
  | 'error' // Stream error
  | 'cancelled'; // User cancelled

// ---------------------------------------------------------------------------
// Additive synthesis primitives
// ---------------------------------------------------------------------------

/**
 * A single overtone in an additive synthesis voice.
 * ratio: frequency multiplier from the fundamental (1 = fundamental, 2 = octave, etc.)
 * gain:  relative amplitude of this overtone (before envelope)
 * decay: per-overtone exponential decay time constant (seconds) — lets higher
 *        overtones die away faster, as they do in real struck instruments
 */
interface Overtone {
  ratio: number;
  gain: number;
  decay: number;
}

/**
 * A complete note specification.
 * freq:    fundamental frequency in Hz
 * partials: harmonic series definition
 * attack:  attack time in seconds
 * release: overall release tail (seconds) after partials fade
 * gain:    master gain for this note (0–1)
 * detune:  optional cents detune on all partials (chorus warmth)
 */
interface NoteSpec {
  freq: number;
  partials: Overtone[];
  attack: number;
  release: number;
  gain: number;
  detune?: number;
}

// ---------------------------------------------------------------------------
// Instrument partial series
// Tuned to match the characteristic timbre of each physical instrument.
// ---------------------------------------------------------------------------

/**
 * Marimba — warm rosewood bar.
 * Strong fundamental, 4th harmonic (2 octaves) prominent, higher partials
 * damp very quickly. The characteristic "thwack" lives in the fast-decaying
 * upper partials.
 */
const MARIMBA: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.8 },
  { ratio: 4, gain: 0.35, decay: 0.18 },
  { ratio: 10, gain: 0.12, decay: 0.06 },
  { ratio: 18, gain: 0.05, decay: 0.03 },
];

/**
 * Vibraphone — aluminium bar with resonator tube.
 * Brighter than marimba, prominent 3rd and 5th harmonics,
 * longer metallic sustain. The motor tremolo effect is omitted
 * for brevity but the spectral shape is right.
 */
const VIBRAPHONE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.2 },
  { ratio: 3.03, gain: 0.4, decay: 0.6 }, // slightly inharmonic — real vibes
  { ratio: 5.95, gain: 0.18, decay: 0.3 },
  { ratio: 8.6, gain: 0.08, decay: 0.14 },
  { ratio: 12.3, gain: 0.04, decay: 0.07 },
];

/**
 * Singing bowl / bowed glass — nearly pure fundamental with one
 * very soft octave partial, very slow attack, long ring.
 */
const BOWL: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 3.5 },
  { ratio: 2.76, gain: 0.2, decay: 2.0 }, // inharmonic second partial
  { ratio: 5.4, gain: 0.06, decay: 0.8 },
];

/**
 * Struck metal plate — dense inharmonic partials.
 * Models a hit on a large plate or tam-tam: aggressive, clangy,
 * with a cluster of inharmonic frequencies.
 */
const PLATE: Overtone[] = [
  { ratio: 1, gain: 0.8, decay: 0.25 },
  { ratio: 1.51, gain: 0.7, decay: 0.18 },
  { ratio: 2.2, gain: 0.55, decay: 0.12 },
  { ratio: 3.17, gain: 0.4, decay: 0.09 },
  { ratio: 4.8, gain: 0.25, decay: 0.06 },
  { ratio: 6.9, gain: 0.15, decay: 0.04 },
];

/**
 * Tubular bell — long metallic sustain, strong 2nd and 3rd inharmonic partials.
 * Used for attention / approval chimes.
 */
const BELL: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.5 },
  { ratio: 2.76, gain: 0.6, decay: 1.8 },
  { ratio: 5.4, gain: 0.25, decay: 1.0 },
  { ratio: 8.93, gain: 0.12, decay: 0.5 },
  { ratio: 13.3, gain: 0.05, decay: 0.25 },
];

// ---------------------------------------------------------------------------
// Common pentatonic scale frequencies (C major pentatonic, two octaves)
// All events are tuned to notes from this set so concurrent chirps harmonise.
// C4=261.6, D4=293.7, E4=329.6, G4=392.0, A4=440.0
// C5=523.3, D5=587.3, E5=659.3, G5=784.0, A5=880.0
// C6=1046.5, E6=1318.5
// ---------------------------------------------------------------------------

// Event note assignments — chosen so the narrative arc makes musical sense:
//   start events → lower notes, completion → higher resolution, error → dissonant

const NOTES = {
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  G4: 392.0,
  A4: 440.0,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  G5: 784.0,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.5,
  // Error note — B♭4, outside pentatonic, intentionally tense
  Bb4: 466.2,
  // Thinking — low G3
  G3: 196.0,
};

// ---------------------------------------------------------------------------
// Event → note spec table
// ---------------------------------------------------------------------------

const EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // A single marimba strike on G4 — light, readying
  message_start: {
    freq: NOTES.G4,
    partials: MARIMBA,
    attack: 0.004,
    release: 0.08,
    gain: 0.32,
  },

  // Soft vibraphone tap — E5, barely there
  text_start: {
    freq: NOTES.E5,
    partials: VIBRAPHONE,
    attack: 0.003,
    release: 0.06,
    gain: 0.18,
  },

  // text_delta handled by playBrush() — gain:0 sentinel so Record is complete
  text_delta: {
    freq: NOTES.A5,
    partials: VIBRAPHONE,
    attack: 0.002,
    release: 0.03,
    gain: 0.0,
  },

  // Singing bowl on G3 — low, contemplative
  thinking_start: {
    freq: NOTES.G3,
    partials: BOWL,
    attack: 0.06,
    release: 0.5,
    gain: 0.26,
  },

  // tool events handled per-family in TOOL_NOTES — placeholder unused
  tool_start: {
    freq: NOTES.D4,
    partials: VIBRAPHONE,
    attack: 0.004,
    release: 0.07,
    gain: 0.2,
  },

  // Vibraphone major third — D5 + A5
  tool_result_ok: [
    { freq: NOTES.D5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.24 },
    { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.14 },
  ],

  // Plate strike on Bb4 — dissonant clang
  tool_result_error: {
    freq: NOTES.Bb4,
    partials: PLATE,
    attack: 0.003,
    release: 0.12,
    gain: 0.28,
  },

  // Bell chord — C5 + E5 + G5 (major triad), sustained
  tool_approval: [
    { freq: NOTES.C5, partials: BELL, attack: 0.008, release: 0.5, gain: 0.28 },
    { freq: NOTES.E5, partials: BELL, attack: 0.008, release: 0.5, gain: 0.2 },
    { freq: NOTES.G5, partials: BELL, attack: 0.008, release: 0.5, gain: 0.14 },
  ],

  // user_question handled by playUserQuestion()
  user_question: {
    freq: NOTES.E4,
    partials: MARIMBA,
    attack: 0.005,
    release: 0.12,
    gain: 0.0, // gain=0 sentinel — uses special handler
  },

  // Marimba resolution — C5 + E5 + G5, warm landing
  message_stop: [
    { freq: NOTES.C5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.28 },
    { freq: NOTES.E5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.2 },
    { freq: NOTES.G5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.14 },
  ],

  // Descending plate hits — Bb4 then G3
  error: [
    { freq: NOTES.Bb4, partials: PLATE, attack: 0.003, release: 0.18, gain: 0.3 },
    { freq: NOTES.G3, partials: PLATE, attack: 0.003, release: 0.18, gain: 0.2 },
  ],

  // Soft marimba descent — A4 → G4, gentle fade
  cancelled: [
    { freq: NOTES.A4, partials: MARIMBA, attack: 0.006, release: 0.3, gain: 0.2 },
    { freq: NOTES.G4, partials: MARIMBA, attack: 0.006, release: 0.4, gain: 0.14 },
  ],
};

// ---------------------------------------------------------------------------
// Per-tool sonic families (vibraphone family with different note choices)
// ---------------------------------------------------------------------------

type ToolFamily = 'shell' | 'read' | 'write' | 'search' | 'agent' | 'default';

function toolFamily(name: string): ToolFamily {
  const n = name.toLowerCase();
  if (n === 'bash') return 'shell';
  if (n === 'read' || n === 'glob' || n === 'grep') return 'read';
  if (
    n === 'write' ||
    n === 'edit' ||
    n === 'notebookedit' ||
    n === 'str_replace_editor' ||
    n === 'write_file' ||
    n === 'edit_file' ||
    n === 'create_file'
  )
    return 'write';
  if (n === 'websearch' || n === 'webfetch') return 'search';
  if (n === 'task' || n.startsWith('mcp__')) return 'agent';
  return 'default';
}

interface ToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const TOOL_NOTES: Record<ToolFamily, ToolNotes> = {
  // Shell — low marimba, grounded, decisive
  shell: {
    start: { freq: NOTES.C4, partials: MARIMBA, attack: 0.004, release: 0.1, gain: 0.24 },
    ok: [
      { freq: NOTES.C4, partials: MARIMBA, attack: 0.004, release: 0.12, gain: 0.22 },
      { freq: NOTES.G4, partials: MARIMBA, attack: 0.004, release: 0.12, gain: 0.14 },
    ],
  },
  // Read — high vibraphone, light and airy
  read: {
    start: { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.003, release: 0.08, gain: 0.18 },
    ok: [
      { freq: NOTES.E5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.18 },
      { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.12 },
    ],
  },
  // Write — mid marimba, weighted, solid
  write: {
    start: { freq: NOTES.D4, partials: MARIMBA, attack: 0.005, release: 0.1, gain: 0.24 },
    ok: [
      { freq: NOTES.G4, partials: MARIMBA, attack: 0.005, release: 0.14, gain: 0.22 },
      { freq: NOTES.D5, partials: MARIMBA, attack: 0.005, release: 0.14, gain: 0.14 },
    ],
  },
  // Search — bowl sweep: low attack, singing
  search: {
    start: { freq: NOTES.D5, partials: BOWL, attack: 0.02, release: 0.2, gain: 0.2 },
    ok: [
      { freq: NOTES.G4, partials: VIBRAPHONE, attack: 0.005, release: 0.16, gain: 0.2 },
      { freq: NOTES.D5, partials: VIBRAPHONE, attack: 0.005, release: 0.16, gain: 0.12 },
    ],
  },
  // Agent — deep bell, resonant spawn
  agent: {
    start: { freq: NOTES.C4, partials: BELL, attack: 0.015, release: 0.5, gain: 0.26 },
    ok: [
      { freq: NOTES.G4, partials: BELL, attack: 0.01, release: 0.4, gain: 0.24 },
      { freq: NOTES.C5, partials: BELL, attack: 0.01, release: 0.4, gain: 0.16 },
    ],
  },
  // Default — vibraphone D4
  default: {
    start: { freq: NOTES.D4, partials: VIBRAPHONE, attack: 0.004, release: 0.08, gain: 0.2 },
    ok: [
      { freq: NOTES.D4, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.22 },
      { freq: NOTES.A4, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.14 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Whimsy instrument partial series
// Tuned to sound like a music box, toy piano, and kalimba.
// ---------------------------------------------------------------------------

/**
 * Music Box tine — pure metallic overtones with slight inharmonicity.
 * Very fast attack (the cylinder plucks the tine instantly),
 * long glassy decay. Ethereal, delicate, perfectly clockwork.
 */
const MUSIC_BOX: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.2 },
  { ratio: 2.03, gain: 0.28, decay: 0.9 }, // slightly inharmonic 2nd
  { ratio: 4.12, gain: 0.1, decay: 0.35 },
  { ratio: 6.84, gain: 0.04, decay: 0.14 },
];

/**
 * Toy Piano — thin metal tine struck by a tiny hammer.
 * Bright, brittle, slightly hollow. Higher partials decay almost instantly.
 */
const TOY_PIANO: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.55 },
  { ratio: 2.0, gain: 0.5, decay: 0.2 },
  { ratio: 3.1, gain: 0.28, decay: 0.09 },
  { ratio: 5.0, gain: 0.12, decay: 0.04 },
  { ratio: 7.5, gain: 0.06, decay: 0.02 },
];

/**
 * Kalimba (thumb piano) — warm fundamental with a quick metallic twang.
 * The tine rings bright, decays into a deep warm resonance.
 */
const KALIMBA: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.8 },
  { ratio: 2.0, gain: 0.55, decay: 0.65 },
  { ratio: 3.05, gain: 0.2, decay: 0.22 },
  { ratio: 4.92, gain: 0.08, decay: 0.08 },
];

/**
 * Toy Xylophone — short wooden bars, higher register, bouncier than marimba.
 * Lots of click on attack, harmonics die fast leaving just the warm tone.
 */
const TOY_XYLOPHONE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.5 },
  { ratio: 3.0, gain: 0.45, decay: 0.1 },
  { ratio: 7.0, gain: 0.18, decay: 0.04 },
  { ratio: 12.0, gain: 0.06, decay: 0.02 },
];


// ---------------------------------------------------------------------------
// Forest instrument partial series
// Enchanted woodland synthesis: wind chimes, wooden flutes, owl hoots,
// rustling leaves, dripping water, and fairy sparkles.
// ---------------------------------------------------------------------------

/**
 * Wind Chime — thin metal tubes swaying in a forest breeze.
 * Bright, shimmery, with closely-spaced inharmonic partials that
 * create a beautiful beating/shimmering effect. Long ethereal sustain.
 */
const WIND_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.8 },
  { ratio: 1.08, gain: 0.7, decay: 2.4 }, // close detuning = shimmer
  { ratio: 2.37, gain: 0.35, decay: 1.5 },
  { ratio: 3.92, gain: 0.15, decay: 0.8 },
  { ratio: 6.1, gain: 0.06, decay: 0.3 },
];

/**
 * Wooden Flute — warm, breathy, hollow wooden pipe.
 * Strong odd harmonics (characteristic of open cylindrical pipes),
 * gentle attack like breath filling the column, warm woody sustain.
 */
const WOODEN_FLUTE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.4 },
  { ratio: 2.0, gain: 0.15, decay: 0.8 }, // weak even harmonic (open pipe)
  { ratio: 3.0, gain: 0.4, decay: 0.6 },  // strong 3rd
  { ratio: 5.0, gain: 0.12, decay: 0.3 },
  { ratio: 7.0, gain: 0.04, decay: 0.12 },
];

/**
 * Raindrop — a single water drop hitting a still pool.
 * Very pure tone with a fast pluck attack and a quick
 * resonant decay, like a tiny liquid bell.
 */
const RAINDROP: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.4 },
  { ratio: 2.17, gain: 0.3, decay: 0.15 }, // slightly inharmonic splash
  { ratio: 4.56, gain: 0.1, decay: 0.06 },
];

/**
 * Fairy Sparkle — bright crystalline ping with rapid glittering decay.
 * Very high, thin partials that evaporate almost instantly,
 * like pixie dust catching the light.
 */
const FAIRY_SPARKLE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.6 },
  { ratio: 1.5, gain: 0.6, decay: 0.45 },  // perfect fifth shimmer
  { ratio: 2.0, gain: 0.4, decay: 0.3 },
  { ratio: 3.17, gain: 0.2, decay: 0.15 },
  { ratio: 5.34, gain: 0.08, decay: 0.06 },
];

/**
 * Owl Hoot — deep, hollow, resonant call.
 * Very strong fundamental with minimal upper partials,
 * slow attack mimicking the owl's breathy onset, long warm sustain.
 */
const OWL_HOOT: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.0 },
  { ratio: 1.5, gain: 0.12, decay: 1.2 },  // faint fifth
  { ratio: 2.0, gain: 0.06, decay: 0.6 },
];

// Forest scale — D Dorian (natural, woodland, slightly mysterious)
// D E F G A B C — the raised 6th gives it a bittersweet, enchanted quality
const FOREST_NOTES = {
  D3: 146.8,
  E3: 164.8,
  F3: 174.6,
  G3: 196.0,
  A3: 220.0,
  B3: 246.9,
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  F4: 349.2,
  G4: 392.0,
  A4: 440.0,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  F5: 698.5,
  G5: 784.0,
  A5: 880.0,
  B5: 987.8,
  C6: 1046.5,
  D6: 1174.7,
  // Low owl hoot note
  D2: 73.4,
};

// Event → forest note specs
const FOREST_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Wind chime greeting — D5, gentle woodland hello
  message_start: {
    freq: FOREST_NOTES.D5,
    partials: WIND_CHIME,
    attack: 0.008,
    release: 0.15,
    gain: 0.28,
  },

  // Fairy sparkle — A5, tiny magical glint
  text_start: {
    freq: FOREST_NOTES.A5,
    partials: FAIRY_SPARKLE,
    attack: 0.002,
    release: 0.08,
    gain: 0.2,
  },

  // text_delta → playForestRustle() — sentinel
  text_delta: {
    freq: FOREST_NOTES.D6,
    partials: FAIRY_SPARKLE,
    attack: 0.001,
    release: 0.02,
    gain: 0.0,
  },

  // Owl contemplation — D2, deep and wise
  thinking_start: {
    freq: FOREST_NOTES.D2,
    partials: OWL_HOOT,
    attack: 0.06,
    release: 0.6,
    gain: 0.26,
  },

  // Raindrop — G4, clear purpose
  tool_start: {
    freq: FOREST_NOTES.G4,
    partials: RAINDROP,
    attack: 0.002,
    release: 0.08,
    gain: 0.22,
  },

  // Two wind chimes — A4 + D5 (woodland perfect fourth)
  tool_result_ok: [
    { freq: FOREST_NOTES.A4, partials: WIND_CHIME, attack: 0.004, release: 0.14, gain: 0.24 },
    { freq: FOREST_NOTES.D5, partials: WIND_CHIME, attack: 0.004, release: 0.14, gain: 0.16 },
  ],

  // Cracked twig — B4 raindrop clunk (out of the dorian comfort zone)
  tool_result_error: {
    freq: FOREST_NOTES.F4,
    partials: RAINDROP,
    attack: 0.003,
    release: 0.14,
    gain: 0.26,
  },

  // Fairy ring fanfare — D5 + F5 + A5 + D6
  tool_approval: [
    { freq: FOREST_NOTES.D5, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.26 },
    { freq: FOREST_NOTES.F5, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.2 },
    { freq: FOREST_NOTES.A5, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.14 },
    { freq: FOREST_NOTES.D6, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.08 },
  ],

  // user_question → playForestQuestion() — sentinel
  user_question: {
    freq: FOREST_NOTES.G4,
    partials: WOODEN_FLUTE,
    attack: 0.005,
    release: 0.1,
    gain: 0.0,
  },

  // Woodland resolution — D4 + A4 + D5 warm flute landing
  message_stop: [
    { freq: FOREST_NOTES.D4, partials: WOODEN_FLUTE, attack: 0.008, release: 0.4, gain: 0.26 },
    { freq: FOREST_NOTES.A4, partials: WOODEN_FLUTE, attack: 0.008, release: 0.4, gain: 0.2 },
    { freq: FOREST_NOTES.D5, partials: WOODEN_FLUTE, attack: 0.008, release: 0.4, gain: 0.14 },
  ],

  // Falling leaves — B4 then G3, descending wind chimes
  error: [
    { freq: FOREST_NOTES.B4, partials: WIND_CHIME, attack: 0.004, release: 0.2, gain: 0.28 },
    { freq: FOREST_NOTES.G3, partials: WIND_CHIME, attack: 0.004, release: 0.2, gain: 0.2 },
  ],

  // Dusk settling — E5 → D5, gentle flute fade
  cancelled: [
    { freq: FOREST_NOTES.E5, partials: WOODEN_FLUTE, attack: 0.006, release: 0.3, gain: 0.2 },
    { freq: FOREST_NOTES.D5, partials: WOODEN_FLUTE, attack: 0.006, release: 0.4, gain: 0.14 },
  ],
};

interface ForestToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const FOREST_TOOL_NOTES: Record<ToolFamily, ForestToolNotes> = {
  // Shell — deep raindrop, grounded like tree roots
  shell: {
    start: { freq: FOREST_NOTES.D3, partials: RAINDROP, attack: 0.003, release: 0.12, gain: 0.24 },
    ok: [
      { freq: FOREST_NOTES.D3, partials: RAINDROP, attack: 0.004, release: 0.14, gain: 0.22 },
      { freq: FOREST_NOTES.A3, partials: RAINDROP, attack: 0.004, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high fairy sparkle, scanning through leaves
  read: {
    start: { freq: FOREST_NOTES.A5, partials: FAIRY_SPARKLE, attack: 0.002, release: 0.1, gain: 0.18 },
    ok: [
      { freq: FOREST_NOTES.E5, partials: FAIRY_SPARKLE, attack: 0.003, release: 0.14, gain: 0.18 },
      { freq: FOREST_NOTES.A5, partials: FAIRY_SPARKLE, attack: 0.003, release: 0.14, gain: 0.12 },
    ],
  },
  // Write — mid wooden flute, inscribing on bark
  write: {
    start: { freq: FOREST_NOTES.D4, partials: WOODEN_FLUTE, attack: 0.006, release: 0.12, gain: 0.24 },
    ok: [
      { freq: FOREST_NOTES.G4, partials: WOODEN_FLUTE, attack: 0.006, release: 0.16, gain: 0.22 },
      { freq: FOREST_NOTES.D5, partials: WOODEN_FLUTE, attack: 0.006, release: 0.16, gain: 0.14 },
    ],
  },
  // Search — wind chime sweep, breeze through branches
  search: {
    start: { freq: FOREST_NOTES.D5, partials: WIND_CHIME, attack: 0.012, release: 0.22, gain: 0.2 },
    ok: [
      { freq: FOREST_NOTES.G4, partials: WIND_CHIME, attack: 0.005, release: 0.18, gain: 0.2 },
      { freq: FOREST_NOTES.D5, partials: WIND_CHIME, attack: 0.005, release: 0.18, gain: 0.12 },
    ],
  },
  // Agent — owl hoot, wise creature awakening
  agent: {
    start: { freq: FOREST_NOTES.D3, partials: OWL_HOOT, attack: 0.02, release: 0.55, gain: 0.26 },
    ok: [
      { freq: FOREST_NOTES.A3, partials: OWL_HOOT, attack: 0.015, release: 0.45, gain: 0.24 },
      { freq: FOREST_NOTES.D4, partials: OWL_HOOT, attack: 0.015, release: 0.45, gain: 0.16 },
    ],
  },
  // Default — raindrop D4
  default: {
    start: { freq: FOREST_NOTES.D4, partials: RAINDROP, attack: 0.002, release: 0.1, gain: 0.2 },
    ok: [
      { freq: FOREST_NOTES.D4, partials: RAINDROP, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: FOREST_NOTES.A4, partials: RAINDROP, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Wind Chime sound style — dedicated serene wind chime synthesis
// Shimmering metallic tubes, gentle breezes, crystalline resonances,
// and subtle harmonic overtones. Every event is pure chime.
// ---------------------------------------------------------------------------

/**
 * Tubular Chime — resonant wind chime tube with clear, open sustain.
 * Bright fundamental with a gentle detuned shimmer that blooms then
 * fades cleanly, like a struck tube ringing in open air.
 */
const TUBULAR_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.6 },
  { ratio: 1.003, gain: 0.45, decay: 1.3 },  // very slight detuning = gentle shimmer
  { ratio: 2.41, gain: 0.25, decay: 0.7 },
  { ratio: 4.02, gain: 0.1, decay: 0.35 },
  { ratio: 6.35, gain: 0.04, decay: 0.15 },
];

/**
 * Crystal Chime — bright, clear, glass-like wind chime.
 * Clean fundamental with airy upper partials that sparkle
 * and fade quickly, like a crystal prism catching sunlight.
 */
const CRYSTAL_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.0 },
  { ratio: 2.0, gain: 0.5, decay: 0.7 },     // pure octave = open, clean
  { ratio: 3.0, gain: 0.3, decay: 0.45 },     // fifth above octave = bright
  { ratio: 5.04, gain: 0.15, decay: 0.2 },
  { ratio: 8.0, gain: 0.06, decay: 0.08 },
];

/**
 * Bamboo Chime — warm, hollow, wooden wind chime.
 * Strong fundamental with dampened upper harmonics,
 * creating a softer, warmer, more grounded tone. Like bamboo knocking.
 */
const BAMBOO_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.6 },
  { ratio: 2.0, gain: 0.3, decay: 0.35 },    // clean octave = open woody ring
  { ratio: 3.0, gain: 0.1, decay: 0.15 },
  { ratio: 4.7, gain: 0.03, decay: 0.06 },
];

/**
 * Bell Chime — clear bell-like wind chime with gentle inharmonics.
 * A clean struck-bell quality that rings openly then fades,
 * with just enough harmonic complexity for warmth.
 */
const BELL_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.8 },
  { ratio: 2.0, gain: 0.45, decay: 1.2 },    // clean octave = open bell ring
  { ratio: 3.0, gain: 0.25, decay: 0.7 },     // twelfth = bright bell character
  { ratio: 4.24, gain: 0.12, decay: 0.35 },   // mild inharmonic = bell colour
  { ratio: 6.0, gain: 0.05, decay: 0.15 },
];

/**
 * Tinkle Chime — very small, high, delicate chime.
 * Quick, clean attack with airy upper partials that vanish fast.
 * Like a tiny glass bead tapped in a breeze.
 */
const TINKLE_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.35 },
  { ratio: 2.0, gain: 0.5, decay: 0.2 },      // clean octave
  { ratio: 4.0, gain: 0.2, decay: 0.08 },
  { ratio: 7.0, gain: 0.06, decay: 0.03 },
];

// Wind Chime scale — F Lydian (bright, dreamy, floating, ethereal)
// F G A B C D E — the raised 4th gives it an airy, suspended, magical quality
const CHIME_NOTES = {
  F2: 87.3,
  G2: 98.0,
  A2: 110.0,
  B2: 123.5,
  C3: 130.8,
  D3: 146.8,
  E3: 164.8,
  F3: 174.6,
  G3: 196.0,
  A3: 220.0,
  B3: 246.9,
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  F4: 349.2,
  G4: 392.0,
  A4: 440.0,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  F5: 698.5,
  G5: 784.0,
  A5: 880.0,
  B5: 987.8,
  C6: 1046.5,
  D6: 1174.7,
  E6: 1318.5,
  F6: 1396.9,
};

// Event → wind chime note specs
const WIND_CHIME_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Tubular chime greeting — F5, clear open hello
  message_start: {
    freq: CHIME_NOTES.F5,
    partials: TUBULAR_CHIME,
    attack: 0.005,
    release: 0.12,
    gain: 0.26,
  },

  // Crystal tinkle — A5, bright sparkle
  text_start: {
    freq: CHIME_NOTES.A5,
    partials: CRYSTAL_CHIME,
    attack: 0.002,
    release: 0.1,
    gain: 0.2,
  },

  // text_delta → playWindChimeBreezeNote() — sentinel
  text_delta: {
    freq: CHIME_NOTES.F6,
    partials: TINKLE_CHIME,
    attack: 0.001,
    release: 0.02,
    gain: 0.0,
  },

  // Bell chime contemplation — F3, warm and open
  thinking_start: {
    freq: CHIME_NOTES.F3,
    partials: BELL_CHIME,
    attack: 0.03,
    release: 0.35,
    gain: 0.24,
  },

  // Bamboo knock — C4, purposeful wooden tap
  tool_start: {
    freq: CHIME_NOTES.C4,
    partials: BAMBOO_CHIME,
    attack: 0.003,
    release: 0.08,
    gain: 0.22,
  },

  // Twin crystal chimes — A4 + F5 (open sixth)
  tool_result_ok: [
    { freq: CHIME_NOTES.A4, partials: CRYSTAL_CHIME, attack: 0.003, release: 0.1, gain: 0.22 },
    { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.003, release: 0.1, gain: 0.14 },
  ],

  // Muted bamboo tap — C4, soft low signal
  tool_result_error: {
    freq: CHIME_NOTES.C4,
    partials: BAMBOO_CHIME,
    attack: 0.002,
    release: 0.08,
    gain: 0.22,
  },

  // Cascading crystal fanfare — F5 + A5 + C6 + F6
  tool_approval: [
    { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.24 },
    { freq: CHIME_NOTES.A5, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.18 },
    { freq: CHIME_NOTES.C6, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.12 },
    { freq: CHIME_NOTES.F6, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.07 },
  ],

  // user_question → playWindChimeQuestion() — sentinel
  user_question: {
    freq: CHIME_NOTES.C4,
    partials: TUBULAR_CHIME,
    attack: 0.005,
    release: 0.1,
    gain: 0.0,
  },

  // Open landing — F4 + A4 + F5 tubular resolution
  message_stop: [
    { freq: CHIME_NOTES.F4, partials: TUBULAR_CHIME, attack: 0.006, release: 0.2, gain: 0.24 },
    { freq: CHIME_NOTES.A4, partials: TUBULAR_CHIME, attack: 0.006, release: 0.2, gain: 0.18 },
    { freq: CHIME_NOTES.F5, partials: TUBULAR_CHIME, attack: 0.006, release: 0.2, gain: 0.12 },
  ],

  // Gentle descending bell — F5 → C4, soft falling interval
  error: [
    { freq: CHIME_NOTES.F5, partials: BELL_CHIME, attack: 0.004, release: 0.18, gain: 0.24 },
    { freq: CHIME_NOTES.C4, partials: BELL_CHIME, attack: 0.004, release: 0.18, gain: 0.16 },
  ],

  // Fading breeze — G5 → F5, gentle descending tinkle
  cancelled: [
    { freq: CHIME_NOTES.G5, partials: TINKLE_CHIME, attack: 0.004, release: 0.12, gain: 0.18 },
    { freq: CHIME_NOTES.F5, partials: TINKLE_CHIME, attack: 0.004, release: 0.15, gain: 0.12 },
  ],
};

interface WindChimeToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const WIND_CHIME_TOOL_NOTES: Record<ToolFamily, WindChimeToolNotes> = {
  // Shell — deep bamboo knock, grounded and earthy
  shell: {
    start: { freq: CHIME_NOTES.F3, partials: BAMBOO_CHIME, attack: 0.003, release: 0.12, gain: 0.24 },
    ok: [
      { freq: CHIME_NOTES.F3, partials: BAMBOO_CHIME, attack: 0.004, release: 0.14, gain: 0.22 },
      { freq: CHIME_NOTES.C4, partials: BAMBOO_CHIME, attack: 0.004, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high tinkle, scanning through pages
  read: {
    start: { freq: CHIME_NOTES.A5, partials: TINKLE_CHIME, attack: 0.002, release: 0.1, gain: 0.18 },
    ok: [
      { freq: CHIME_NOTES.E5, partials: TINKLE_CHIME, attack: 0.003, release: 0.14, gain: 0.18 },
      { freq: CHIME_NOTES.A5, partials: TINKLE_CHIME, attack: 0.003, release: 0.14, gain: 0.12 },
    ],
  },
  // Write — mid tubular chime, clean engraving
  write: {
    start: { freq: CHIME_NOTES.F4, partials: TUBULAR_CHIME, attack: 0.005, release: 0.1, gain: 0.22 },
    ok: [
      { freq: CHIME_NOTES.C5, partials: TUBULAR_CHIME, attack: 0.005, release: 0.12, gain: 0.2 },
      { freq: CHIME_NOTES.F5, partials: TUBULAR_CHIME, attack: 0.005, release: 0.12, gain: 0.12 },
    ],
  },
  // Search — crystal chime sweep, sparkling discovery
  search: {
    start: { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.12, gain: 0.2 },
    ok: [
      { freq: CHIME_NOTES.C5, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.1, gain: 0.2 },
      { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.1, gain: 0.12 },
    ],
  },
  // Agent — bell chime, clear awakening
  agent: {
    start: { freq: CHIME_NOTES.F3, partials: BELL_CHIME, attack: 0.015, release: 0.25, gain: 0.24 },
    ok: [
      { freq: CHIME_NOTES.C4, partials: BELL_CHIME, attack: 0.01, release: 0.2, gain: 0.22 },
      { freq: CHIME_NOTES.F4, partials: BELL_CHIME, attack: 0.01, release: 0.2, gain: 0.14 },
    ],
  },
  // Default — bamboo tap F4
  default: {
    start: { freq: CHIME_NOTES.F4, partials: BAMBOO_CHIME, attack: 0.002, release: 0.1, gain: 0.2 },
    ok: [
      { freq: CHIME_NOTES.F4, partials: BAMBOO_CHIME, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: CHIME_NOTES.C5, partials: BAMBOO_CHIME, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
};

// C major scale + extensions — bright, upbeat, no pentatonic flats
const WHIMSY_NOTES = {
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  F4: 349.2,
  G4: 392.0,
  A4: 440.0,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  F5: 698.5,
  G5: 784.0,
  A5: 880.0,
  B5: 987.8,
  C6: 1046.5,
  E6: 1318.5,
  // Squeeze-toy squeak frequency (used for brush-replacement)
  F6: 1396.9,
};

// Event → whimsy note specs
const WHIMSY_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Toy piano ding — E5, cheerful readying
  message_start: {
    freq: WHIMSY_NOTES.E5,
    partials: TOY_PIANO,
    attack: 0.002,
    release: 0.1,
    gain: 0.3,
  },

  // Music box tinkle — G5, light and airy
  text_start: {
    freq: WHIMSY_NOTES.G5,
    partials: MUSIC_BOX,
    attack: 0.001,
    release: 0.08,
    gain: 0.2,
  },

  // text_delta → playWhimsySqueak() — sentinel
  text_delta: {
    freq: WHIMSY_NOTES.C6,
    partials: MUSIC_BOX,
    attack: 0.001,
    release: 0.02,
    gain: 0.0,
  },

  // Kalimba dream — C4, slow and contemplative
  thinking_start: {
    freq: WHIMSY_NOTES.C4,
    partials: KALIMBA,
    attack: 0.04,
    release: 0.6,
    gain: 0.28,
  },

  // Toy xylophone tick — D5
  tool_start: {
    freq: WHIMSY_NOTES.D5,
    partials: TOY_XYLOPHONE,
    attack: 0.002,
    release: 0.08,
    gain: 0.22,
  },

  // Two music box notes — E5 + B5
  tool_result_ok: [
    { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.24 },
    { freq: WHIMSY_NOTES.B5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.14 },
  ],

  // Toy xylophone clunk — Bb-ish (F#5-ish, slightly sour on purpose — still cute)
  tool_result_error: {
    freq: WHIMSY_NOTES.F5,
    partials: TOY_XYLOPHONE,
    attack: 0.003,
    release: 0.14,
    gain: 0.26,
  },

  // Magic music box triad — C5 + E5 + G5 + C6, sparkly fanfare
  tool_approval: [
    { freq: WHIMSY_NOTES.C5, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.26 },
    { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.2 },
    { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.14 },
    { freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.08 },
  ],

  // user_question → playWhimsyQuestion() — sentinel
  user_question: {
    freq: WHIMSY_NOTES.E4,
    partials: TOY_PIANO,
    attack: 0.002,
    release: 0.1,
    gain: 0.0,
  },

  // Kalimba landing — C5 + E5 + G5, warm resolution
  message_stop: [
    { freq: WHIMSY_NOTES.C5, partials: KALIMBA, attack: 0.004, release: 0.4, gain: 0.28 },
    { freq: WHIMSY_NOTES.E5, partials: KALIMBA, attack: 0.004, release: 0.4, gain: 0.2 },
    { freq: WHIMSY_NOTES.G5, partials: KALIMBA, attack: 0.004, release: 0.4, gain: 0.14 },
  ],

  // Sad toy xylophone tumble — B4 then G4, descending
  error: [
    { freq: WHIMSY_NOTES.B4, partials: TOY_XYLOPHONE, attack: 0.003, release: 0.2, gain: 0.28 },
    { freq: WHIMSY_NOTES.G4, partials: TOY_XYLOPHONE, attack: 0.003, release: 0.2, gain: 0.2 },
  ],

  // Toy piano wilt — A5 → G5, gentle fade
  cancelled: [
    { freq: WHIMSY_NOTES.A5, partials: TOY_PIANO, attack: 0.004, release: 0.28, gain: 0.2 },
    { freq: WHIMSY_NOTES.G5, partials: TOY_PIANO, attack: 0.004, release: 0.38, gain: 0.14 },
  ],
};

interface WhimsyToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const WHIMSY_TOOL_NOTES: Record<ToolFamily, WhimsyToolNotes> = {
  // Shell — low kalimba thunk, purposeful
  shell: {
    start: { freq: WHIMSY_NOTES.C4, partials: KALIMBA, attack: 0.003, release: 0.12, gain: 0.24 },
    ok: [
      { freq: WHIMSY_NOTES.C4, partials: KALIMBA, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: WHIMSY_NOTES.G4, partials: KALIMBA, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high music box sparkle
  read: {
    start: { freq: WHIMSY_NOTES.A5, partials: MUSIC_BOX, attack: 0.001, release: 0.1, gain: 0.18 },
    ok: [
      { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.18 },
      { freq: WHIMSY_NOTES.A5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.12 },
    ],
  },
  // Write — mid toy piano bonk, satisfying
  write: {
    start: { freq: WHIMSY_NOTES.D5, partials: TOY_PIANO, attack: 0.002, release: 0.12, gain: 0.24 },
    ok: [
      { freq: WHIMSY_NOTES.G5, partials: TOY_PIANO, attack: 0.002, release: 0.16, gain: 0.22 },
      { freq: WHIMSY_NOTES.D5, partials: TOY_PIANO, attack: 0.002, release: 0.16, gain: 0.14 },
    ],
  },
  // Search — kalimba shimmer sweep
  search: {
    start: { freq: WHIMSY_NOTES.D5, partials: KALIMBA, attack: 0.015, release: 0.22, gain: 0.2 },
    ok: [
      { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.004, release: 0.18, gain: 0.2 },
      { freq: WHIMSY_NOTES.B5, partials: MUSIC_BOX, attack: 0.004, release: 0.18, gain: 0.12 },
    ],
  },
  // Agent — music box chord, magical spawn
  agent: {
    start: { freq: WHIMSY_NOTES.C5, partials: MUSIC_BOX, attack: 0.01, release: 0.55, gain: 0.26 },
    ok: [
      { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.008, release: 0.45, gain: 0.24 },
      { freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX, attack: 0.008, release: 0.45, gain: 0.16 },
    ],
  },
  // Default — toy xylophone D5
  default: {
    start: {
      freq: WHIMSY_NOTES.D5,
      partials: TOY_XYLOPHONE,
      attack: 0.002,
      release: 0.1,
      gain: 0.2,
    },
    ok: [
      { freq: WHIMSY_NOTES.D5, partials: TOY_XYLOPHONE, attack: 0.002, release: 0.14, gain: 0.22 },
      { freq: WHIMSY_NOTES.A5, partials: TOY_XYLOPHONE, attack: 0.002, release: 0.14, gain: 0.14 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Classic (oscillator) synthesis — the original chirp engine configs
// Used when soundStyle === 'classic'
// ---------------------------------------------------------------------------

export type SoundStyle = 'classic' | 'melodic' | 'whimsy' | 'forest' | 'wind-chime';

interface ClassicConfig {
  freq: number;
  freq2?: number;
  type: OscillatorType;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gain: number;
  gain2?: number;
  filter?: number;
}

const CLASSIC_CHIRPS: Record<ChirpEvent, ClassicConfig> = {
  message_start: {
    freq: 880,
    freq2: 1320,
    type: 'sine',
    attack: 0.008,
    decay: 0.1,
    sustain: 0.0,
    release: 0.18,
    gain: 0.28,
    gain2: 0.16,
  },
  text_start: {
    freq: 1400,
    type: 'sine',
    attack: 0.004,
    decay: 0.05,
    sustain: 0.0,
    release: 0.08,
    gain: 0.22,
  },
  text_delta: {
    freq: 2200,
    type: 'sine',
    attack: 0.002,
    decay: 0.018,
    sustain: 0.0,
    release: 0.025,
    gain: 0.14,
    filter: 3000,
  },
  thinking_start: {
    freq: 200,
    freq2: 300,
    type: 'sine',
    attack: 0.025,
    decay: 0.2,
    sustain: 0.0,
    release: 0.3,
    gain: 0.22,
    gain2: 0.12,
    filter: 550,
  },
  tool_start: {
    freq: 660,
    type: 'square',
    attack: 0.004,
    decay: 0.035,
    sustain: 0.0,
    release: 0.06,
    gain: 0.16,
    filter: 1100,
  },
  tool_result_ok: {
    freq: 880,
    freq2: 1108,
    type: 'sine',
    attack: 0.008,
    decay: 0.12,
    sustain: 0.0,
    release: 0.22,
    gain: 0.26,
    gain2: 0.14,
  },
  tool_result_error: {
    freq: 240,
    freq2: 180,
    type: 'sawtooth',
    attack: 0.01,
    decay: 0.14,
    sustain: 0.0,
    release: 0.22,
    gain: 0.22,
    gain2: 0.13,
    filter: 750,
  },
  tool_approval: {
    freq: 1047,
    freq2: 1319,
    type: 'sine',
    attack: 0.01,
    decay: 0.18,
    sustain: 0.12,
    release: 0.3,
    gain: 0.3,
    gain2: 0.16,
  },
  user_question: {
    freq: 440,
    type: 'sine',
    attack: 0.01,
    decay: 0.1,
    sustain: 0.0,
    release: 0.15,
    gain: 0.0,
  }, // handled by playClassicUserQuestion
  message_stop: {
    freq: 523,
    freq2: 659,
    type: 'sine',
    attack: 0.01,
    decay: 0.25,
    sustain: 0.0,
    release: 0.4,
    gain: 0.28,
    gain2: 0.15,
  },
  error: {
    freq: 150,
    freq2: 112,
    type: 'sawtooth',
    attack: 0.01,
    decay: 0.2,
    sustain: 0.06,
    release: 0.32,
    gain: 0.3,
    gain2: 0.18,
    filter: 550,
  },
  cancelled: {
    freq: 440,
    type: 'sine',
    attack: 0.01,
    decay: 0.35,
    sustain: 0.0,
    release: 0.45,
    gain: 0.18,
    filter: 900,
  },
};

type ClassicToolFamily = 'shell' | 'read' | 'write' | 'search' | 'agent' | 'default';

const CLASSIC_TOOL_CHIRPS: Record<ClassicToolFamily, { start: ClassicConfig; ok: ClassicConfig }> =
  {
    shell: {
      start: {
        freq: 110,
        type: 'square',
        attack: 0.003,
        decay: 0.04,
        sustain: 0.0,
        release: 0.07,
        gain: 0.2,
        filter: 600,
      },
      ok: {
        freq: 140,
        freq2: 220,
        type: 'square',
        attack: 0.003,
        decay: 0.06,
        sustain: 0.0,
        release: 0.1,
        gain: 0.18,
        gain2: 0.1,
        filter: 700,
      },
    },
    read: {
      start: {
        freq: 1800,
        type: 'sine',
        attack: 0.004,
        decay: 0.04,
        sustain: 0.0,
        release: 0.06,
        gain: 0.18,
      },
      ok: {
        freq: 1600,
        freq2: 2000,
        type: 'sine',
        attack: 0.006,
        decay: 0.08,
        sustain: 0.0,
        release: 0.12,
        gain: 0.2,
        gain2: 0.1,
      },
    },
    write: {
      start: {
        freq: 440,
        type: 'triangle',
        attack: 0.005,
        decay: 0.05,
        sustain: 0.0,
        release: 0.09,
        gain: 0.22,
        filter: 1400,
      },
      ok: {
        freq: 392,
        freq2: 523,
        type: 'triangle',
        attack: 0.005,
        decay: 0.12,
        sustain: 0.0,
        release: 0.18,
        gain: 0.24,
        gain2: 0.14,
        filter: 1600,
      },
    },
    search: {
      start: {
        freq: 600,
        freq2: 1200,
        type: 'sine',
        attack: 0.01,
        decay: 0.12,
        sustain: 0.0,
        release: 0.15,
        gain: 0.18,
        filter: 1800,
      },
      ok: {
        freq: 1400,
        freq2: 900,
        type: 'sine',
        attack: 0.008,
        decay: 0.14,
        sustain: 0.0,
        release: 0.18,
        gain: 0.22,
        gain2: 0.1,
      },
    },
    agent: {
      start: {
        freq: 80,
        freq2: 120,
        type: 'sine',
        attack: 0.03,
        decay: 0.25,
        sustain: 0.0,
        release: 0.35,
        gain: 0.24,
        gain2: 0.14,
        filter: 400,
      },
      ok: {
        freq: 220,
        freq2: 330,
        type: 'sine',
        attack: 0.015,
        decay: 0.2,
        sustain: 0.0,
        release: 0.3,
        gain: 0.24,
        gain2: 0.13,
        filter: 500,
      },
    },
    default: {
      start: {
        freq: 660,
        type: 'square',
        attack: 0.004,
        decay: 0.035,
        sustain: 0.0,
        release: 0.06,
        gain: 0.16,
        filter: 1100,
      },
      ok: {
        freq: 880,
        freq2: 1108,
        type: 'sine',
        attack: 0.008,
        decay: 0.12,
        sustain: 0.0,
        release: 0.22,
        gain: 0.26,
        gain2: 0.14,
      },
    },
  };

// ---------------------------------------------------------------------------
// Cooldowns
// ---------------------------------------------------------------------------

const EVENT_COOLDOWNS: Partial<Record<ChirpEvent, number>> = {
  text_delta: 160,
  tool_start: 120,
  tool_result_ok: 200,
  text_start: 100,
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ChirpEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private lastFired = new Map<ChirpEvent, number>();
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 1.0;
  private style: SoundStyle = 'melodic';

  private createContext(): AudioContext {
    const ctx = new AudioContext();

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.2;

    // Gentle high shelf to add air, slight low-cut to avoid muddiness
    const hiShelf = ctx.createBiquadFilter();
    hiShelf.type = 'highshelf';
    hiShelf.frequency.value = 6000;
    hiShelf.gain.value = 2.5; // +2.5 dB above 6 kHz — adds sparkle

    const loShelf = ctx.createBiquadFilter();
    loShelf.type = 'highpass';
    loShelf.frequency.value = 60; // remove sub-bass rumble

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume;

    // Signal path: masterGain → loShelf → hiShelf → compressor → destination
    this.masterGain.connect(loShelf);
    loShelf.connect(hiShelf);
    hiShelf.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });

    return ctx;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = this.createContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Play a single additive synthesis note.
   * Each partial gets its own oscillator + gain node with an
   * exponential decay envelope — far more natural than linear ramps.
   */
  private playNote(spec: NoteSpec, startOffset = 0): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const t = ctx.currentTime + startOffset;

    for (const ot of spec.partials) {
      const freq =
        spec.freq * ot.ratio + (spec.detune ? spec.freq * ot.ratio * (spec.detune / 1200) : 0);
      const peakGain = spec.gain * ot.gain;

      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      // Attack: linear ramp to peak
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peakGain, t + spec.attack);

      // Decay: exponential — this is what makes it sound like a real struck instrument.
      // setTargetAtTime approaches 0 exponentially with the given time constant.
      const decayEnd = t + spec.attack + ot.decay;
      env.gain.setTargetAtTime(0.0001, t + spec.attack, ot.decay * 0.4);

      // Release tail — linear to silence
      const noteEnd = decayEnd + spec.release;
      env.gain.setValueAtTime(0.0001, decayEnd);
      env.gain.linearRampToValueAtTime(0, noteEnd);

      osc.connect(env);
      env.connect(master);
      osc.start(t);
      osc.stop(noteEnd + 0.05);
    }
  }

  private playSpec(spec: NoteSpec | NoteSpec[], startOffset = 0): void {
    if (Array.isArray(spec)) {
      for (const s of spec) this.playNote(s, startOffset);
    } else {
      this.playNote(spec, startOffset);
    }
  }

  /**
   * Soft brush stroke — replaces the old scribble noise burst.
   * Filtered noise shaped to sound like a light brush on a drumhead:
   * narrower band, gentler gain, softer onset.
   */
  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.ceil(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  private playBrush(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.038;

    // Soft brush: one bandpass band around 2.5 kHz, gentle gain
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    bp.Q.value = 1.8;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.005); // gentle onset
    env.gain.setTargetAtTime(0.0001, now + 0.005, 0.018);

    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.01);
  }

  /**
   * "Huh?" — three marimba notes with rising pitch, interrogative contour.
   * E4 → G4 → B4→D5 (the last note bends upward like a spoken question).
   */
  private playUserQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const marimbaTone = (
      startT: number,
      freqA: number,
      freqB: number,
      dur: number,
      gain: number,
    ) => {
      for (const ot of MARIMBA) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        // Bend the fundamental only on the last note
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }

        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.005);
        env.gain.setTargetAtTime(0.0001, now + startT + 0.005, ot.decay * 0.4);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.06);

        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.1);
      }
    };

    //             start  fA           fB           dur   gain
    marimbaTone(0.0, NOTES.E4, NOTES.E4, 0.08, 0.24);
    marimbaTone(0.1, NOTES.G4, NOTES.G4, 0.08, 0.26);
    marimbaTone(0.21, NOTES.A4, NOTES.D5, 0.32, 0.32); // bends up — the "?"
  }

  /**
   * Rubber-duck squeak — replaces text_delta in whimsy mode.
   * A very short bandpass noise burst tuned around 1.8–3.5 kHz
   * with a fast attack/release to sound like a tiny toy squeak.
   */
  private playWhimsySqueak(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.028;

    // Two bandpass bands for the characteristic double-peak of a squeeze toy
    const squeakBand = (center: number, Q: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = center;
      bp.Q.value = Q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.003);
      env.gain.setTargetAtTime(0.0001, now + 0.003, 0.012);
      src.connect(bp);
      bp.connect(env);
      env.connect(master);
      src.start(now);
      src.stop(now + dur + 0.005);
    };

    squeakBand(2200, 3.5, 0.28);
    squeakBand(3800, 5.0, 0.14);
  }

  /**
   * Whimsy user question — "doo-doo-doo?" in toy piano.
   * Three toy piano notes rising with a little upward bend on the last note.
   */
  private playWhimsyQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const toyNote = (startT: number, freqA: number, freqB: number, dur: number, gain: number) => {
      for (const ot of TOY_PIANO) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }
        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.002);
        env.gain.setTargetAtTime(0.0001, now + startT + 0.002, ot.decay * 0.4);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.05);
        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.08);
      }
    };

    //          start  fA                     fB                     dur   gain
    toyNote(0.0, WHIMSY_NOTES.E5, WHIMSY_NOTES.E5, 0.07, 0.24);
    toyNote(0.09, WHIMSY_NOTES.G5, WHIMSY_NOTES.G5, 0.07, 0.26);
    toyNote(0.19, WHIMSY_NOTES.A5, WHIMSY_NOTES.C6, 0.28, 0.3); // bends up!
  }

  /**
   * Forest rustle — replaces text_delta in forest mode.
   * Soft filtered noise shaped like wind through leaves,
   * with a gentle high-frequency shimmer and a low rustle undertone.
   * Much gentler and more organic than the tech brush stroke.
   */
  private playForestRustle(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.045;

    // Leafy rustle: broad bandpass around 1.8 kHz, very soft
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 1.2; // wide band = natural sounding

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.16, now + 0.008); // soft onset
    env.gain.setTargetAtTime(0.0001, now + 0.008, 0.022);

    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.01);

    // Add a tiny fairy sparkle overtone for magic
    const sparkle = ctx.createOscillator();
    const sparkleEnv = ctx.createGain();
    sparkle.type = 'sine';
    sparkle.frequency.setValueAtTime(FOREST_NOTES.D6, now);
    sparkleEnv.gain.setValueAtTime(0, now);
    sparkleEnv.gain.linearRampToValueAtTime(0.04, now + 0.004);
    sparkleEnv.gain.setTargetAtTime(0.0001, now + 0.004, 0.015);
    sparkle.connect(sparkleEnv);
    sparkleEnv.connect(master);
    sparkle.start(now);
    sparkle.stop(now + dur + 0.01);
  }

  /**
   * Forest question — "hoo-hoo-hoo?" in wooden flute.
   * Three ascending flute tones with the last bending upward,
   * like a woodland creature calling a question through the trees.
   */
  private playForestQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const fluteNote = (startT: number, freqA: number, freqB: number, dur: number, gain: number) => {
      for (const ot of WOODEN_FLUTE) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }
        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.008); // breathy onset
        env.gain.setTargetAtTime(0.0001, now + startT + 0.008, ot.decay * 0.4);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.06);
        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.1);
      }
    };

    //             start  fA                    fB                    dur   gain
    fluteNote(0.0,   FOREST_NOTES.G4, FOREST_NOTES.G4, 0.09, 0.22);
    fluteNote(0.11,  FOREST_NOTES.A4, FOREST_NOTES.A4, 0.09, 0.24);
    fluteNote(0.22,  FOREST_NOTES.B4, FOREST_NOTES.D5, 0.3,  0.3); // bends up — the "?"
  }

  /**
   * Wind chime breeze — replaces text_delta in wind-chime mode.
   * A gentle, airy shimmer: soft high-passed noise shaped like
   * a light breeze, with a delicate high-frequency tinkle overtone.
   * Uses a higher centre frequency and wider band for a more open,
   * spacious airiness rather than a tight hiss.
   */
  private playWindChimeBreeze(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.04;

    // Airy breeze: higher bandpass at 3.2 kHz, very wide = spacious air
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.5; // very wide band = open, spacious breeze

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.08, now + 0.006); // soft onset
    env.gain.setTargetAtTime(0.0001, now + 0.006, 0.015);

    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.01);

    // Add a tiny pure tinkle overtone for sparkle
    const tinkle = ctx.createOscillator();
    const tinkleEnv = ctx.createGain();
    tinkle.type = 'sine';
    tinkle.frequency.setValueAtTime(CHIME_NOTES.F6, now);
    tinkleEnv.gain.setValueAtTime(0, now);
    tinkleEnv.gain.linearRampToValueAtTime(0.025, now + 0.003);
    tinkleEnv.gain.setTargetAtTime(0.0001, now + 0.003, 0.012);
    tinkle.connect(tinkleEnv);
    tinkleEnv.connect(master);
    tinkle.start(now);
    tinkle.stop(now + dur + 0.01);
  }

  /**
   * Wind chime question — ascending crystal chime tones.
   * Three brightening chime strikes (F5 → A5 → C6 bend up),
   * using consonant intervals for a clean, open rising question.
   */
  private playWindChimeQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const chimeStrike = (startT: number, freqA: number, freqB: number, dur: number, gain: number) => {
      for (const ot of CRYSTAL_CHIME) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }
        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.003);
        env.gain.setTargetAtTime(0.0001, now + startT + 0.003, ot.decay * 0.35);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.04);
        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.08);
      }
    };

    //                start  fA                  fB                  dur   gain
    chimeStrike(0.0,   CHIME_NOTES.F5, CHIME_NOTES.F5, 0.07, 0.2);
    chimeStrike(0.09,  CHIME_NOTES.A5, CHIME_NOTES.A5, 0.07, 0.22);
    chimeStrike(0.19,  CHIME_NOTES.C6, CHIME_NOTES.F6, 0.22, 0.26); // bends up — the "?"
  }

  toolStart(name: string) {
    const key: ChirpEvent = 'tool_start';
    const cooldown = EVENT_COOLDOWNS[key];
    if (cooldown !== undefined) {
      const now = performance.now();
      if (now - (this.lastFired.get(key) ?? 0) < cooldown) return;
      this.lastFired.set(key, now);
    }
    try {
      if (this.style === 'classic') {
        this.playClassicConfig(CLASSIC_TOOL_CHIRPS[toolFamily(name)].start);
      } else if (this.style === 'whimsy') {
        this.playSpec(WHIMSY_TOOL_NOTES[toolFamily(name)].start);
      } else if (this.style === 'forest') {
        this.playSpec(FOREST_TOOL_NOTES[toolFamily(name)].start);
      } else if (this.style === 'wind-chime') {
        this.playSpec(WIND_CHIME_TOOL_NOTES[toolFamily(name)].start);
      } else {
        this.playSpec(TOOL_NOTES[toolFamily(name)].start);
      }
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }
  }

  toolResultOk(name: string) {
    const key: ChirpEvent = 'tool_result_ok';
    const cooldown = EVENT_COOLDOWNS[key];
    if (cooldown !== undefined) {
      const now = performance.now();
      if (now - (this.lastFired.get(key) ?? 0) < cooldown) return;
      this.lastFired.set(key, now);
    }
    try {
      if (this.style === 'classic') {
        this.playClassicConfig(CLASSIC_TOOL_CHIRPS[toolFamily(name)].ok);
      } else if (this.style === 'whimsy') {
        this.playSpec(WHIMSY_TOOL_NOTES[toolFamily(name)].ok);
      } else if (this.style === 'forest') {
        this.playSpec(FOREST_TOOL_NOTES[toolFamily(name)].ok);
      } else if (this.style === 'wind-chime') {
        this.playSpec(WIND_CHIME_TOOL_NOTES[toolFamily(name)].ok);
      } else {
        this.playSpec(TOOL_NOTES[toolFamily(name)].ok);
      }
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }
  }

  chirp(event: ChirpEvent) {
    const cooldown = EVENT_COOLDOWNS[event];
    if (cooldown !== undefined) {
      const now = performance.now();
      if (now - (this.lastFired.get(event) ?? 0) < cooldown) return;
      this.lastFired.set(event, now);
    }

    try {
      if (this.style === 'classic') {
        if (event === 'text_delta') {
          this.playClassicScribble();
          return;
        }
        if (event === 'user_question') {
          this.playClassicUserQuestion();
          return;
        }
        const cfg = CLASSIC_CHIRPS[event];
        if (cfg) this.playClassicConfig(cfg);
        return;
      }

      if (this.style === 'whimsy') {
        if (event === 'text_delta') {
          this.playWhimsySqueak();
          return;
        }
        if (event === 'user_question') {
          this.playWhimsyQuestion();
          return;
        }
        const spec = WHIMSY_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec);
        return;
      }

      if (this.style === 'forest') {
        if (event === 'text_delta') {
          this.playForestRustle();
          return;
        }
        if (event === 'user_question') {
          this.playForestQuestion();
          return;
        }
        const spec = FOREST_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec);
        return;
      }

      if (this.style === 'wind-chime') {
        if (event === 'text_delta') {
          this.playWindChimeBreeze();
          return;
        }
        if (event === 'user_question') {
          this.playWindChimeQuestion();
          return;
        }
        const spec = WIND_CHIME_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec);
        return;
      }

      // Melodic path
      if (event === 'text_delta') {
        this.playBrush();
        return;
      }
      if (event === 'user_question') {
        this.playUserQuestion();
        return;
      }

      const spec = EVENT_NOTES[event];
      if (!spec) return;
      this.playSpec(spec);
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }
  }

  // ── Classic synthesis playback ─────────────────────────────────────────────

  private playClassicConfig(cfg: ClassicConfig): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const playOsc = (freq: number, gainPeak: number) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = cfg.type;
      osc.frequency.setValueAtTime(freq, now);
      if (cfg.freq2 && freq === cfg.freq) {
        osc.frequency.linearRampToValueAtTime(cfg.freq2, now + cfg.attack + cfg.decay);
      }
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gainPeak, now + cfg.attack);
      env.gain.linearRampToValueAtTime(gainPeak * cfg.sustain, now + cfg.attack + cfg.decay);
      env.gain.linearRampToValueAtTime(0, now + cfg.attack + cfg.decay + cfg.release);
      if (cfg.filter) {
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = cfg.filter;
        osc.connect(lpf);
        lpf.connect(env);
      } else {
        osc.connect(env);
      }
      env.connect(master);
      osc.start(now);
      osc.stop(now + cfg.attack + cfg.decay + cfg.release + 0.05);
    };

    playOsc(cfg.freq, cfg.gain);

    if (cfg.freq2 && cfg.gain2 !== undefined) {
      const harm = ctx.createOscillator();
      const harmEnv = ctx.createGain();
      harm.type = 'sine';
      harm.frequency.setValueAtTime(cfg.freq2, now);
      harmEnv.gain.setValueAtTime(0, now);
      harmEnv.gain.linearRampToValueAtTime(cfg.gain2, now + cfg.attack);
      harmEnv.gain.linearRampToValueAtTime(cfg.gain2 * cfg.sustain, now + cfg.attack + cfg.decay);
      harmEnv.gain.linearRampToValueAtTime(0, now + cfg.attack + cfg.decay + cfg.release);
      harm.connect(harmEnv);
      harmEnv.connect(master);
      harm.start(now);
      harm.stop(now + cfg.attack + cfg.decay + cfg.release + 0.05);
    }
  }

  private playClassicScribble(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.045;
    const burst = (centerHz: number, Q: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = centerHz;
      bp.Q.value = Q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp);
      bp.connect(env);
      env.connect(master);
      src.start(now);
      src.stop(now + dur + 0.005);
    };
    burst(4200, 2.5, 0.55);
    burst(8500, 4.0, 0.25);
  }

  private playClassicUserQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const note = (
      startT: number,
      freqStart: number,
      freqEnd: number,
      dur: number,
      gain: number,
    ) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqStart, now + startT);
      osc.frequency.linearRampToValueAtTime(freqEnd, now + startT + dur);
      const att = 0.008,
        rel = dur * 0.45;
      env.gain.setValueAtTime(0, now + startT);
      env.gain.linearRampToValueAtTime(gain, now + startT + att);
      env.gain.linearRampToValueAtTime(gain * 0.6, now + startT + dur - rel);
      env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.04);
      osc.connect(env);
      env.connect(master);
      osc.start(now + startT);
      osc.stop(now + startT + dur + 0.08);
    };
    note(0.0, 329, 329, 0.07, 0.22);
    note(0.09, 392, 392, 0.07, 0.24);
    note(0.19, 494, 587, 0.28, 0.3);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setStyle(s: SoundStyle) {
    this.style = s;
  }

  unlock() {
    this.ensureContext();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
  }
}

/** Singleton — shared across the app */
export const chirpEngine = new ChirpEngine();
