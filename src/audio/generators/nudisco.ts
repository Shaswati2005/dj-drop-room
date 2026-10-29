import { makeRng } from '../track-model.js';
import type { BarContext, BarPattern, StepEvent, TrackDef } from '../track-model.js';

/** Nu-disco (Mirrorball): four-on-the-floor kick, offbeat open hats, claps on
 * 2 and 4, an octave-jumping disco bassline, syncopated seventh-chord stabs and
 * a bright hook from the dorian scale. Progression (semitones above the key
 * root): i7 – iv7 – VII7 – III, a classic minor disco loop. */
const CHORDS = [
  { root: 0, third: 3, seventh: 10 }, // Em7
  { root: 5, third: 3, seventh: 10 }, // Am7
  { root: 10, third: 4, seventh: 10 }, // D7
  { root: 3, third: 4, seventh: 11 }, // Gmaj7
];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const QUARTERS = [0, 4, 8, 12];
const OFFBEATS = [2, 6, 10, 14];

const hit = (step: number, velocity: number, voice: StepEvent['voice'], length = 1): StepEvent => ({ step, length, velocity, voice });

function drums(ctx: BarContext): StepEvent[] {
  const out: StepEvent[] = [];
  const { section, barInSection, sectionBars, phraseBar } = ctx;
  const lastBars = sectionBars - barInSection;
  if (section !== 'break') for (const s of QUARTERS) out.push(hit(s, section === 'drop' ? 1 : 0.85, 'kick'));
  if (section !== 'intro' || barInSection >= 4) out.push(hit(4, 0.75, 'clap'), hit(12, 0.75, 'clap'));
  if (section === 'drop') {
    for (const s of OFFBEATS) out.push(hit(s, 0.6, 'openHat'));
    for (let s = 1; s < 16; s += 2) out.push(hit(s, s % 4 === 3 ? 0.34 : 0.22, 'hat'));
    if (phraseBar === 8) out.push(hit(13, 0.5, 'snare'), hit(14, 0.6, 'snare'), hit(15, 0.75, 'snare'));
  } else if (section === 'build') {
    for (let s = 0; s < 16; s += 2) out.push(hit(s, s % 4 === 2 ? 0.5 : 0.3, 'hat'));
    if (lastBars === 2) for (let s = 0; s < 16; s += 2) out.push(hit(s, 0.35 + s * 0.015, 'snare'));
    if (lastBars === 1) for (let s = 0; s < 16; s++) out.push(hit(s, 0.4 + s * 0.035, 'snare'));
  } else if (section === 'break') {
    for (const s of OFFBEATS) out.push(hit(s, 0.2, 'hat'));
  } else {
    for (const s of OFFBEATS) out.push(hit(s, 0.4, 'openHat'));
  }
  return out;
}

function chordAt(track: TrackDef, trackBar: number) {
  const c = CHORDS[trackBar % 4];
  return { ...c, pc: (track.key.root + c.root) % 12 };
}

/** Disco bass: root on the one, octave jumps on the off-8ths, ghost 16ths. */
function bass(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'break') return [];
  const pc = chordAt(track, ctx.trackBar).pc;
  const root = pc >= 4 ? 24 + pc : 36 + pc;
  const out: StepEvent[] = [{ step: 0, length: 2, velocity: 0.8, notes: [root] }];
  for (const s of [2, 6, 10, 14]) out.push({ step: s, length: 1, velocity: 0.6, notes: [root + 12] });
  for (const s of [3, 7, 11, 15]) out.push({ step: s, length: 1, velocity: 0.45, notes: [root] });
  out.sort((a, b) => a.step - b.step); // a mono synth needs its notes in time order
  if (ctx.section === 'intro') return out.filter((e) => e.step % 4 !== 3);
  return out;
}

/** Offbeat seventh-chord stabs (the classic "chick" of disco guitar). */
function chords(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'outro' && ctx.barInSection >= 4) return [];
  const c = chordAt(track, ctx.trackBar);
  const base = 55 + ((c.pc - 7 + 12) % 12); // G3..F#4
  const notes = [base, base + c.third, base + 7, base + c.seventh];
  if (ctx.section === 'break') return [{ step: 0, length: 16, velocity: 0.4, notes }];
  const velocity = ctx.section === 'intro' ? 0.3 : 0.45;
  const steps = ctx.section === 'drop' ? [2, 3, 6, 10, 11, 14] : [2, 6, 10, 14];
  return steps.map((step) => ({ step, length: 1, velocity: step % 4 === 3 ? velocity * 0.7 : velocity, notes }));
}

/** A 2-bar syncopated hook from the seed; the 4th bar answers it higher. */
function melody(track: TrackDef, ctx: BarContext): StepEvent[] {
  const { section, barInSection, sectionBars } = ctx;
  if (section === 'outro' || section === 'intro') return [];
  if (section === 'build' && barInSection < sectionBars / 2) return [];
  const rng = makeRng(track.seed * 29 + (ctx.trackBar % 2));
  const answer = ctx.trackBar % 4 === 3;
  const out: StepEvent[] = [];
  for (let s = 0; s < 16; s++) {
    if (rng() > (s % 4 === 0 ? 0.6 : s % 2 === 1 ? 0.28 : 0.4)) continue;
    const degree = Math.floor(rng() * DORIAN.length) + (answer ? 2 : 0);
    const note = 72 + track.key.root + DORIAN[degree % DORIAN.length] + Math.floor(degree / DORIAN.length) * 12;
    out.push({ step: s, length: rng() > 0.7 ? 2 : 1, velocity: section === 'break' ? 0.4 : 0.55, notes: [note] });
  }
  return out;
}

export function nuDisco(track: TrackDef, ctx: BarContext): BarPattern {
  return { drums: drums(ctx), bass: bass(track, ctx), chords: chords(track, ctx), melody: melody(track, ctx) };
}
