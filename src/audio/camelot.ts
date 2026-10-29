import type { TrackDef } from './track-model.js';

/** Camelot wheel code of a key, e.g. A minor = "8A", C major = "8B"
 * (minor keys are A, major keys B). Pure maths, no audio imports. */
export function camelot(key: TrackDef['key']): string {
  // the relative minor of a major key is 3 semitones (9 up) below its root
  const minorRoot = key.mode === 'minor' ? key.root : (key.root + 9) % 12;
  const number = (((minorRoot * 7) % 12) + 5) % 12 || 12;
  return `${number}${key.mode === 'minor' ? 'A' : 'B'}`;
}

/** Same Camelot number, or the same letter one step round the wheel. */
export function keysCompatible(a: TrackDef['key'], b: TrackDef['key']): boolean {
  const ca = camelot(a);
  const cb = camelot(b);
  const na = parseInt(ca, 10);
  const nb = parseInt(cb, 10);
  if (na === nb) return true;
  const step = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  return step === 1 && ca.slice(-1) === cb.slice(-1);
}

/** Tempos within ±6 % of each other (relative to `a`). */
export function tempoClose(a: number, b: number): boolean {
  return Math.abs(b - a) / a <= 0.06 + 1e-9;
}

/** A track suits a reference track when both its key and tempo fit. */
export function mixesWith(track: TrackDef, reference: TrackDef): boolean {
  return keysCompatible(track.key, reference.key) && tempoClose(reference.bpm, track.bpm);
}
