import { house } from '../generators/house.js';
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

export const TRACKS: Record<string, TrackDef> = {
  [WARM_START.id]: WARM_START,
};

export const GENERATORS: Partial<Record<Genre, Generator>> = { house };

export function generatorFor(track: TrackDef): Generator {
  const generator = GENERATORS[track.genre];
  if (generator == null) throw new Error(`No generator for genre ${track.genre}`);
  return generator;
}
