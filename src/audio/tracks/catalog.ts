import { dnb } from '../generators/dnb.js';
import { house } from '../generators/house.js';
import { lofi } from '../generators/lofi.js';
import { nuDisco } from '../generators/nudisco.js';
import { sunrise } from '../generators/sunrise.js';
import { techno } from '../generators/techno.js';
import type { Generator, Genre, TrackDef } from '../track-model.js';

export const WARM_START: TrackDef = {
  id: 'warm-start',
  name: 'Warm Start',
  genre: 'house',
  mood: 'friendly opener, plays on arrival',
  bpm: 124,
  bpmRange: [114, 134],
  key: { root: 9, mode: 'minor' }, // A minor, 8A
  energy: 3,
  swing: 0.08,
  form: [
    { section: 'intro', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'break', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'outro', bars: 8 },
  ],
  seed: 124,
};

export const CONCRETE: TrackDef = {
  id: 'concrete',
  name: 'Concrete',
  genre: 'techno',
  mood: 'dark, driving',
  bpm: 128,
  bpmRange: [120, 136],
  key: { root: 9, mode: 'minor' }, // A minor, 8A: mixes in key with Warm Start
  energy: 4,
  swing: 0,
  form: [
    { section: 'intro', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'break', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'outro', bars: 8 },
  ],
  seed: 128,
};

export const MIRRORBALL: TrackDef = {
  id: 'mirrorball',
  name: 'Mirrorball',
  genre: 'nu-disco',
  mood: 'shimmering disco groove',
  bpm: 120,
  bpmRange: [112, 128],
  key: { root: 4, mode: 'minor' }, // E minor, 9A: one step from Warm Start
  energy: 4,
  swing: 0.05,
  form: [
    { section: 'intro', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'break', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'outro', bars: 8 },
  ],
  seed: 120,
};

export const RAINY_TAPE: TrackDef = {
  id: 'rainy-tape',
  name: 'Rainy Tape',
  genre: 'lofi',
  mood: 'hazy, warm, laid back',
  bpm: 86,
  bpmRange: [80, 92],
  key: { root: 0, mode: 'major' }, // C major, 8B: the relative major of Warm Start
  energy: 2,
  swing: 0.28,
  form: [
    { section: 'intro', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'break', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'outro', bars: 8 },
  ],
  seed: 86,
};

export const AIRLOCK: TrackDef = {
  id: 'airlock',
  name: 'Airlock',
  genre: 'dnb',
  mood: 'peak-time, rides at double time over Rainy Tape',
  bpm: 172,
  bpmRange: [160, 184],
  key: { root: 4, mode: 'minor' }, // E minor, 9A
  energy: 5,
  swing: 0,
  form: [
    { section: 'intro', bars: 16 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 24 },
    { section: 'break', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 24 },
    { section: 'outro', bars: 16 },
  ],
  seed: 172,
};

export const SUNRISE: TrackDef = {
  id: 'sunrise',
  name: 'Sunrise',
  genre: 'house',
  mood: 'bright, uplifting closer',
  bpm: 124,
  bpmRange: [114, 134],
  key: { root: 0, mode: 'major' }, // C major, 8B: the relative major of Warm Start
  energy: 4,
  swing: 0.06,
  form: [
    { section: 'intro', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'break', bars: 8 },
    { section: 'build', bars: 8 },
    { section: 'drop', bars: 16 },
    { section: 'outro', bars: 8 },
  ],
  seed: 1224,
};

export const TRACKS: Record<string, TrackDef> = {
  [WARM_START.id]: WARM_START,
  [CONCRETE.id]: CONCRETE,
  [MIRRORBALL.id]: MIRRORBALL,
  [RAINY_TAPE.id]: RAINY_TAPE,
  [AIRLOCK.id]: AIRLOCK,
  [SUNRISE.id]: SUNRISE,
};

/** The tracks in the crate, in shelf order (left to right). */
export const CRATE_ORDER: readonly string[] = [WARM_START.id, CONCRETE.id, MIRRORBALL.id, RAINY_TAPE.id, AIRLOCK.id, SUNRISE.id];

export const GENERATORS: Partial<Record<Genre, Generator>> = { house, techno, 'nu-disco': nuDisco, lofi, dnb };

/** Tracks with their own arrangement of a genre's generator. */
const BY_TRACK: Record<string, Generator> = { sunrise };

export function generatorFor(track: TrackDef): Generator {
  const generator = BY_TRACK[track.id] ?? GENERATORS[track.genre];
  if (generator == null) throw new Error(`No generator for genre ${track.genre}`);
  return generator;
}
