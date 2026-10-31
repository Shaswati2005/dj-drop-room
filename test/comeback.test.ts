import { describe, expect, it } from 'vitest';
import {
  BEST_KEY,
  dateSeed,
  DEFAULT_SETTINGS,
  isBetter,
  loadBest,
  loadSettings,
  makeSummary,
  nightlyRequest,
  REQUEST_GENRES,
  RequestTracker,
  residentEnergy,
  saveBest,
  saveSettings,
  SETTINGS_KEY,
  stepSetting,
} from '../src/game/comeback';

/** A Storage stand-in. */
function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}
const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
} as unknown as Storage;

describe('settings storage', () => {
  it('round-trips and clamps', () => {
    const s = memory();
    expect(saveSettings({ volume: 0.4, dim: 0.7, reducedFlash: true }, s)).toBe(true);
    expect(loadSettings(s)).toEqual({ volume: 0.4, dim: 0.7, reducedFlash: true });
    expect(loadSettings(memory({ [SETTINGS_KEY]: '{"volume":9,"dim":-3}' }))).toEqual({ volume: 1, dim: 0, reducedFlash: false });
  });

  it('survives garbage and blocked storage', () => {
    expect(loadSettings(memory({ [SETTINGS_KEY]: 'not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, broken)).toBe(false);
    expect(loadBest(broken)).toBeNull();
    expect(saveBest({ peakHype: 5, timeOnFire: 0, date: 'x' }, broken)).toBe(false);
  });

  it('steps in tenths without drifting, clamped', () => {
    let v = 1;
    for (let i = 0; i < 4; i++) v = stepSetting(v, -1);
    expect(v).toBe(0.6);
    for (let i = 0; i < 20; i++) v = stepSetting(v, -1);
    expect(v).toBe(0);
    for (let i = 0; i < 20; i++) v = stepSetting(v, 1);
    expect(v).toBe(1);
  });
});

describe('best set', () => {
  it('round-trips', () => {
    const s = memory();
    saveBest({ peakHype: 83, timeOnFire: 41, date: '2026-11-02' }, s);
    expect(loadBest(s)).toEqual({ peakHype: 83, timeOnFire: 41, date: '2026-11-02' });
    expect(loadBest(memory({ [BEST_KEY]: '{"timeOnFire":3}' }))).toBeNull();
  });

  it('is beaten by a higher peak, or the same peak with more time on fire', () => {
    const best = { peakHype: 80, timeOnFire: 30, date: 'a' };
    expect(isBetter({ peakHype: 81, timeOnFire: 0, date: 'b' }, best)).toBe(true);
    expect(isBetter({ peakHype: 80, timeOnFire: 31, date: 'b' }, best)).toBe(true);
    expect(isBetter({ peakHype: 80, timeOnFire: 30, date: 'b' }, best)).toBe(false);
    expect(isBetter({ peakHype: 60, timeOnFire: 99, date: 'b' }, best)).toBe(false);
    expect(isBetter({ peakHype: 20, timeOnFire: 0, date: 'b' }, null)).toBe(true);
  });

  it('summarises with and without a previous best', () => {
    const first = makeSummary(72.4, 12.2, 'DROP', null, new Date(2026, 10, 2));
    expect(first.summary.newBest).toBe(true);
    expect(first.best).toEqual({ peakHype: 72, timeOnFire: 12, date: '2026-11-02' });
    const worse = makeSummary(50, 0, 'DROP', first.best, new Date(2026, 10, 3));
    expect(worse.summary.newBest).toBe(false);
    expect(worse.best).toEqual(first.best);
    expect(worse.summary.previous).toEqual(first.best);
  });

  it('seeds the resident crowd from the best tier', () => {
    expect(residentEnergy(null)).toBe(0);
    expect(residentEnergy({ peakHype: 20, timeOnFire: 0, date: '' })).toBe(0);
    expect(residentEnergy({ peakHype: 60, timeOnFire: 0, date: '' })).toBeGreaterThan(0.5);
    expect(residentEnergy({ peakHype: 95, timeOnFire: 0, date: '' })).toBeGreaterThanOrEqual(0.75);
  });
});

describe('nightly request', () => {
  it('is the same all day and local-date seeded', () => {
    const morning = nightlyRequest(new Date(2026, 10, 2, 8, 0));
    const night = nightlyRequest(new Date(2026, 10, 2, 23, 59));
    expect(morning).toEqual(night);
    expect(morning.seed).toBe(20261102);
    expect(dateSeed(new Date(2026, 0, 5))).toBe(20260105);
    expect(REQUEST_GENRES).toContain(morning.genre);
    expect(morning.text).toContain('Tonight:');
  });

  it('changes with the date: a month shows several genres and goals', () => {
    const genres = new Set<string>();
    const goals = new Set<string>();
    const texts = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      const r = nightlyRequest(new Date(2026, 10, day));
      genres.add(r.genre);
      goals.add(r.goal.id);
      texts.add(r.text);
    }
    expect(genres.size).toBeGreaterThanOrEqual(3);
    expect(goals.size).toBeGreaterThanOrEqual(2);
    expect(texts.size).toBeGreaterThanOrEqual(8);
  });

  it('uses a stubbed Date for the default clock', () => {
    const RealDate = Date;
    try {
      globalThis.Date = class extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date>) {
          super(...(args.length ? args : [2026, 11, 24]));
        }
      } as DateConstructor;
      expect(nightlyRequest(new Date()).seed).toBe(20261224);
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it('is fulfilled by consecutive bars at the goal tier in the requested genre', () => {
    const request = { seed: 1, genre: 'techno' as const, goal: { id: 't', minTier: 2, bars: 16, text: '' }, text: '' };
    const t = new RequestTracker(request);
    let done = false;
    for (let i = 0; i < 15 * 4; i++) done ||= t.update(0.25, 2, 'techno');
    expect(done).toBe(false);
    // the wrong genre or a cold crowd starts the count over
    t.update(0.25, 2, 'house');
    expect(t.progress).toBe(0);
    for (let i = 0; i < 15 * 4; i++) t.update(0.25, 3, 'techno');
    t.update(0.25, 1, 'techno');
    expect(t.progress).toBe(0);
    for (let i = 0; i < 16 * 4 - 1; i++) expect(t.update(0.25, 2, 'techno')).toBe(false);
    expect(t.update(0.25, 3, 'techno')).toBe(true);
    expect(t.done).toBe(true);
    // fulfilled once
    expect(t.update(5, 3, 'techno')).toBe(false);
  });
});
