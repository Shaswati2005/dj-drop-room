import { liveEngine } from '../audio/live.js';

/** What the light show needs to know about the music this frame, shared by
 * the light rig and the club so both read the same beat. */
export interface ShowFrame {
  /** beats since the master deck's start (a free-running clock with no track) */
  beats: number;
  /** 0..1 position inside the current beat */
  phase: number;
  /** 1 on the beat, decaying fast */
  pulse: number;
  /** 1 on a landing DROP, fading out over half a second */
  flash: number;
  /** 0.45 verse, 0.7 build, 1 drop */
  energy: number;
  /** palette hue, a new one every 8 bars */
  hue: number;
  /** master deck level, 0..1 */
  level: number;
}

export const newShowFrame = (): ShowFrame => ({ beats: 0, phase: 0, pulse: 0, flash: 0, energy: 0.45, hue: 0, level: 0 });

/** Fill `out` from the engine as heard; `time` drives the idle clock. No allocation. */
export function readShow(out: ShowFrame, time: number): ShowFrame {
  const engine = liveEngine();
  const s = engine.state;
  const deck = engine.decks[s.master];
  const beats = deck.track == null ? time * 2 : deck.position(s.heard) / (deck.barSeconds / 4);
  out.beats = beats;
  out.phase = beats - Math.floor(beats);
  out.pulse = Math.exp(-out.phase * 5);
  const sinceDrop = s.drops > 0 ? s.heard - s.dropAt : Infinity;
  out.flash = sinceDrop >= 0 && sinceDrop < 0.5 ? 1 - sinceDrop / 0.5 : 0;
  const view = s[s.master];
  out.energy = view.section === 'drop' ? 1 : view.section === 'build' ? 0.7 : 0.45;
  out.hue = (Math.floor(beats / 32) * 0.17) % 1;
  out.level = view.level;
  return out;
}
