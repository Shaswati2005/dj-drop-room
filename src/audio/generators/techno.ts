import { makeRng } from '../track-model.js';
import type { BarContext, BarPattern, StepEvent, TrackDef } from '../track-model.js';

/** Techno (PLAN §3.2 table): kick on every beat, offbeat open hat, clap on 2
 * and 4, a rolling one-note 16th bass, a minor stab every 2 bars and a sparse
 * acid-style line in the drops. Darker and more driving than house. */

const QUARTERS = [0, 4, 8, 12];
const OFFBEATS = [2, 6, 10, 14];

const hit = (step: number, velocity: number, voice: StepEvent['voice'], length = 1): StepEvent => ({ step, length, velocity, voice });

function drums(ctx: BarContext): StepEvent[] {
  const out: StepEvent[] = [];
  const { section, barInSection, sectionBars } = ctx;
  const lastBars = sectionBars - barInSection;
  if (section !== 'break') for (const s of QUARTERS) out.push(hit(s, section === 'drop' ? 1 : 0.9, 'kick'));
  if (section !== 'intro' || barInSection >= 4) for (const s of OFFBEATS) out.push(hit(s, section === 'drop' ? 0.6 : 0.4, 'openHat'));
  if (section === 'drop' || section === 'outro' || (section === 'build' && barInSection % 2 === 1)) {
    out.push(hit(4, 0.85, 'clap'), hit(12, 0.85, 'clap'));
  }
  // driving 16th hats with accents
  if (section === 'drop' || section === 'build') for (let s = 0; s < 16; s++) if (s % 2 === 1) out.push(hit(s, s % 4 === 3 ? 0.35 : 0.22, 'hat'));
  if (section === 'build' && lastBars <= 2) {
    const step = lastBars === 2 ? 2 : 1;
    for (let s = 0; s < 16; s += step) out.push(hit(s, 0.35 + s * 0.03, 'snare'));
  }
  if (section === 'break') for (const s of [0, 8]) out.push(hit(s, 0.3, 'hat'));
  return out;
}

function bass(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'break' || ctx.section === 'intro') return [];
  // one note, rolling 16ths that skip the kick
  const root = 33 + ((track.key.root - 9 + 12) % 12); // A1
  const out: StepEvent[] = [];
  for (let s = 0; s < 16; s++) {
    if (s % 4 === 0) continue;
    out.push({ step: s, length: 1, velocity: s % 4 === 2 ? 0.9 : 0.65, notes: [s === 14 && ctx.trackBar % 4 === 3 ? root + 12 : root] });
  }
  return out;
}

function chords(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section === 'outro' && ctx.barInSection >= 4) return [];
  const base = 57 + ((track.key.root - 9 + 12) % 12); // A3 minor stab
  const notes = [base, base + 3, base + 7, base + 10];
  if (ctx.section === 'break') return ctx.barInSection % 4 === 0 ? [{ step: 0, length: 32, velocity: 0.4, notes }] : [];
  if (ctx.trackBar % 2 === 1) return [];
  return [
    { step: 0, length: 2, velocity: 0.45, notes },
    { step: 6, length: 1, velocity: 0.3, notes },
  ];
}

/** Acid-style 16th line from the seed, only in builds and drops. */
function melody(track: TrackDef, ctx: BarContext): StepEvent[] {
  if (ctx.section !== 'drop' && !(ctx.section === 'build' && ctx.barInSection >= ctx.sectionBars / 2)) return [];
  const rng = makeRng(track.seed * 17 + (ctx.trackBar % 4));
  const scale = [0, 3, 5, 7, 10, 12];
  const out: StepEvent[] = [];
  for (let s = 0; s < 16; s++) {
    if (rng() > (ctx.section === 'drop' ? 0.55 : 0.3)) continue;
    const note = 57 + ((track.key.root - 9 + 12) % 12) + scale[Math.floor(rng() * scale.length)];
    out.push({ step: s, length: 1, velocity: s % 4 === 0 ? 0.6 : 0.42, notes: [note] });
  }
  return out;
}

export function techno(track: TrackDef, ctx: BarContext): BarPattern {
  return { drums: drums(ctx), bass: bass(track, ctx), chords: chords(track, ctx), melody: melody(track, ctx) };
}
