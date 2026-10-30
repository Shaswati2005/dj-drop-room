import { house } from './house.js';
import { makeRng } from '../track-model.js';
import type { BarContext, BarPattern, StepEvent, TrackDef } from '../track-model.js';

/** Sunrise (PLAN §3.10 track 10): the house generator in a major key (I–V–vi–IV)
 * with a brighter, bouncier arrangement: sustained pad chords under the stabs,
 * 16th shaker hats in the drops and a singing pentatonic hook that climbs each
 * phrase. The closer. */
const hit = (step: number, velocity: number, voice: StepEvent['voice'], length = 1): StepEvent => ({ step, length, velocity, voice });

export function sunrise(track: TrackDef, ctx: BarContext): BarPattern {
  const base = house(track, ctx);
  const drums = [...base.drums];
  if (ctx.section === 'drop') {
    for (const s of [1, 5, 9, 13]) drums.push(hit(s, 0.2, 'hat'));
  }
  // one hit per voice per step, in time order
  const best = new Map<string, StepEvent>();
  for (const e of drums) {
    const key = `${e.voice}:${e.step}`;
    if ((best.get(key)?.velocity ?? -1) < e.velocity) best.set(key, e);
  }
  const sortedDrums = [...best.values()].sort((a, b) => a.step - b.step);

  // pad: the stab chord held a bar underneath, from the build on
  const chords = [...base.chords];
  if ((ctx.section === 'drop' || ctx.section === 'build') && chords.length > 0) {
    const notes = chords[0].notes!.map((n) => n - 12);
    chords.unshift({ step: 0, length: 14, velocity: 0.22, notes });
    chords.sort((a, b) => a.step - b.step);
  }
  // hook: fills the gaps of the base motif with a rising line on the phrase's last half
  const melody = [...base.melody];
  if (ctx.section === 'drop' && ctx.phraseBar > 4) {
    const rng = makeRng(track.seed * 13 + ctx.trackBar);
    const taken = new Set(melody.map((e) => e.step));
    for (const s of [3, 7, 11]) {
      if (taken.has(s) || taken.has(s - 1) || rng() > 0.7) continue;
      melody.push({ step: s, length: 1, velocity: 0.45, notes: [72 + track.key.root + [0, 2, 4, 7, 9][Math.floor(rng() * 5)] + (ctx.phraseBar > 6 ? 12 : 0)] });
    }
    melody.sort((a, b) => a.step - b.step);
  }
  // a mono synth needs its notes in time order
  const bass = [...base.bass].sort((a, b) => a.step - b.step);
  return { drums: sortedDrums, bass, chords, melody };
}
