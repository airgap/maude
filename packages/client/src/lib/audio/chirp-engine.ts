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
  | 'message_start'       // New response begins
  | 'text_start'          // Text block starts
  | 'text_delta'          // Text streaming (throttled)
  | 'thinking_start'      // Thinking block
  | 'tool_start'          // Tool invocation
  | 'tool_result_ok'      // Tool success
  | 'tool_result_error'   // Tool error
  | 'tool_approval'       // Awaiting user approval
  | 'user_question'       // User question prompt
  | 'message_stop'        // Response complete
  | 'error'               // Stream error
  | 'cancelled';          // User cancelled

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
  { ratio: 1,    gain: 1.00, decay: 0.80 },
  { ratio: 4,    gain: 0.35, decay: 0.18 },
  { ratio: 10,   gain: 0.12, decay: 0.06 },
  { ratio: 18,   gain: 0.05, decay: 0.03 },
];

/**
 * Vibraphone — aluminium bar with resonator tube.
 * Brighter than marimba, prominent 3rd and 5th harmonics,
 * longer metallic sustain. The motor tremolo effect is omitted
 * for brevity but the spectral shape is right.
 */
const VIBRAPHONE: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 1.20 },
  { ratio: 3.03, gain: 0.40, decay: 0.60 },  // slightly inharmonic — real vibes
  { ratio: 5.95, gain: 0.18, decay: 0.30 },
  { ratio: 8.60, gain: 0.08, decay: 0.14 },
  { ratio: 12.3, gain: 0.04, decay: 0.07 },
];

/**
 * Singing bowl / bowed glass — nearly pure fundamental with one
 * very soft octave partial, very slow attack, long ring.
 */
const BOWL: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 3.50 },
  { ratio: 2.76, gain: 0.20, decay: 2.00 },  // inharmonic second partial
  { ratio: 5.40, gain: 0.06, decay: 0.80 },
];

/**
 * Struck metal plate — dense inharmonic partials.
 * Models a hit on a large plate or tam-tam: aggressive, clangy,
 * with a cluster of inharmonic frequencies.
 */
const PLATE: Overtone[] = [
  { ratio: 1,    gain: 0.80, decay: 0.25 },
  { ratio: 1.51, gain: 0.70, decay: 0.18 },
  { ratio: 2.20, gain: 0.55, decay: 0.12 },
  { ratio: 3.17, gain: 0.40, decay: 0.09 },
  { ratio: 4.80, gain: 0.25, decay: 0.06 },
  { ratio: 6.90, gain: 0.15, decay: 0.04 },
];

/**
 * Tubular bell — long metallic sustain, strong 2nd and 3rd inharmonic partials.
 * Used for attention / approval chimes.
 */
const BELL: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 2.50 },
  { ratio: 2.76, gain: 0.60, decay: 1.80 },
  { ratio: 5.40, gain: 0.25, decay: 1.00 },
  { ratio: 8.93, gain: 0.12, decay: 0.50 },
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
  C4: 261.6, D4: 293.7, E4: 329.6, G4: 392.0, A4: 440.0,
  C5: 523.3, D5: 587.3, E5: 659.3, G5: 784.0, A5: 880.0,
  C6: 1046.5, E6: 1318.5,
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
    freq: NOTES.G4, partials: MARIMBA,
    attack: 0.004, release: 0.08, gain: 0.32,
  },

  // Soft vibraphone tap — E5, barely there
  text_start: {
    freq: NOTES.E5, partials: VIBRAPHONE,
    attack: 0.003, release: 0.06, gain: 0.18,
  },

  // text_delta handled by playBrush() — gain:0 sentinel so Record is complete
  text_delta: {
    freq: NOTES.A5, partials: VIBRAPHONE,
    attack: 0.002, release: 0.03, gain: 0.0,
  },

  // Singing bowl on G3 — low, contemplative
  thinking_start: {
    freq: NOTES.G3, partials: BOWL,
    attack: 0.06, release: 0.5, gain: 0.26,
  },

  // tool events handled per-family in TOOL_NOTES — placeholder unused
  tool_start: {
    freq: NOTES.D4, partials: VIBRAPHONE,
    attack: 0.004, release: 0.07, gain: 0.20,
  },

  // Vibraphone major third — D5 + A5
  tool_result_ok: [
    { freq: NOTES.D5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.24 },
    { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.14 },
  ],

  // Plate strike on Bb4 — dissonant clang
  tool_result_error: {
    freq: NOTES.Bb4, partials: PLATE,
    attack: 0.003, release: 0.12, gain: 0.28,
  },

  // Bell chord — C5 + E5 + G5 (major triad), sustained
  tool_approval: [
    { freq: NOTES.C5, partials: BELL, attack: 0.008, release: 0.5,  gain: 0.28 },
    { freq: NOTES.E5, partials: BELL, attack: 0.008, release: 0.5,  gain: 0.20 },
    { freq: NOTES.G5, partials: BELL, attack: 0.008, release: 0.5,  gain: 0.14 },
  ],

  // user_question handled by playUserQuestion()
  user_question: {
    freq: NOTES.E4, partials: MARIMBA,
    attack: 0.005, release: 0.12, gain: 0.0,  // gain=0 sentinel — uses special handler
  },

  // Marimba resolution — C5 + E5 + G5, warm landing
  message_stop: [
    { freq: NOTES.C5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.28 },
    { freq: NOTES.E5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.20 },
    { freq: NOTES.G5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.14 },
  ],

  // Descending plate hits — Bb4 then G3
  error: [
    { freq: NOTES.Bb4, partials: PLATE, attack: 0.003, release: 0.18, gain: 0.30 },
    { freq: NOTES.G3,  partials: PLATE, attack: 0.003, release: 0.18, gain: 0.20 },
  ],

  // Soft marimba descent — A4 → G4, gentle fade
  cancelled: [
    { freq: NOTES.A4, partials: MARIMBA, attack: 0.006, release: 0.30, gain: 0.20 },
    { freq: NOTES.G4, partials: MARIMBA, attack: 0.006, release: 0.40, gain: 0.14 },
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
  if (n === 'write' || n === 'edit' || n === 'notebookedit' ||
      n === 'str_replace_editor' || n === 'write_file' ||
      n === 'edit_file' || n === 'create_file') return 'write';
  if (n === 'websearch' || n === 'webfetch') return 'search';
  if (n === 'task' || n.startsWith('mcp__')) return 'agent';
  return 'default';
}

interface ToolNotes {
  start: NoteSpec | NoteSpec[];
  ok:    NoteSpec | NoteSpec[];
}

const TOOL_NOTES: Record<ToolFamily, ToolNotes> = {
  // Shell — low marimba, grounded, decisive
  shell: {
    start: { freq: NOTES.C4, partials: MARIMBA, attack: 0.004, release: 0.10, gain: 0.24 },
    ok:    [
      { freq: NOTES.C4, partials: MARIMBA, attack: 0.004, release: 0.12, gain: 0.22 },
      { freq: NOTES.G4, partials: MARIMBA, attack: 0.004, release: 0.12, gain: 0.14 },
    ],
  },
  // Read — high vibraphone, light and airy
  read: {
    start: { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.003, release: 0.08, gain: 0.18 },
    ok:    [
      { freq: NOTES.E5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.18 },
      { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.12 },
    ],
  },
  // Write — mid marimba, weighted, solid
  write: {
    start: { freq: NOTES.D4, partials: MARIMBA, attack: 0.005, release: 0.10, gain: 0.24 },
    ok:    [
      { freq: NOTES.G4, partials: MARIMBA, attack: 0.005, release: 0.14, gain: 0.22 },
      { freq: NOTES.D5, partials: MARIMBA, attack: 0.005, release: 0.14, gain: 0.14 },
    ],
  },
  // Search — bowl sweep: low attack, singing
  search: {
    start: { freq: NOTES.D5, partials: BOWL, attack: 0.02, release: 0.20, gain: 0.20 },
    ok:    [
      { freq: NOTES.G4, partials: VIBRAPHONE, attack: 0.005, release: 0.16, gain: 0.20 },
      { freq: NOTES.D5, partials: VIBRAPHONE, attack: 0.005, release: 0.16, gain: 0.12 },
    ],
  },
  // Agent — deep bell, resonant spawn
  agent: {
    start: { freq: NOTES.C4, partials: BELL, attack: 0.015, release: 0.50, gain: 0.26 },
    ok:    [
      { freq: NOTES.G4, partials: BELL, attack: 0.010, release: 0.40, gain: 0.24 },
      { freq: NOTES.C5, partials: BELL, attack: 0.010, release: 0.40, gain: 0.16 },
    ],
  },
  // Default — vibraphone D4
  default: {
    start: { freq: NOTES.D4, partials: VIBRAPHONE, attack: 0.004, release: 0.08, gain: 0.20 },
    ok:    [
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
  { ratio: 1,    gain: 1.00, decay: 2.20 },
  { ratio: 2.03, gain: 0.28, decay: 0.90 },  // slightly inharmonic 2nd
  { ratio: 4.12, gain: 0.10, decay: 0.35 },
  { ratio: 6.84, gain: 0.04, decay: 0.14 },
];

/**
 * Toy Piano — thin metal tine struck by a tiny hammer.
 * Bright, brittle, slightly hollow. Higher partials decay almost instantly.
 */
const TOY_PIANO: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 0.55 },
  { ratio: 2.0,  gain: 0.50, decay: 0.20 },
  { ratio: 3.1,  gain: 0.28, decay: 0.09 },
  { ratio: 5.0,  gain: 0.12, decay: 0.04 },
  { ratio: 7.5,  gain: 0.06, decay: 0.02 },
];

/**
 * Kalimba (thumb piano) — warm fundamental with a quick metallic twang.
 * The tine rings bright, decays into a deep warm resonance.
 */
const KALIMBA: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 1.80 },
  { ratio: 2.0,  gain: 0.55, decay: 0.65 },
  { ratio: 3.05, gain: 0.20, decay: 0.22 },
  { ratio: 4.92, gain: 0.08, decay: 0.08 },
];

/**
 * Toy Xylophone — short wooden bars, higher register, bouncier than marimba.
 * Lots of click on attack, harmonics die fast leaving just the warm tone.
 */
const TOY_XYLOPHONE: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 0.50 },
  { ratio: 3.0,  gain: 0.45, decay: 0.10 },
  { ratio: 7.0,  gain: 0.18, decay: 0.04 },
  { ratio: 12.0, gain: 0.06, decay: 0.02 },
];

// ---------------------------------------------------------------------------
// Slot Machine instrument partial series
// Casino-themed synthesis: coins, reels, levers, and jackpot bells.
// ---------------------------------------------------------------------------

/**
 * Coin Drop — bright metallic ping, like a coin hitting a metal tray.
 * Strong high-frequency attack with fast decay, metallic clang character.
 * The inharmonic upper partials give it that distinctive "clink" sound.
 */
const COIN: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 0.35 },
  { ratio: 2.73, gain: 0.55, decay: 0.12 },  // inharmonic metallic ring
  { ratio: 5.18, gain: 0.30, decay: 0.06 },
  { ratio: 8.45, gain: 0.15, decay: 0.03 },
  { ratio: 13.1, gain: 0.08, decay: 0.015 },
];

/**
 * Reel Click — short mechanical click, like a reel stop locking into place.
 * Very percussive, almost no sustain, dense harmonics for that
 * satisfying mechanical "chunk" when a reel lands.
 */
const REEL: Overtone[] = [
  { ratio: 1,    gain: 0.80, decay: 0.08 },
  { ratio: 2.35, gain: 0.60, decay: 0.04 },
  { ratio: 4.10, gain: 0.40, decay: 0.025 },
  { ratio: 6.80, gain: 0.25, decay: 0.015 },
  { ratio: 11.2, gain: 0.12, decay: 0.008 },
];

/**
 * Lever — spring-loaded pull sound, metallic with a slight wobble.
 * Longer decay than reel, simulates the lever arm's vibration
 * after being pulled and released.
 */
const LEVER: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 0.60 },
  { ratio: 1.47, gain: 0.45, decay: 0.40 },  // close interval = beating wobble
  { ratio: 3.22, gain: 0.20, decay: 0.15 },
  { ratio: 5.87, gain: 0.10, decay: 0.06 },
];

/**
 * Jackpot Bell — loud, celebratory bell with long sustain.
 * Rich harmonics with slow decay, the unmistakable "ding ding ding"
 * of a big win. Brighter and more aggressive than the tubular bell.
 */
const JACKPOT_BELL: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 3.00 },
  { ratio: 2.00, gain: 0.70, decay: 2.20 },
  { ratio: 3.56, gain: 0.45, decay: 1.40 },
  { ratio: 5.12, gain: 0.25, decay: 0.80 },
  { ratio: 7.80, gain: 0.12, decay: 0.40 },
  { ratio: 11.5, gain: 0.06, decay: 0.20 },
];

/**
 * Payout Cascade — bright, shimmery coin cascade sound.
 * Multiple close-spaced partials that create a shimmering,
 * cascading quality — like coins tumbling into a tray.
 */
const CASCADE: Overtone[] = [
  { ratio: 1,    gain: 1.00, decay: 0.50 },
  { ratio: 1.12, gain: 0.80, decay: 0.45 },  // close detuning = shimmer
  { ratio: 2.87, gain: 0.40, decay: 0.25 },
  { ratio: 4.53, gain: 0.20, decay: 0.12 },
  { ratio: 7.20, gain: 0.10, decay: 0.06 },
];

// Slot machine scale — mixolydian (major with flat 7th) for that Vegas swagger
// The b7 gives it a bluesy, confident, "lucky" quality
const SLOT_NOTES = {
  C4: 261.6,  D4: 293.7,  E4: 329.6,  F4: 349.2,
  G4: 392.0,  A4: 440.0,  Bb4: 466.2,
  C5: 523.3,  D5: 587.3,  E5: 659.3,  F5: 698.5,
  G5: 784.0,  A5: 880.0,  Bb5: 932.3,
  C6: 1046.5, E6: 1318.5, G6: 1568.0,
  // Low lever pull note
  G3: 196.0,
};

// Event → slot machine note specs
const SLOT_MACHINE_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Lever pull — G3, metallic spring sound, "here we go"
  message_start: {
    freq: SLOT_NOTES.G3, partials: LEVER,
    attack: 0.003, release: 0.15, gain: 0.30,
  },

  // Single coin insert — E5, bright metallic clink
  text_start: {
    freq: SLOT_NOTES.E5, partials: COIN,
    attack: 0.001, release: 0.06, gain: 0.20,
  },

  // text_delta → playSlotSpin() — sentinel
  text_delta: {
    freq: SLOT_NOTES.C6, partials: REEL,
    attack: 0.001, release: 0.02, gain: 0.0,
  },

  // Reel spinning — low lever wobble, anticipation
  thinking_start: {
    freq: SLOT_NOTES.C4, partials: LEVER,
    attack: 0.04, release: 0.5, gain: 0.26,
  },

  // Reel stop click — D5
  tool_start: {
    freq: SLOT_NOTES.D5, partials: REEL,
    attack: 0.001, release: 0.06, gain: 0.24,
  },

  // Two coins landing — E5 + A5 (small win)
  tool_result_ok: [
    { freq: SLOT_NOTES.E5, partials: COIN, attack: 0.002, release: 0.12, gain: 0.24 },
    { freq: SLOT_NOTES.A5, partials: COIN, attack: 0.002, release: 0.12, gain: 0.16 },
  ],

  // Buzzer — Bb4 reel clank, the "no match" sound
  tool_result_error: {
    freq: SLOT_NOTES.Bb4, partials: REEL,
    attack: 0.002, release: 0.10, gain: 0.28,
  },

  // Jackpot bells — C5 + E5 + G5 + C6, full celebration
  tool_approval: [
    { freq: SLOT_NOTES.C5, partials: JACKPOT_BELL, attack: 0.006, release: 0.6,  gain: 0.28 },
    { freq: SLOT_NOTES.E5, partials: JACKPOT_BELL, attack: 0.006, release: 0.6,  gain: 0.22 },
    { freq: SLOT_NOTES.G5, partials: JACKPOT_BELL, attack: 0.006, release: 0.6,  gain: 0.16 },
    { freq: SLOT_NOTES.C6, partials: JACKPOT_BELL, attack: 0.006, release: 0.6,  gain: 0.10 },
  ],

  // user_question → playSlotQuestion() — sentinel
  user_question: {
    freq: SLOT_NOTES.E4, partials: COIN,
    attack: 0.002, release: 0.10, gain: 0.0,
  },

  // Payout cascade — C5 + E5 + G5, coins tumbling into tray
  message_stop: [
    { freq: SLOT_NOTES.C5, partials: CASCADE, attack: 0.004, release: 0.40, gain: 0.28 },
    { freq: SLOT_NOTES.E5, partials: CASCADE, attack: 0.004, release: 0.40, gain: 0.22 },
    { freq: SLOT_NOTES.G5, partials: CASCADE, attack: 0.004, release: 0.40, gain: 0.16 },
  ],

  // Tilt alarm — Bb4 then G3, descending buzzer
  error: [
    { freq: SLOT_NOTES.Bb4, partials: REEL, attack: 0.003, release: 0.20, gain: 0.30 },
    { freq: SLOT_NOTES.G3,  partials: REEL, attack: 0.003, release: 0.20, gain: 0.22 },
  ],

  // Cash out — A5 → G5, gentle descending coins
  cancelled: [
    { freq: SLOT_NOTES.A5, partials: COIN, attack: 0.004, release: 0.30, gain: 0.20 },
    { freq: SLOT_NOTES.G5, partials: COIN, attack: 0.004, release: 0.40, gain: 0.14 },
  ],
};

interface SlotToolNotes {
  start: NoteSpec | NoteSpec[];
  ok:    NoteSpec | NoteSpec[];
}

const SLOT_MACHINE_TOOL_NOTES: Record<ToolFamily, SlotToolNotes> = {
  // Shell — low lever pull, decisive
  shell: {
    start: { freq: SLOT_NOTES.C4, partials: LEVER, attack: 0.003, release: 0.12, gain: 0.24 },
    ok:    [
      { freq: SLOT_NOTES.C4, partials: COIN, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: SLOT_NOTES.G4, partials: COIN, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high coin sparkle, scanning reels
  read: {
    start: { freq: SLOT_NOTES.A5, partials: COIN, attack: 0.001, release: 0.08, gain: 0.18 },
    ok:    [
      { freq: SLOT_NOTES.E5, partials: COIN, attack: 0.002, release: 0.12, gain: 0.18 },
      { freq: SLOT_NOTES.A5, partials: COIN, attack: 0.002, release: 0.12, gain: 0.12 },
    ],
  },
  // Write — mid reel lock, satisfying click
  write: {
    start: { freq: SLOT_NOTES.D5, partials: REEL, attack: 0.001, release: 0.10, gain: 0.24 },
    ok:    [
      { freq: SLOT_NOTES.G5, partials: COIN, attack: 0.002, release: 0.14, gain: 0.22 },
      { freq: SLOT_NOTES.D5, partials: COIN, attack: 0.002, release: 0.14, gain: 0.14 },
    ],
  },
  // Search — lever wobble sweep
  search: {
    start: { freq: SLOT_NOTES.D5, partials: LEVER, attack: 0.012, release: 0.20, gain: 0.20 },
    ok:    [
      { freq: SLOT_NOTES.G5, partials: CASCADE, attack: 0.004, release: 0.16, gain: 0.20 },
      { freq: SLOT_NOTES.Bb5, partials: CASCADE, attack: 0.004, release: 0.16, gain: 0.12 },
    ],
  },
  // Agent — jackpot bell, big spawn energy
  agent: {
    start: { freq: SLOT_NOTES.C5, partials: JACKPOT_BELL, attack: 0.010, release: 0.50, gain: 0.26 },
    ok:    [
      { freq: SLOT_NOTES.G5, partials: JACKPOT_BELL, attack: 0.008, release: 0.40, gain: 0.24 },
      { freq: SLOT_NOTES.C6, partials: JACKPOT_BELL, attack: 0.008, release: 0.40, gain: 0.16 },
    ],
  },
  // Default — reel click D5
  default: {
    start: { freq: SLOT_NOTES.D5, partials: REEL, attack: 0.001, release: 0.08, gain: 0.20 },
    ok:    [
      { freq: SLOT_NOTES.D5, partials: COIN, attack: 0.002, release: 0.12, gain: 0.22 },
      { freq: SLOT_NOTES.A5, partials: COIN, attack: 0.002, release: 0.12, gain: 0.14 },
    ],
  },
};

// C major scale + extensions — bright, upbeat, no pentatonic flats
const WHIMSY_NOTES = {
  C4: 261.6,  D4: 293.7,  E4: 329.6,  F4: 349.2,
  G4: 392.0,  A4: 440.0,  B4: 493.9,
  C5: 523.3,  D5: 587.3,  E5: 659.3,  F5: 698.5,
  G5: 784.0,  A5: 880.0,  B5: 987.8,
  C6: 1046.5, E6: 1318.5,
  // Squeeze-toy squeak frequency (used for brush-replacement)
  F6: 1396.9,
};

// Event → whimsy note specs
const WHIMSY_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Toy piano ding — E5, cheerful readying
  message_start: {
    freq: WHIMSY_NOTES.E5, partials: TOY_PIANO,
    attack: 0.002, release: 0.10, gain: 0.30,
  },

  // Music box tinkle — G5, light and airy
  text_start: {
    freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX,
    attack: 0.001, release: 0.08, gain: 0.20,
  },

  // text_delta → playWhimsySqueak() — sentinel
  text_delta: {
    freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX,
    attack: 0.001, release: 0.02, gain: 0.0,
  },

  // Kalimba dream — C4, slow and contemplative
  thinking_start: {
    freq: WHIMSY_NOTES.C4, partials: KALIMBA,
    attack: 0.04, release: 0.6, gain: 0.28,
  },

  // Toy xylophone tick — D5
  tool_start: {
    freq: WHIMSY_NOTES.D5, partials: TOY_XYLOPHONE,
    attack: 0.002, release: 0.08, gain: 0.22,
  },

  // Two music box notes — E5 + B5
  tool_result_ok: [
    { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.24 },
    { freq: WHIMSY_NOTES.B5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.14 },
  ],

  // Toy xylophone clunk — Bb-ish (F#5-ish, slightly sour on purpose — still cute)
  tool_result_error: {
    freq: WHIMSY_NOTES.F5, partials: TOY_XYLOPHONE,
    attack: 0.003, release: 0.14, gain: 0.26,
  },

  // Magic music box triad — C5 + E5 + G5 + C6, sparkly fanfare
  tool_approval: [
    { freq: WHIMSY_NOTES.C5, partials: MUSIC_BOX, attack: 0.004, release: 0.6,  gain: 0.26 },
    { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.004, release: 0.6,  gain: 0.20 },
    { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.004, release: 0.6,  gain: 0.14 },
    { freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX, attack: 0.004, release: 0.6,  gain: 0.08 },
  ],

  // user_question → playWhimsyQuestion() — sentinel
  user_question: {
    freq: WHIMSY_NOTES.E4, partials: TOY_PIANO,
    attack: 0.002, release: 0.10, gain: 0.0,
  },

  // Kalimba landing — C5 + E5 + G5, warm resolution
  message_stop: [
    { freq: WHIMSY_NOTES.C5, partials: KALIMBA, attack: 0.004, release: 0.40, gain: 0.28 },
    { freq: WHIMSY_NOTES.E5, partials: KALIMBA, attack: 0.004, release: 0.40, gain: 0.20 },
    { freq: WHIMSY_NOTES.G5, partials: KALIMBA, attack: 0.004, release: 0.40, gain: 0.14 },
  ],

  // Sad toy xylophone tumble — B4 then G4, descending
  error: [
    { freq: WHIMSY_NOTES.B4, partials: TOY_XYLOPHONE, attack: 0.003, release: 0.20, gain: 0.28 },
    { freq: WHIMSY_NOTES.G4, partials: TOY_XYLOPHONE, attack: 0.003, release: 0.20, gain: 0.20 },
  ],

  // Toy piano wilt — A5 → G5, gentle fade
  cancelled: [
    { freq: WHIMSY_NOTES.A5, partials: TOY_PIANO, attack: 0.004, release: 0.28, gain: 0.20 },
    { freq: WHIMSY_NOTES.G5, partials: TOY_PIANO, attack: 0.004, release: 0.38, gain: 0.14 },
  ],
};

interface WhimsyToolNotes {
  start: NoteSpec | NoteSpec[];
  ok:    NoteSpec | NoteSpec[];
}

const WHIMSY_TOOL_NOTES: Record<ToolFamily, WhimsyToolNotes> = {
  // Shell — low kalimba thunk, purposeful
  shell: {
    start: { freq: WHIMSY_NOTES.C4, partials: KALIMBA, attack: 0.003, release: 0.12, gain: 0.24 },
    ok:    [
      { freq: WHIMSY_NOTES.C4, partials: KALIMBA, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: WHIMSY_NOTES.G4, partials: KALIMBA, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high music box sparkle
  read: {
    start: { freq: WHIMSY_NOTES.A5, partials: MUSIC_BOX, attack: 0.001, release: 0.10, gain: 0.18 },
    ok:    [
      { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.18 },
      { freq: WHIMSY_NOTES.A5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.12 },
    ],
  },
  // Write — mid toy piano bonk, satisfying
  write: {
    start: { freq: WHIMSY_NOTES.D5, partials: TOY_PIANO, attack: 0.002, release: 0.12, gain: 0.24 },
    ok:    [
      { freq: WHIMSY_NOTES.G5, partials: TOY_PIANO, attack: 0.002, release: 0.16, gain: 0.22 },
      { freq: WHIMSY_NOTES.D5, partials: TOY_PIANO, attack: 0.002, release: 0.16, gain: 0.14 },
    ],
  },
  // Search — kalimba shimmer sweep
  search: {
    start: { freq: WHIMSY_NOTES.D5, partials: KALIMBA, attack: 0.015, release: 0.22, gain: 0.20 },
    ok:    [
      { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.004, release: 0.18, gain: 0.20 },
      { freq: WHIMSY_NOTES.B5, partials: MUSIC_BOX, attack: 0.004, release: 0.18, gain: 0.12 },
    ],
  },
  // Agent — music box chord, magical spawn
  agent: {
    start: { freq: WHIMSY_NOTES.C5, partials: MUSIC_BOX, attack: 0.010, release: 0.55, gain: 0.26 },
    ok:    [
      { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.008, release: 0.45, gain: 0.24 },
      { freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX, attack: 0.008, release: 0.45, gain: 0.16 },
    ],
  },
  // Default — toy xylophone D5
  default: {
    start: { freq: WHIMSY_NOTES.D5, partials: TOY_XYLOPHONE, attack: 0.002, release: 0.10, gain: 0.20 },
    ok:    [
      { freq: WHIMSY_NOTES.D5, partials: TOY_XYLOPHONE, attack: 0.002, release: 0.14, gain: 0.22 },
      { freq: WHIMSY_NOTES.A5, partials: TOY_XYLOPHONE, attack: 0.002, release: 0.14, gain: 0.14 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Classic (oscillator) synthesis — the original chirp engine configs
// Used when soundStyle === 'classic'
// ---------------------------------------------------------------------------

export type SoundStyle = 'classic' | 'melodic' | 'whimsy' | 'slot-machine';

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
  message_start:    { freq: 880, freq2: 1320, type: 'sine',     attack: 0.008, decay: 0.1,  sustain: 0.0,  release: 0.18, gain: 0.28, gain2: 0.16 },
  text_start:       { freq: 1400,             type: 'sine',     attack: 0.004, decay: 0.05, sustain: 0.0,  release: 0.08, gain: 0.22 },
  text_delta:       { freq: 2200,             type: 'sine',     attack: 0.002, decay: 0.018,sustain: 0.0,  release: 0.025,gain: 0.14, filter: 3000 },
  thinking_start:   { freq: 200,  freq2: 300, type: 'sine',     attack: 0.025, decay: 0.2,  sustain: 0.0,  release: 0.3,  gain: 0.22, gain2: 0.12, filter: 550 },
  tool_start:       { freq: 660,              type: 'square',   attack: 0.004, decay: 0.035,sustain: 0.0,  release: 0.06, gain: 0.16, filter: 1100 },
  tool_result_ok:   { freq: 880,  freq2: 1108,type: 'sine',     attack: 0.008, decay: 0.12, sustain: 0.0,  release: 0.22, gain: 0.26, gain2: 0.14 },
  tool_result_error:{ freq: 240,  freq2: 180, type: 'sawtooth', attack: 0.01,  decay: 0.14, sustain: 0.0,  release: 0.22, gain: 0.22, gain2: 0.13, filter: 750 },
  tool_approval:    { freq: 1047, freq2: 1319,type: 'sine',     attack: 0.01,  decay: 0.18, sustain: 0.12, release: 0.3,  gain: 0.30, gain2: 0.16 },
  user_question:    { freq: 440,              type: 'sine',     attack: 0.01,  decay: 0.1,  sustain: 0.0,  release: 0.15, gain: 0.0 },  // handled by playClassicUserQuestion
  message_stop:     { freq: 523,  freq2: 659, type: 'sine',     attack: 0.01,  decay: 0.25, sustain: 0.0,  release: 0.4,  gain: 0.28, gain2: 0.15 },
  error:            { freq: 150,  freq2: 112, type: 'sawtooth', attack: 0.01,  decay: 0.2,  sustain: 0.06, release: 0.32, gain: 0.30, gain2: 0.18, filter: 550 },
  cancelled:        { freq: 440,              type: 'sine',     attack: 0.01,  decay: 0.35, sustain: 0.0,  release: 0.45, gain: 0.18, filter: 900 },
};

type ClassicToolFamily = 'shell' | 'read' | 'write' | 'search' | 'agent' | 'default';

const CLASSIC_TOOL_CHIRPS: Record<ClassicToolFamily, { start: ClassicConfig; ok: ClassicConfig }> = {
  shell:   { start: { freq: 110,          type: 'square',   attack: 0.003, decay: 0.04, sustain: 0.0, release: 0.07, gain: 0.20, filter: 600 },
             ok:    { freq: 140, freq2: 220,type: 'square',  attack: 0.003, decay: 0.06, sustain: 0.0, release: 0.10, gain: 0.18, gain2: 0.10, filter: 700 } },
  read:    { start: { freq: 1800,          type: 'sine',     attack: 0.004, decay: 0.04, sustain: 0.0, release: 0.06, gain: 0.18 },
             ok:    { freq: 1600, freq2: 2000,type: 'sine',  attack: 0.006, decay: 0.08, sustain: 0.0, release: 0.12, gain: 0.20, gain2: 0.10 } },
  write:   { start: { freq: 440,           type: 'triangle', attack: 0.005, decay: 0.05, sustain: 0.0, release: 0.09, gain: 0.22, filter: 1400 },
             ok:    { freq: 392, freq2: 523,type: 'triangle',attack: 0.005, decay: 0.12, sustain: 0.0, release: 0.18, gain: 0.24, gain2: 0.14, filter: 1600 } },
  search:  { start: { freq: 600, freq2: 1200,type: 'sine',  attack: 0.01,  decay: 0.12, sustain: 0.0, release: 0.15, gain: 0.18, filter: 1800 },
             ok:    { freq: 1400, freq2: 900,type: 'sine',   attack: 0.008, decay: 0.14, sustain: 0.0, release: 0.18, gain: 0.22, gain2: 0.10 } },
  agent:   { start: { freq: 80,  freq2: 120,type: 'sine',   attack: 0.03,  decay: 0.25, sustain: 0.0, release: 0.35, gain: 0.24, gain2: 0.14, filter: 400 },
             ok:    { freq: 220,  freq2: 330,type: 'sine',   attack: 0.015, decay: 0.2,  sustain: 0.0, release: 0.3,  gain: 0.24, gain2: 0.13, filter: 500 } },
  default: { start: { freq: 660,           type: 'square',  attack: 0.004, decay: 0.035,sustain: 0.0, release: 0.06, gain: 0.16, filter: 1100 },
             ok:    { freq: 880, freq2: 1108,type: 'sine',   attack: 0.008, decay: 0.12, sustain: 0.0, release: 0.22, gain: 0.26, gain2: 0.14 } },
};

// ---------------------------------------------------------------------------
// Cooldowns
// ---------------------------------------------------------------------------

const EVENT_COOLDOWNS: Partial<Record<ChirpEvent, number>> = {
  text_delta:     160,
  tool_start:     120,
  tool_result_ok: 200,
  text_start:     100,
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
    this.compressor.knee.value       =   8;
    this.compressor.ratio.value      =   3;
    this.compressor.attack.value     = 0.005;
    this.compressor.release.value    = 0.20;

    // Gentle high shelf to add air, slight low-cut to avoid muddiness
    const hiShelf = ctx.createBiquadFilter();
    hiShelf.type = 'highshelf';
    hiShelf.frequency.value = 6000;
    hiShelf.gain.value = 2.5;  // +2.5 dB above 6 kHz — adds sparkle

    const loShelf = ctx.createBiquadFilter();
    loShelf.type = 'highpass';
    loShelf.frequency.value = 60;   // remove sub-bass rumble

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
      const freq = spec.freq * ot.ratio + (spec.detune ? spec.freq * ot.ratio * (spec.detune / 1200) : 0);
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
    env.gain.linearRampToValueAtTime(0.22, now + 0.005);  // gentle onset
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

    const marimbaTone = (startT: number, freqA: number, freqB: number, dur: number, gain: number) => {
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
    marimbaTone(0.00,  NOTES.E4,    NOTES.E4,    0.08, 0.24);
    marimbaTone(0.10,  NOTES.G4,    NOTES.G4,    0.08, 0.26);
    marimbaTone(0.21,  NOTES.A4,    NOTES.D5,    0.32, 0.32);  // bends up — the "?"
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
    toyNote(0.00,  WHIMSY_NOTES.E5,       WHIMSY_NOTES.E5,       0.07, 0.24);
    toyNote(0.09,  WHIMSY_NOTES.G5,       WHIMSY_NOTES.G5,       0.07, 0.26);
    toyNote(0.19,  WHIMSY_NOTES.A5,       WHIMSY_NOTES.C6,       0.28, 0.30);  // bends up!
  }

  /**
   * Slot machine reel tick — replaces text_delta in slot-machine mode.
   * A rapid mechanical clicking sound, like reels spinning past symbols.
   * Short filtered noise burst with a metallic resonance.
   */
  private playSlotSpin(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.025;

    // Metallic reel tick: narrow bandpass around 3.5 kHz
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3500;
    bp.Q.value = 6.0;  // narrow = more tonal, mechanical

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.30, now + 0.002);  // sharp attack
    env.gain.setTargetAtTime(0.0001, now + 0.002, 0.010);

    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.005);

    // Add a tiny pitched "click" overtone for extra mechanical feel
    const click = ctx.createOscillator();
    const clickEnv = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(SLOT_NOTES.G6, now);
    clickEnv.gain.setValueAtTime(0, now);
    clickEnv.gain.linearRampToValueAtTime(0.12, now + 0.001);
    clickEnv.gain.setTargetAtTime(0.0001, now + 0.001, 0.006);
    click.connect(clickEnv);
    clickEnv.connect(master);
    click.start(now);
    click.stop(now + dur + 0.005);
  }

  /**
   * Slot machine question — "cha-ching?" rising coin toss.
   * Three coin pings ascending with the last one bending upward,
   * like tossing a coin and watching it arc.
   */
  private playSlotQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const coinPing = (startT: number, freqA: number, freqB: number, dur: number, gain: number) => {
      for (const ot of COIN) {
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

    //              start  fA                fB                dur   gain
    coinPing(0.00,  SLOT_NOTES.E5,   SLOT_NOTES.E5,   0.06, 0.24);
    coinPing(0.08,  SLOT_NOTES.G5,   SLOT_NOTES.G5,   0.06, 0.26);
    coinPing(0.17,  SLOT_NOTES.A5,   SLOT_NOTES.C6,   0.25, 0.30);  // bends up — "?"
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
      } else if (this.style === 'slot-machine') {
        this.playSpec(SLOT_MACHINE_TOOL_NOTES[toolFamily(name)].start);
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
      } else if (this.style === 'slot-machine') {
        this.playSpec(SLOT_MACHINE_TOOL_NOTES[toolFamily(name)].ok);
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
        if (event === 'text_delta') { this.playClassicScribble(); return; }
        if (event === 'user_question') { this.playClassicUserQuestion(); return; }
        const cfg = CLASSIC_CHIRPS[event];
        if (cfg) this.playClassicConfig(cfg);
        return;
      }

      if (this.style === 'whimsy') {
        if (event === 'text_delta') { this.playWhimsySqueak(); return; }
        if (event === 'user_question') { this.playWhimsyQuestion(); return; }
        const spec = WHIMSY_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec);
        return;
      }

      if (this.style === 'slot-machine') {
        if (event === 'text_delta') { this.playSlotSpin(); return; }
        if (event === 'user_question') { this.playSlotQuestion(); return; }
        const spec = SLOT_MACHINE_EVENT_NOTES[event];
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
      src.connect(bp); bp.connect(env); env.connect(master);
      src.start(now); src.stop(now + dur + 0.005);
    };
    burst(4200, 2.5, 0.55);
    burst(8500, 4.0, 0.25);
  }

  private playClassicUserQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const note = (startT: number, freqStart: number, freqEnd: number, dur: number, gain: number) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqStart, now + startT);
      osc.frequency.linearRampToValueAtTime(freqEnd, now + startT + dur);
      const att = 0.008, rel = dur * 0.45;
      env.gain.setValueAtTime(0, now + startT);
      env.gain.linearRampToValueAtTime(gain, now + startT + att);
      env.gain.linearRampToValueAtTime(gain * 0.6, now + startT + dur - rel);
      env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.04);
      osc.connect(env); env.connect(master);
      osc.start(now + startT); osc.stop(now + startT + dur + 0.08);
    };
    note(0.00, 329, 329, 0.07, 0.22);
    note(0.09, 392, 392, 0.07, 0.24);
    note(0.19, 494, 587, 0.28, 0.30);
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
