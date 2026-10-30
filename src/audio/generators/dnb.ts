import { makeRng } from '../track-model.js';
import type { BarContext, BarPattern, StepEvent, TrackDef } from '../track-model.js';

/** Drum & bass (Airlock, PLAN §3.2): the two-step kick `x.........x.....`,
 * snare on 2 and 4, 16th hats with a ride in the drop, a sine sub with a
 * detuned (Reese) layer, one pad chord per 2 bars and 16th arpeggios in the
 * drop only. E minor: i – VI – VII – III over 8 bars. */
const CHORDS = [
  { root: 0, third: 3 }, // Em
  { root: 8, third: 4 }, // C
  { root: 10, third: 4 }, // D
  { root: 3, third: 4 }, // G
];
const ARP = [0, 3, 7, 10, 12, 15, 12, 10];

const hit = (step: number, velocity: number, voice: StepEvent['voice'], length = 1): StepEvent => ({ step, length, velocity, voice });

function drums(ctx: BarContext): StepEvent[] {
  const out: StepEvent[] = [];
  const { section, barInSection, sectionBars, phraseBar } = ctx;
  const lastBars = sectionBars - barInSection;
  if (section !== 'break') {
    const v = section === 'drop' ? 1 : 0.85;
    out.push(hit(0, v, 'kick'), hit(10, v * 0.9, 'kick'));
    // the second kick shifts every other bar, as in a rolling break
    if (section === 'drop' && ctx.trackBar % 2 === 1) out.push(hit(7, 0.6, 'kick'));
  }
  if (section !== 'intro' || barInSection >= 8) out.push(hit(4, 0.9, 'snare'), hit(12, 0.9, 'snare'));
  if (section === 'drop') {
    for (let s = 0; s < 16; s++) if (s % 4 !== 0) out.push(hit(s, s % 2 === 0 ? 0.3 : 0.2, 'hat'));
    for (const s of [2, 6, 10, 14]) out.push(hit(s, 0.34, 'openHat'));
    // ghost snares between the backbeats
    for (const s of [7, 9, 15]) out.push(hit(s, 0.22, 'snare'));
    if (phraseBar === 8) for (const s of [13, 14, 15]) out.push(hit(s, 0.45 + (s - 13) * 0.15, 'snare'));
  } else if (section === 'build') {
    for (let s = 0; s < 16; s += 2) out.push(hit(s, 0.26, 'hat'));
    if (lastBars === 2) for (let s = 0; s < 16; s += 2) out.push(hit(s, 0.35 + s * 0.015, 'snare'));
    if (lastBars === 1) for (let s = 0; s < 16; s++) out.push(hit(s, 0.4 + s * 0.035, 'snare'));
  } else if (section === 'outro') {
    for (let s = 0; s < 16; s += 2) out.push(hit(s, 0.2, 'hat'));
  } else {
    for (const s of [2, 6, 10, 14]) out.push(hit(s, 0.18, 'hat'));
  }
  // each drum voice is one synth: strictly one hit per step, in time order
  const best = new Map<string, StepEvent>();
  for (const e of out) {
    const key = e.voice + ':' + e.step;
    if ((best.get(key)?.velocity ?? -1) < e.velocity) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => a.step - b.step);
}

function chordAt(track: TrackDef, trackBar: number) {
  const c = CHORDS[Math.floor(trackBar / 2) % 4];
  return { ...c, pc: (track.key.root + c.root) % 12 };
}

/** Sub on the root, sliding up a fifth/octave on the off-steps in the drop. */
function bass(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'break') return [];
  const pc = chordAt(track, ctx.trackBar).pc;
  const root = pc >= 4 ? 24 + pc : 36 + pc;
  if (ctx.section === 'intro' || ctx.section === 'outro') return [{ step: 0, length: 10, velocity: 0.8, notes: [root] }];
  const out: StepEvent[] = [
    { step: 0, length: 6, velocity: 0.95, notes: [root] },
    { step: 6, length: 2, velocity: 0.7, notes: [root + 12] },
    { step: 10, length: 4, velocity: 0.9, notes: [root] },
  ];
  if (ctx.section === 'drop') {
    out.push({ step: 14, length: 1, velocity: 0.7, notes: [root + 7] }, { step: 15, length: 1, velocity: 0.7, notes: [root + 10] });
  }
  return out;
}

/** One pad chord per 2 bars, held. */
function chords(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.trackBar % 2 === 1) return [];
  if (ctx.section === 'outro' && ctx.barInSection >= 8) return [];
  const c = chordAt(track, ctx.trackBar);
  const base = 55 + ((c.pc - 7 + 12) % 12); // G3..F#4
  const notes = [base, base + c.third, base + 7, base + 12 + c.third];
  const velocity = ctx.section === 'break' ? 0.55 : ctx.section === 'intro' ? 0.35 : 0.42;
  return [{ step: 0, length: 32, velocity, notes }];
}

/** 16th arpeggios, drop only, rotating from the seed per phrase. */
function melody(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section !== 'drop' && !(ctx.section === 'break' && ctx.barInSection >= ctx.sectionBars - 4)) return [];
  const rng = makeRng(track.seed * 29 + Math.floor(ctx.trackBar / 4));
  const chord = chordAt(track, ctx.trackBar);
  const shift = Math.floor(rng() * 3);
  const out: StepEvent[] = [];
  for (let s = 0; s < 16; s++) {
    if (ctx.section === 'break' ? s % 4 !== 0 : s % 8 === 7 && rng() > 0.5) continue;
    const note = 76 + chord.pc + ARP[(s + shift) % ARP.length] - (chord.pc >= 6 ? 12 : 0);
    out.push({ step: s, length: 1, velocity: s % 4 === 0 ? 0.5 : 0.34, notes: [note] });
  }
  return out;
}

export function dnb(track: TrackDef, ctx: BarContext): BarPattern {
  return { drums: drums(ctx), bass: bass(track, ctx), chords: chords(track, ctx), melody: melody(track, ctx) };
}
