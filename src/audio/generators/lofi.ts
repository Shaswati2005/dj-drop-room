import { makeRng } from '../track-model.js';
import type { BarContext, BarPattern, StepEvent, TrackDef } from '../track-model.js';

/** Lo-fi house (Rainy Tape): a soft four-on-the-floor kick, lazy swung hats,
 * a snare on 2 and 4, a sub bass that sits behind the beat, jazzy seventh
 * chords held long and a sparse, wandering pentatonic line. Progression (above
 * the key root): Imaj7 – vi7 – ii7 – V7. */
const CHORDS = [
  { root: 0, third: 4, seventh: 11 }, // Cmaj7
  { root: 9, third: 3, seventh: 10 }, // Am7
  { root: 2, third: 3, seventh: 10 }, // Dm7
  { root: 7, third: 4, seventh: 10 }, // G7
];
const PENTATONIC = [0, 2, 4, 7, 9];
const QUARTERS = [0, 4, 8, 12];

const hit = (step: number, velocity: number, voice: StepEvent['voice'], length = 1): StepEvent => ({ step, length, velocity, voice });

function drums(ctx: BarContext): StepEvent[] {
  const out: StepEvent[] = [];
  const { section, barInSection, sectionBars, phraseBar } = ctx;
  const lastBars = sectionBars - barInSection;
  if (section !== 'break') for (const s of QUARTERS) out.push(hit(s, section === 'drop' ? 0.95 : 0.8, 'kick'));
  if (section !== 'intro' || barInSection >= 4) out.push(hit(4, 0.6, 'snare'), hit(12, 0.6, 'snare'));
  if (section === 'drop' || section === 'outro') {
    for (let s = 0; s < 16; s += 2) out.push(hit(s, s % 4 === 2 ? 0.34 : 0.2, 'hat'));
    out.push(hit(14, 0.35, 'openHat'));
    if (phraseBar === 8) out.push(hit(15, 0.55, 'snare'));
  } else if (section === 'build') {
    for (let s = 0; s < 16; s += 2) out.push(hit(s, 0.24, 'hat'));
    if (lastBars === 2) for (let s = 0; s < 16; s += 2) out.push(hit(s, 0.3 + s * 0.015, 'snare'));
    if (lastBars === 1) for (let s = 0; s < 16; s++) out.push(hit(s, 0.36 + s * 0.035, 'snare'));
  } else {
    for (const s of [2, 10]) out.push(hit(s, 0.2, 'hat'));
  }
  // each drum voice is one synth: it needs its hits in time order, one per step
  const best = new Map<string, StepEvent>();
  for (const e of out) {
    const key = e.voice + ":" + e.step;
    if ((best.get(key)?.velocity ?? -1) < e.velocity) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => a.step - b.step);
}

function chordAt(track: TrackDef, trackBar: number) {
  const c = CHORDS[trackBar % 4];
  return { ...c, pc: (track.key.root + c.root) % 12 };
}

/** Sub bass: root on the one and a pickup, played a touch long and soft. */
function bass(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'break') return [];
  const pc = chordAt(track, ctx.trackBar).pc;
  const root = pc >= 4 ? 24 + pc : 36 + pc;
  const out: StepEvent[] = [{ step: 0, length: 6, velocity: 0.85, notes: [root] }];
  if (ctx.section !== 'intro') {
    out.push({ step: 7, length: 2, velocity: 0.6, notes: [root] }, { step: 10, length: 3, velocity: 0.7, notes: [root + 7] });
    if (ctx.trackBar % 4 === 3) out.push({ step: 14, length: 2, velocity: 0.6, notes: [root + 12] });
  }
  return out;
}

/** Held jazzy chords, re-struck on the "and" of 3 in builds and drops. */
function chords(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'outro' && ctx.barInSection >= 4) return [];
  const c = chordAt(track, ctx.trackBar);
  const base = 48 + c.pc; // C3..B3
  const notes = [base, base + c.third, base + 7, base + c.seventh];
  const velocity = ctx.section === 'intro' ? 0.3 : 0.42;
  const out: StepEvent[] = [{ step: 0, length: 10, velocity, notes }];
  if (ctx.section === 'drop' || ctx.section === 'build') out.push({ step: 10, length: 4, velocity: velocity * 0.8, notes });
  return out;
}

/** A sparse wandering line: a 2-bar motif from the seed with lots of space. */
function melody(track: TrackDef, ctx: BarContext): StepEvent[] {
  const { section, barInSection, sectionBars } = ctx;
  if (section === 'outro') return [];
  if (section === 'intro' && barInSection < sectionBars - 4) return [];
  const rng = makeRng(track.seed * 37 + (ctx.trackBar % 2));
  const out: StepEvent[] = [];
  for (let s = 0; s < 16; s += 2) {
    if (rng() > (s % 4 === 0 ? 0.4 : 0.22)) continue;
    const degree = Math.floor(rng() * PENTATONIC.length) + (ctx.trackBar % 4 === 3 ? 1 : 0);
    const note = 72 + track.key.root + PENTATONIC[degree % PENTATONIC.length] + Math.floor(degree / PENTATONIC.length) * 12;
    out.push({ step: s, length: rng() > 0.5 ? 4 : 2, velocity: section === 'break' ? 0.4 : 0.5, notes: [note] });
  }
  return out;
}

export function lofi(track: TrackDef, ctx: BarContext): BarPattern {
  return { drums: drums(ctx), bass: bass(track, ctx), chords: chords(track, ctx), melody: melody(track, ctx) };
}
