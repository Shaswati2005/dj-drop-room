import { describe, expect, it } from 'vitest';
import { badgeFor, camelot, keysCompatible, syncFactor, tempoRelation } from '../src/audio/camelot.js';
import { AIRLOCK, CRATE_ORDER, MIRRORBALL, RAINY_TAPE, SUNRISE, TRACKS, WARM_START, CONCRETE } from '../src/audio/tracks/catalog.js';

describe('tracks 5 and 6', () => {
  it('Airlock is 172 BPM drum & bass in E minor (9A), energy 5', () => {
    expect(AIRLOCK.bpm).toBe(172);
    expect(AIRLOCK.genre).toBe('dnb');
    expect(camelot(AIRLOCK.key)).toBe('9A');
    expect(AIRLOCK.energy).toBe(5);
  });
  it('Sunrise is 124 BPM house in C major (8B), energy 4', () => {
    expect(SUNRISE.bpm).toBe(124);
    expect(camelot(SUNRISE.key)).toBe('8B');
    expect(SUNRISE.energy).toBe(4);
  });
  it('the crate has six slots in order', () => {
    expect(CRATE_ORDER).toEqual(['warm-start', 'concrete', 'mirrorball', 'rainy-tape', 'airlock', 'sunrise']);
    expect(CRATE_ORDER.every((id) => TRACKS[id] != null)).toBe(true);
  });
  it('every form is whole 8-bar phrases', () => {
    for (const t of [AIRLOCK, SUNRISE]) for (const part of t.form) expect(part.bars % 8).toBe(0);
  });
});

describe('tempo relations (PLAN 3.6)', () => {
  it('Airlock rides at 2x over Rainy Tape (86 BPM)', () => {
    expect(RAINY_TAPE.bpm).toBe(86);
    expect(tempoRelation(RAINY_TAPE.bpm, AIRLOCK.bpm)).toBe('double');
    expect(tempoRelation(AIRLOCK.bpm, RAINY_TAPE.bpm)).toBe('half');
    expect(syncFactor(RAINY_TAPE.bpm, AIRLOCK.bpm)).toBe(2);
    expect(syncFactor(AIRLOCK.bpm, RAINY_TAPE.bpm)).toBe(0.5);
  });
  it('118-128 tracks lock to each other; Rainy Tape against them glides', () => {
    for (const a of [WARM_START, CONCRETE, MIRRORBALL, SUNRISE]) {
      expect(tempoRelation(SUNRISE.bpm, a.bpm)).toBe('lock');
      expect(tempoRelation(a.bpm, RAINY_TAPE.bpm)).toBe('glide');
    }
  });
  it('Airlock against a 124 deck glides (172 is not 2x or 1x of 124)', () => {
    expect(tempoRelation(WARM_START.bpm, AIRLOCK.bpm)).toBe('glide');
  });
  it('sync aims for the right tempo: Airlock on Rainy Tape plays at its own 172', () => {
    const rate = (RAINY_TAPE.bpm * syncFactor(RAINY_TAPE.bpm, AIRLOCK.bpm)) / AIRLOCK.bpm;
    expect(rate).toBeCloseTo(1, 5);
  });
});

describe('crate badges (PLAN 3.8)', () => {
  it('Sunrise over Warm Start: green (8B / 8A, same tempo)', () => {
    expect(keysCompatible(SUNRISE.key, WARM_START.key)).toBe(true);
    expect(badgeFor(SUNRISE, WARM_START)).toBe('green');
  });
  it('Airlock over Rainy Tape: amber (2x tempo lock; 9A against 8B clashes)', () => {
    expect(badgeFor(AIRLOCK, RAINY_TAPE)).toBe('amber');
  });
  it('anything against a tempo it cannot lock to is grey', () => {
    expect(badgeFor(RAINY_TAPE, WARM_START)).toBe('grey');
    expect(badgeFor(AIRLOCK, WARM_START)).toBe('grey');
  });
  it('Mirrorball over Warm Start is green', () => {
    expect(badgeFor(MIRRORBALL, WARM_START)).toBe('green');
  });
});
