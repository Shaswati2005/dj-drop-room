import { describe, expect, it } from 'vitest';
import { echoDelaySeconds, echoTailSeconds, FX_PEAK, FX_RELEASE, fxSendAt, nextEighthAt } from '../src/audio/quantise.js';

describe('beat FX quantise (PLAN 3.9)', () => {
  const bpm = 124;
  const beat = 60 / bpm;
  const eighth = beat / 2;
  const bar = 4 * beat;

  it('starts on the next 1/8 note line before the next bar', () => {
    // a bar line at t = 10; pressing 0.3 eighths before the third line lands on that line
    const nextBar = 10;
    const line = nextBar - 3 * eighth;
    expect(nextEighthAt(line - 0.3 * eighth, nextBar, eighth)).toBeCloseTo(line, 9);
    expect(nextEighthAt(line + 0.01, nextBar, eighth)).toBeCloseTo(line + eighth, 9);
  });
  it('never starts in the past, and at most one 1/8 (plus the guard) away', () => {
    for (let k = 0; k < 200; k++) {
      const now = 10 - bar + (k / 200) * bar * 0.999;
      const at = nextEighthAt(now, 10, eighth);
      expect(at).toBeGreaterThan(now);
      expect(at - now).toBeLessThanOrEqual(eighth + 0.02 + 1e-9);
    }
  });
  it('a press just before a line waits for the following one (guard)', () => {
    expect(nextEighthAt(10 - eighth - 0.005, 10, eighth)).toBeCloseTo(10, 9);
  });
});

describe('beat FX send envelope', () => {
  const ramp = (4 * 60) / 124;
  it('is 0 before the start, rises to 0.6 while held', () => {
    expect(fxSendAt(0.9, 1, ramp)).toBe(0);
    expect(fxSendAt(1 + ramp / 2, 1, ramp)).toBeCloseTo(FX_PEAK / 2, 9);
    expect(fxSendAt(1 + ramp * 3, 1, ramp)).toBeCloseTo(FX_PEAK, 9);
  });
  it('shuts quickly on release, from wherever it had reached', () => {
    const release = 1 + ramp / 2;
    expect(fxSendAt(release, 1, ramp, release)).toBeCloseTo(FX_PEAK / 2, 9);
    expect(fxSendAt(release + FX_RELEASE / 2, 1, ramp, release)).toBeCloseTo(FX_PEAK / 4, 9);
    expect(fxSendAt(release + FX_RELEASE, 1, ramp, release)).toBe(0);
  });
  it('a release before the start never lets the send rise', () => {
    expect(fxSendAt(3, 2, ramp, 1.5)).toBe(0);
  });
});

describe('echo tail', () => {
  it('uses a dotted 1/8 delay', () => {
    expect(echoDelaySeconds(120)).toBeCloseTo(0.375, 9);
  });
  it('rings roughly 2 bars after release at house tempo (60 dB down)', () => {
    const bar = 240 / 124;
    const tail = echoTailSeconds(124);
    expect(tail / bar).toBeGreaterThan(1.5);
    expect(tail / bar).toBeLessThan(2.8);
  });
});
