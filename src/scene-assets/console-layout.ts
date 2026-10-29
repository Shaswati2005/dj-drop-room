/**
 * Console v2 layout, modelled on a typical two-deck DJ controller and
 * scaled for fingertips: deck A | mixer | deck B, 62 × 32 cm. Shared by the
 * body asset (slots, wells, meters) and the scene generator (where each
 * control is placed), so the two always agree. Metres; origin at the bottom
 * centre of the body, +X right, +Z toward the player, top surface at TOP.
 * Positions are [x, z] on the top surface for deck A; deck B mirrors x.
 */
/** Height of each pressable's cap top above the surface it sits on. */
export const PRESS_HEIGHT = { pad: 0.014, round: 0.016, small: 0.01, drop: 0.018, start: 0.02 };

export const BODY = { width: 0.62, depth: 0.32, top: 0.04 };
export const MIXER_HALF = 0.105;

export const DECK = {
  display: { x: -0.2, z: -0.128, width: 0.12, depth: 0.03 },
  sync: [-0.285, -0.128] as const,
  jog: { x: -0.2, z: -0.045, radius: 0.055 },
  tempo: { x: -0.285, z: -0.05, length: 0.1 },
  modes: [
    [-0.223, 0.035],
    [-0.185, 0.035],
    [-0.147, 0.035],
  ] as const,
  /** 2 rows × 4 pads; top row = drums, bass, chords, melody in STEMS mode */
  pads: { xs: [-0.242, -0.204, -0.166, -0.128], zs: [0.075, 0.113], size: 0.032 },
  cue: [-0.283, 0.075] as const,
  play: [-0.283, 0.122] as const,
};

/** Channel strip for deck A at x = -STRIP_X; deck B at +STRIP_X. */
export const STRIP_X = 0.07;
export const MIXER = {
  knobs: [
    { name: 'trim', z: -0.135, large: false },
    { name: 'hi', z: -0.103, large: false },
    { name: 'mid', z: -0.071, large: false },
    { name: 'low', z: -0.039, large: false },
    { name: 'filter', z: -0.002, large: true },
  ],
  fader: { z: 0.07, length: 0.08 },
  meter: { x: 0.044, z0: 0.11, z1: 0.032, segments: 12 },
  master: { xs: [-0.008, 0.008], z0: -0.085, z1: -0.145 },
  drop: [0, -0.035] as const,
  fx: [
    [-0.02, 0.035],
    [0.02, 0.035],
  ] as const,
  crossfader: { z: 0.14, length: 0.12 },
  ends: [-0.087, 0.087] as const,
};

/**
 * The crate shelf behind the deck displays (day 9): a 60 cm plate (narrower
 * than the 62 cm console, so nothing leaves its width) holding four track
 * slots, REC and SHARE. Each slot has a screen at the back (name, BPM, key)
 * and two load buttons (A, B) in front, nearest the player. Metres, in the
 * same console space as above.
 */
export const CRATE_LAYOUT = {
  width: 0.6,
  /** shelf front edge (overlaps the chassis a little) and back edge */
  z0: -0.155,
  z1: -0.248,
  slotXs: [-0.245, -0.12, 0.12, 0.245] as const,
  slotWidth: 0.116,
  screen: { z: -0.228, depth: 0.03 },
  /** load buttons: z, and x offset of the A and B buttons from the slot centre */
  buttonZ: -0.188,
  buttonDx: 0.028,
  /** REC and SHARE sit in the middle, status screen behind them */
  rec: [-0.02, -0.188] as const,
  share: [0.02, -0.188] as const,
  status: { x: 0, width: 0.09 },
};

/** Mirror a deck-A x onto deck B. */
export const deckX = (x: number, deck: 'A' | 'B') => (deck === 'A' ? x : -x);
