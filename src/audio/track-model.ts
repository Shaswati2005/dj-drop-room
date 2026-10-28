/** Pure data types for tracks and generated patterns. No Tone.js imports here,
 * so generators and their tests run in plain Node. */

export type Stem = 'drums' | 'bass' | 'chords' | 'melody';
export const STEMS: readonly Stem[] = ['drums', 'bass', 'chords', 'melody'];

export type Section = 'intro' | 'build' | 'drop' | 'break' | 'outro';
export type Genre = 'house' | 'techno' | 'nu-disco' | 'lofi' | 'dnb';

export interface TrackDef {
  id: string;
  name: string;
  genre: Genre;
  mood: string;
  bpm: number;
  bpmRange: [number, number];
  /** root pitch class (0 = C) and mode */
  key: { root: number; mode: 'minor' | 'major' };
  energy: number;
  /** fraction of a 16th that odd steps are delayed by */
  swing: number;
  form: readonly { section: Section; bars: number }[];
  seed: number;
}

export type DrumVoice = 'kick' | 'clap' | 'snare' | 'hat' | 'openHat';

/** One hit on the 16-step grid of a bar. */
export interface StepEvent {
  step: number;
  /** length in 16th steps */
  length: number;
  velocity: number;
  /** drum events only */
  voice?: DrumVoice;
  /** pitched events only: MIDI note numbers */
  notes?: readonly number[];
}

export interface BarContext {
  section: Section;
  barInSection: number;
  sectionBars: number;
  /** 1..8 within the current 8-bar phrase */
  phraseBar: number;
  /** bars since the track started */
  trackBar: number;
}

export type BarPattern = Record<Stem, StepEvent[]>;
export type Generator = (track: TrackDef, ctx: BarContext) => BarPattern;

export const STEPS_PER_BAR = 16;

/** Where a track is at a given bar. Past the end, the last section (outro) loops. */
export function sectionAt(track: TrackDef, trackBar: number): BarContext {
  let start = 0;
  for (const part of track.form) {
    if (trackBar < start + part.bars) {
      return {
        section: part.section,
        barInSection: trackBar - start,
        sectionBars: part.bars,
        phraseBar: ((trackBar - start) % 8) + 1,
        trackBar,
      };
    }
    start += part.bars;
  }
  const last = track.form[track.form.length - 1];
  const inLast = (trackBar - start) % last.bars;
  return {
    section: last.section,
    barInSection: inLast,
    sectionBars: last.bars,
    phraseBar: (inLast % 8) + 1,
    trackBar,
  };
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Small deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
