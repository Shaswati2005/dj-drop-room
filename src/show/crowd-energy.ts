import type { EngineState } from '../audio/engine.js';

/** Base energy per section of the deck the crowd is hearing. */
const SECTION_ENERGY: Record<string, number> = { intro: 0.3, build: 0.55, drop: 0.85, break: 0.4, outro: 0.3, '': 0.2 };
/** Seconds for energy to cover ~63 % of the way to its target. */
const RESPONSE = 2;
/** A landed drop lifts the crowd this much, fading over DROP_BARS. */
const DROP_BOOST = 0.25;
const DROP_BARS = 8;
/** Bars with nothing changed before the crowd gets bored, and by how much. */
const BORED_BARS = 32;
const BORED = 0.15;
/** Two basslines at once ("mud", PLAN §1.1 bass swap). */
const MUD = 0.12;
/** The resident crowd's floor fades out over this many seconds of playing. */
const RESIDENT_SECONDS = 45;

/**
 * How hyped the crowd is, 0..1: what they hear sets a target (section, how
 * many stems are in, a fresh drop, a clashing double bassline, boredom) and
 * the energy glides toward it. Pure logic, fed the engine state each frame.
 */
export class CrowdEnergy {
  /** what the crowd shows: the earned energy, held up by the resident floor early on */
  energy = 0.2;
  /** the energy the music has earned, without the resident floor (the beams follow this) */
  earned = 0.2;
  /** the come-back kit's resident crowd (PLAN §5.5): arrives at your best tier, fades into the real thing */
  resident = 0;
  private ranFor = 0;
  /** what the energy is heading for, for tests */
  target = 0.2;
  private lastChangeTime = 0;
  private lastSignature = -1;
  private lastDrops = 0;

  update(s: EngineState, dt: number): number {
    if (!s.running) {
      this.energy = Math.max(this.earned, this.resident);
      return this.energy;
    }
    this.ranFor += dt;
    const now = s.heard;
    const bar = 240 / s.bpm;
    const deck = s[s.master];
    let target = SECTION_ENERGY[deck.section] ?? 0.3;
    // fewer stems, less to dance to
    const stems = deck.stems[0] + deck.stems[1] + deck.stems[2] + deck.stems[3];
    target *= 0.55 + 0.45 * (stems / 4);
    // a new set (Play again) starts the drop count over
    if (s.drops < this.lastDrops) {
      this.lastDrops = s.drops;
      this.earned = 0.2;
      this.lastChangeTime = now;
    }
    if (s.drops > this.lastDrops) {
      this.lastDrops = s.drops;
      this.lastChangeTime = now;
    }
    if (s.drops > 0) {
      const since = now - s.dropAt;
      if (since >= 0 && since < DROP_BARS * bar) target += DROP_BOOST * (1 - since / (DROP_BARS * bar));
    }
    if (this.mud(s)) target -= MUD;
    // any change the DJ makes (stems, decks, crossfader side, FX) resets boredom
    const signature = this.signature(s);
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.lastChangeTime = now;
    }
    if (now - this.lastChangeTime > BORED_BARS * bar) target -= BORED;
    this.target = Math.max(0, Math.min(1, target));
    this.earned += (this.target - this.earned) * (1 - Math.exp(-dt / RESPONSE));
    this.energy = Math.max(this.earned, this.resident * Math.max(0, 1 - this.ranFor / RESIDENT_SECONDS));
    return this.energy;
  }

  /** Both decks heard with their bass in. */
  private mud(s: EngineState): boolean {
    return s.A.playing && s.B.playing && s.A.stems[1] === 1 && s.B.stems[1] === 1 && Math.abs(s.crossfader) < 0.5 && s.A.fader > 0.3 && s.B.fader > 0.3 && !s.A.kills[2] && !s.B.kills[2];
  }

  /** The DJ-controlled state packed into one number (allocation-free). */
  private signature(s: EngineState): number {
    let bits = 0;
    for (let i = 0; i < 4; i++) bits = (bits << 2) | (s.A.stems[i] << 1) | s.B.stems[i];
    bits = (bits << 4) | (+s.A.playing << 3) | (+s.B.playing << 2) | (+s.echo << 1) | +s.space;
    bits = bits * 9 + Math.round(s.crossfader * 4) + 4;
    return bits * 81 + s.A.loopBars * 9 + s.B.loopBars;
  }
}
