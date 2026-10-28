import { makeRng } from '../track-model.js';
import type { BarContext, BarPattern, StepEvent, TrackDef } from '../track-model.js';

/** Chord roots (semitones above the key root) for a 4-bar loop.
 * Minor: i–VI–III–VII. Major: I–V–vi–IV (PLAN §3.2). */
const PROGRESSION = {
  minor: { roots: [0, 8, 3, 10], minor: [true, false, false, false] },
  major: { roots: [0, 7, 9, 5], minor: [false, false, true, false] },
};
const PENTATONIC = { minor: [0, 3, 5, 7, 10], major: [0, 2, 4, 7, 9] };

const OFFBEATS = [2, 6, 10, 14];
const QUARTERS = [0, 4, 8, 12];

function hit(step: number, velocity: number, voice: StepEvent['voice'], length = 1): StepEvent {
  return { step, length, velocity, voice };
}

function drums(ctx: BarContext): StepEvent[] {
  const out: StepEvent[] = [];
  const { section, barInSection, sectionBars, phraseBar } = ctx;
  const lastBars = sectionBars - barInSection;

  if (section !== 'break') {
    const kickVelocity = section === 'drop' ? 1 : 0.85;
    for (const s of QUARTERS) out.push(hit(s, kickVelocity, 'kick'));
  }
  if (section === 'build' || section === 'drop' || section === 'outro') {
    out.push(hit(4, 0.8, 'clap'), hit(12, 0.8, 'clap'));
  }
  if (section === 'drop') {
    for (const s of OFFBEATS) out.push(hit(s, 0.55, 'openHat'));
    for (const s of [3, 7, 11, 15]) out.push(hit(s, 0.3, 'hat'));
    // phrase-end fill
    if (phraseBar === 8) out.push(hit(14, 0.6, 'snare'), hit(15, 0.75, 'snare'));
  } else if (section === 'build') {
    const busy = barInSection >= sectionBars / 2;
    for (let s = 0; s < 16; s += busy ? 1 : 2) out.push(hit(s, s % 4 === 2 ? 0.5 : 0.28, 'hat'));
    // snare roll: 8ths two bars out, 16ths rising in the last bar
    if (lastBars === 2) for (let s = 0; s < 16; s += 2) out.push(hit(s, 0.35 + s * 0.015, 'snare'));
    if (lastBars === 1) for (let s = 0; s < 16; s++) out.push(hit(s, 0.4 + s * 0.035, 'snare'));
  } else {
    for (const s of OFFBEATS) out.push(hit(s, section === 'break' ? 0.25 : 0.4, 'hat'));
  }
  return out;
}

function chordRoot(track: TrackDef, trackBar: number): { pc: number; minor: boolean } {
  const prog = PROGRESSION[track.key.mode];
  const i = trackBar % 4;
  return { pc: (track.key.root + prog.roots[i]) % 12, minor: prog.minor[i] };
}

function bass(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'break') return [];
  const pc = chordRoot(track, ctx.trackBar).pc;
  const root = pc >= 4 ? 24 + pc : 36 + pc; // E1..D#2
  const out: StepEvent[] = [
    { step: 0, length: 2, velocity: 0.9, notes: [root] },
    { step: 8, length: 2, velocity: 0.85, notes: [root] },
  ];
  if (ctx.section === 'build' || ctx.section === 'drop') {
    for (const s of OFFBEATS) out.push({ step: s, length: 1, velocity: 0.7, notes: [root + 12] });
  }
  return out;
}

function chords(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'outro') return [];
  const { pc, minor } = chordRoot(track, ctx.trackBar);
  // close voicing between A3 and G#4
  const base = 57 + ((pc - 9 + 12) % 12);
  const notes = [base, base + (minor ? 3 : 4), base + 7];
  if (ctx.section === 'break') return [{ step: 0, length: 16, velocity: 0.45, notes }];
  const velocity = ctx.section === 'intro' ? 0.35 : 0.5;
  return OFFBEATS.map((step) => ({ step, length: 1, velocity, notes }));
}

/** A 2-bar pentatonic motif from the seed; every 4th bar answers it an
 * octave-step higher (PLAN §3.2). */
function melody(track: TrackDef, ctx: BarContext): StepEvent[] {
  const { section, barInSection, sectionBars } = ctx;
  if (section === 'outro') return [];
  if (section === 'intro' && barInSection < sectionBars - 4) return [];
  const scale = PENTATONIC[track.key.mode];
  const rng = makeRng(track.seed * 31 + (ctx.trackBar % 2));
  const answer = ctx.trackBar % 4 === 3;
  const out: StepEvent[] = [];
  for (let s = 0; s < 16; s += 2) {
    if (rng() > (s % 4 === 0 ? 0.55 : 0.3)) continue;
    const degree = Math.floor(rng() * scale.length) + (answer ? 2 : 0);
    const octave = Math.floor(degree / scale.length);
    const note = 69 + track.key.root - 9 + scale[degree % scale.length] + octave * 12;
    out.push({ step: s, length: rng() > 0.6 ? 3 : 1, velocity: section === 'intro' ? 0.35 : 0.55, notes: [note] });
  }
  return out;
}

export function house(track: TrackDef, ctx: BarContext): BarPattern {
  return {
    drums: drums(ctx),
    bass: bass(track, ctx),
    chords: chords(track, ctx),
    melody: melody(track, ctx),
  };
}
