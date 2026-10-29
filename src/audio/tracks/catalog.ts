import { house } from '../generators/house.js';
import { lofi } from '../generators/lofi.js';
import { nuDisco } from '../generators/nudisco.js';
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
  bpm: 116,
  bpmRange: [108, 124],
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
  seed: 116,
};

export const TRACKS: Record<string, TrackDef> = {
  [WARM_START.id]: WARM_START,
  [CONCRETE.id]: CONCRETE,
  [MIRRORBALL.id]: MIRRORBALL,
  [RAINY_TAPE.id]: RAINY_TAPE,
};

/** The tracks in the crate, in shelf order (left to right). */
export const CRATE_ORDER: readonly string[] = [WARM_START.id, CONCRETE.id, MIRRORBALL.id, RAINY_TAPE.id];

export const GENERATORS: Partial<Record<Genre, Generator>> = { house, techno, 'nu-disco': nuDisco, lofi };

export function generatorFor(track: TrackDef): Generator {
  const generator = GENERATORS[track.genre];
  if (generator == null) throw new Error(`No generator for genre ${track.genre}`);
  return generator;
}
