/**
 * Strobe safety (PLAN 4.2, 5.2): the brightness the light show asks for passes
 * through here, and a sharp rise (a jump of `SHARP` or more in one step) is
 * allowed at most `maxPerSecond` times in any second, 3 being the photosensitive
 * limit. A rise that is not allowed is slewed in smoothly instead, so a flurry
 * of requests (re-drops, a fast tempo) becomes a glow, never a strobe. Falls
 * are never limited. Pure logic, no allocation after construction.
 */
export const SHARP = 0.25;
/** The slowest allowed way up when a sharp rise is refused (levels per second). */
export const SLEW = 1.5;

export const MAX_LIMIT = 3;

export class FlashGuard {
  level = 0;
  /** how many sharp rises were let through, for tests */
  sharp = 0;
  /** times of the last sharp rises, newest first */
  private readonly times = new Float64Array(MAX_LIMIT).fill(-Infinity);
  private lastT = -Infinity;

  /** `limit` sharp rises per second at most (1..3); can be changed at any time, history is kept */
  constructor(public limit = MAX_LIMIT) {}

  /** The level to show at time `t` (seconds) when `target` is wanted. */
  step(target: number, t: number): number {
    const dt = Math.max(0, Math.min(0.25, t - this.lastT));
    this.lastT = t;
    let next = target;
    if (target - this.level >= SHARP) {
      // the `limit`-th most recent sharp rise must be over a second old
      if (t - this.times[Math.max(1, Math.min(MAX_LIMIT, this.limit)) - 1] >= 1) {
        for (let k = MAX_LIMIT - 1; k > 0; k--) this.times[k] = this.times[k - 1];
        this.times[0] = t;
        this.sharp++;
      } else {
        next = Math.min(target, this.level + SLEW * dt);
      }
    }
    this.level = next;
    return next;
  }
}
