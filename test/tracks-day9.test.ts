import { describe, expect, it } from 'vitest';
import { camelot, keysCompatible, mixesWith, tempoClose } from '../src/audio/camelot.js';
import { generatorFor, MIRRORBALL, RAINY_TAPE, TRACKS, CONCRETE, WARM_START } from '../src/audio/tracks/catalog.js';
import { sectionAt, trackBars } from '../src/audio/track-model.js';
import type { TrackDef } from '../src/audio/track-model.js';

describe('Camelot keys', () => {
  it('names the catalogue keys', () => {
    expect(camelot(WARM_START.key)).toBe('8A');
    expect(camelot(CONCRETE.key)).toBe('8A');
    expect(camelot(MIRRORBALL.key)).toBe('9A');
    expect(camelot(RAINY_TAPE.key)).toBe('8B');
    expect(camelot({ root: 3, mode: 'minor' })).toBe('2A');
    expect(camelot({ root: 5, mode: 'minor' })).toBe('4A');
    expect(camelot({ root: 7, mode: 'major' })).toBe('9B');
  });
  it('matches same number or adjacent number in the same mode', () => {
    expect(keysCompatible(WARM_START.key, MIRRORBALL.key)).toBe(true); // 8A / 9A
    expect(keysCompatible(WARM_START.key, RAINY_TAPE.key)).toBe(true); // 8A / 8B
    expect(keysCompatible(MIRRORBALL.key, RAINY_TAPE.key)).toBe(false); // 9A / 8B
    expect(keysCompatible({ root: 8, mode: 'minor' }, { root: 6, mode: 'minor' })).toBe(false);
  });
  it('wraps 12 to 1', () => {
    expect(keysCompatible({ root: 1, mode: 'minor' }, { root: 8, mode: 'minor' })).toBe(true); // 12A / 1A
  });
  it('tempo within 6 percent', () => {
    expect(tempoClose(124, 128)).toBe(true);
    expect(tempoClose(124, 116)).toBe(false);
    expect(mixesWith(MIRRORBALL, WARM_START)).toBe(true);
    expect(mixesWith(RAINY_TAPE, WARM_START)).toBe(false);
  });
});

describe.each([MIRRORBALL, RAINY_TAPE])('$name', (track: TrackDef) => {
  const generate = generatorFor(track);
  const bars = Array.from({ length: trackBars(track) }, (_, i) => sectionAt(track, i));
  it('is registered with a key and a tempo in range', () => {
    expect(TRACKS[track.id]).toBe(track);
    expect(track.bpm).toBeGreaterThanOrEqual(track.bpmRange[0]);
    expect(track.bpm).toBeLessThanOrEqual(track.bpmRange[1]);
  });
  it('has intro, build, drop, break and outro', () => {
    expect(new Set(track.form.map((p) => p.section))).toEqual(new Set(['intro', 'build', 'drop', 'break', 'outro']));
  });
  it('every drop bar starts on a kick; the break has no kick or bass', () => {
    for (const ctx of bars.filter((c) => c.section === 'drop')) {
      expect(generate(track, ctx).drums.some((e) => e.voice === 'kick' && e.step === 0)).toBe(true);
    }
    for (const ctx of bars.filter((c) => c.section === 'break')) {
      const p = generate(track, ctx);
      expect(p.drums.some((e) => e.voice === 'kick')).toBe(false);
      expect(p.bass).toHaveLength(0);
    }
  });
  it('the build ends in a 16-step snare roll', () => {
    const lastBuild = bars.findIndex((c) => c.section === 'drop') - 1;
    expect(generate(track, bars[lastBuild]).drums.filter((e) => e.voice === 'snare')).toHaveLength(16);
  });
  it('is deterministic, on the grid, and each synth gets its hits in strict time order', () => {
    for (const ctx of bars) {
      const a = generate(track, ctx);
      expect(generate(track, ctx)).toEqual(a);
      for (const [stem, events] of Object.entries(a)) {
        for (const e of events) {
          expect(e.step).toBeGreaterThanOrEqual(0);
          expect(e.step).toBeLessThan(16);
        }
        if (stem === 'drums') {
          for (const voice of ['kick', 'clap', 'snare', 'hat', 'openHat']) {
            const steps = events.filter((e) => e.voice === voice).map((e) => e.step);
            expect(steps).toEqual([...steps].sort((x, y) => x - y));
            expect(new Set(steps).size).toBe(steps.length);
          }
        } else {
          const steps = events.map((e) => e.step);
          expect(steps).toEqual([...steps].sort((x, y) => x - y));
        }
      }
    }
  });
});
