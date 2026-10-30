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

/** How a track's tempo relates to a reference deck's (PLAN §3.6, §3.8):
 * `lock` within ±6 %, `double` / `half` when the track is within ±6 % of
 * twice / half the reference (drum & bass over lo-fi), otherwise `glide`
 * (the tempo would have to shift). */
export type TempoRelation = 'lock' | 'double' | 'half' | 'glide';

export function tempoRelation(reference: number, track: number): TempoRelation {
  if (tempoClose(reference, track)) return 'lock';
  if (tempoClose(reference * 2, track)) return 'double';
  if (tempoClose(reference / 2, track)) return 'half';
  return 'glide';
}

/** Multiplier on the reference tempo that SYNC aims for: 2 or 0.5 for a
 * double / half-time pair, else 1. */
export function syncFactor(reference: number, track: number): number {
  const relation = tempoRelation(reference, track);
  return relation === 'double' ? 2 : relation === 'half' ? 0.5 : 1;
}

/** Crate badge (PLAN §3.8): green = key and tempo fit; amber = tempo fits
 * (locked, or at half/double time) but the keys clash, or the keys fit at
 * half/double time; grey = the tempo would have to glide. */
export type Badge = 'green' | 'amber' | 'grey';

export function badgeFor(track: TrackDef, reference: TrackDef): Badge {
  const relation = tempoRelation(reference.bpm, track.bpm);
  const keys = keysCompatible(track.key, reference.key);
  if (relation === 'glide') return 'grey';
  if (relation === 'lock') return keys ? 'green' : 'amber';
  return 'amber';
}
