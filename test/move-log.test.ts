import { describe, expect, it } from 'vitest';
import { BUCKET_CS, decodeMoves, encodeMoves, MoveLog, setFromHash } from '../src/audio/move-log.js';

describe('move log', () => {
  it('stamps moves in centiseconds since the set start', () => {
    const log = new MoveLog();
    log.record(5, 'p', 0); // before the set: ignored
    log.begin(10);
    log.record(10.5, 'p', 0);
    log.record(12.345, 'T', 1, 2);
    expect(log.moves).toEqual([[50, 'p', 0], [235, 'T', 1, 2]]);
  });
  it('merges samples of one drag into buckets, keeping the last value', () => {
    const log = new MoveLog();
    log.begin(0);
    for (let i = 0; i < 100; i++) log.record(i * 0.011, 'k', 0, 3, i); // 1.1 s of drag at 90 Hz
    expect(log.moves.length).toBeLessThanOrEqual(Math.ceil(110 / BUCKET_CS) + 1);
    expect(log.moves[log.moves.length - 1][4]).toBe(99);
    // a different knob is never merged
    log.record(1.1, 'k', 0, 2, 5);
    expect(log.moves[log.moves.length - 1].slice(2)).toEqual([0, 2, 5]);
  });
  it('never merges discrete actions', () => {
    const log = new MoveLog();
    log.begin(0);
    log.record(1, 'T', 0, 1);
    log.record(1.01, 'T', 0, 1);
    expect(log.moves).toHaveLength(2);
  });
});

describe('set link encoding', () => {
  const moves = Array.from({ length: 300 }, (_, i) => [i * 40, i % 3 ? 'k' : 'T', i % 2, i % 5, (i * 7) % 200 - 100] as [number, string, number, number, number]);
  it('round-trips and is URL safe and compact', async () => {
    const text = await encodeMoves(moves);
    expect(text).toMatch(/^[zj][A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThan(JSON.stringify(moves).length);
    expect(await decodeMoves(text)).toEqual(moves);
  });
  it('rejects junk', async () => {
    await expect(decodeMoves('xabc')).rejects.toThrow();
    await expect(decodeMoves('zAAAA')).rejects.toThrow();
  });
  it('finds the set in a hash', () => {
    expect(setFromHash('#set=zAb-_9')).toBe('zAb-_9');
    expect(setFromHash('#a=1&set=jXY')).toBe('jXY');
    expect(setFromHash('')).toBeNull();
  });
});
