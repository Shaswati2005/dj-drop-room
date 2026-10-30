import { describe, expect, it } from 'vitest';
import { FlashGuard, SHARP } from '../src/show/flash-guard.js';

/** Count sharp rises (>= SHARP in one frame) in the sliding window ending at each frame. */
function maxSharpPerSecond(levels: number[], fps: number): number {
  const times: number[] = [];
  let worst = 0;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] >= SHARP) times.push(i / fps);
    const t = i / fps;
    while (times.length > 0 && t - times[0] >= 1) times.shift();
    worst = Math.max(worst, times.length);
  }
  return worst;
}

describe('FlashGuard (strobe safety)', () => {
  const fps = 90;
  it('lets a normal beat-rate pulse (2 Hz) through untouched', () => {
    const guard = new FlashGuard(3);
    const out: number[] = [];
    for (let f = 0; f < fps * 6; f++) {
      const t = f / fps;
      const phase = (t * 2) % 1;
      out.push(guard.step(Math.exp(-phase * 5), t));
    }
    expect(Math.max(...out)).toBeGreaterThan(0.95);
    expect(maxSharpPerSecond(out, fps)).toBeLessThanOrEqual(3);
  });
  it('turns a 10 Hz strobe request into at most 3 sharp rises a second', () => {
    const guard = new FlashGuard(3);
    const out: number[] = [];
    for (let f = 0; f < fps * 6; f++) {
      const t = f / fps;
      out.push(guard.step(Math.floor(t * 20) % 2 === 0 ? 1 : 0, t));
    }
    expect(maxSharpPerSecond(out, fps)).toBeLessThanOrEqual(3);
  });
  it('a reduced limit of 1 per second holds too, and falls are instant', () => {
    const guard = new FlashGuard(1);
    const out: number[] = [];
    for (let f = 0; f < fps * 6; f++) {
      const t = f / fps;
      out.push(guard.step(Math.floor(t * 8) % 2 === 0 ? 1 : 0, t));
    }
    expect(maxSharpPerSecond(out, fps)).toBeLessThanOrEqual(1);
    const g = new FlashGuard(3);
    g.step(1, 0);
    expect(g.step(0, 0.01)).toBe(0);
  });
});
