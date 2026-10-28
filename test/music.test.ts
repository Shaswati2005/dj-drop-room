import { describe, expect, it } from 'vitest';
import { house } from '../src/audio/generators/house.js';
import { dropTargetBar, nextBar, positionAtTicks } from '../src/audio/quantise.js';
import { WARM_START } from '../src/audio/tracks/catalog.js';
import { sectionAt } from '../src/audio/track-model.js';

describe('quantiser', () => {
  it('stem toggles land on the next bar', () => {
    expect(nextBar(7)).toBe(8);
  });
  it('DROP on beat 1-2 lands next bar, on beat 3-4 one later', () => {
    expect(dropTargetBar(10, 1)).toBe(11);
    expect(dropTargetBar(10, 2)).toBe(11);
    expect(dropTargetBar(10, 3)).toBe(12);
    expect(dropTargetBar(10, 4)).toBe(12);
  });
  it('maps transport ticks to bar/beat/step', () => {
    const out = { bar: 0, beat: 0, step: 0 };
    positionAtTicks(192 * 9 + 192 / 4, 192, out); // bar 2, beat 2, 2nd 16th
    expect(out).toEqual({ bar: 2, beat: 2, step: 5 });
  });
});

describe('Warm Start form', () => {
  it('walks the form and loops the outro', () => {
    expect(sectionAt(WARM_START, 0).section).toBe('intro');
    expect(sectionAt(WARM_START, 16).section).toBe('drop');
    const total = WARM_START.form.reduce((n, p) => n + p.bars, 0);
    expect(sectionAt(WARM_START, total + 3).section).toBe('outro');
    expect(sectionAt(WARM_START, 16 + 7).phraseBar).toBe(8);
  });
});

describe('house generator', () => {
  const total = WARM_START.form.reduce((n, p) => n + p.bars, 0);
  const bars = Array.from({ length: total }, (_, i) => sectionAt(WARM_START, i));

  it('every drop bar has a kick on step 0', () => {
    for (const ctx of bars.filter((c) => c.section === 'drop')) {
      expect(house(WARM_START, ctx).drums.some((e) => e.voice === 'kick' && e.step === 0)).toBe(true);
    }
  });
  it('the break has no kick and no bass', () => {
    for (const ctx of bars.filter((c) => c.section === 'break')) {
      const p = house(WARM_START, ctx);
      expect(p.drums.some((e) => e.voice === 'kick')).toBe(false);
      expect(p.bass).toHaveLength(0);
    }
  });
  it('the build ends in a snare roll', () => {
    const lastBuild = bars.findIndex((c) => c.section === 'drop') - 1;
    const snares = house(WARM_START, bars[lastBuild]).drums.filter((e) => e.voice === 'snare');
    expect(snares).toHaveLength(16);
  });
  it('is deterministic and stays on the 16-step grid', () => {
    for (const ctx of bars) {
      const a = house(WARM_START, ctx);
      expect(house(WARM_START, ctx)).toEqual(a);
      for (const stem of Object.values(a)) for (const e of stem) expect(e.step).toBeGreaterThanOrEqual(0);
      for (const stem of Object.values(a)) for (const e of stem) expect(e.step).toBeLessThan(16);
    }
  });
  it('bass follows the i-VI-III-VII roots of A minor', () => {
    const roots = [0, 1, 2, 3].map((bar) => house(WARM_START, sectionAt(WARM_START, bar)).bass[0].notes![0] % 12);
    expect(roots).toEqual([9, 5, 0, 7]); // A F C G
  });
});
