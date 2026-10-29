import { Vector3 } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { renderOffline, renderStem, toPcm16Base64 } from '../audio/render/render.js';
import type { DeckId } from '../audio/deck.js';
import { STEMS } from '../audio/track-model.js';
import { buildSetUrl, offerRecording, saveRecording, shareSet } from '../share.js';
import type { Stem } from '../audio/track-model.js';

/**
 * `window.__dropRoom`, for CLI and Playwright tests (PLAN §6.4):
 * - state(): a copy of the engine state as heard
 * - start(): start the session (needs a prior user gesture to be audible)
 * - press('A.bass' | 'B.play' | 'A.cue' | 'B.sync' | ...): what a console press sends
 * - tempo(deck, fader): set a tempo fader, -1..1
 * - renderOffline(trackId, bars, startBar): offline render + metrics
 * - renderStem(trackId, stem): a whole stem as base64 16-bit PCM (build script)
 * - timing(): when the last stem press happened and where in the bar it landed
 * - worldPosition(name, offset?): world point of a named object's origin, or of
 *   a point offset from it in its parent's space (where to drag a fader to)
 * - crate(): the crate slots (name, BPM, Camelot key, which deck holds them, match)
 * - setUrl(): the share link for the set so far; shareSet() also shows/copies it
 * - saveRecording(): share or download the last REC take
 * - engine(): the live engine, for mixer and pad calls; world: the ECS world
 */
export function installDebugApi(world: World): void {
  const scene = world.scene;
  const api = {
    state: () => JSON.parse(JSON.stringify(liveEngine().update())),
    start: () => liveEngine().start(),
    press: (control: string) => {
      const [deck, what] = control.split('.') as [DeckId, string];
      const engine = liveEngine();
      if (what === 'play') engine.togglePlay(deck);
      else if (what === 'cue') engine.cue(deck);
      else if (what === 'sync') engine.sync(deck);
      else if ((STEMS as readonly string[]).includes(what)) engine.toggleStem(deck, what as Stem);
      else throw new Error(`Unknown control ${control}`);
    },
    tempo: (deck: DeckId, fader: number) => liveEngine().setTempo(deck, fader),
    renderOffline,
    renderStem: async (trackId: string, stem: Stem) => toPcm16Base64(await renderStem(trackId, stem)),
    timing: () => {
      const e = liveEngine();
      const deck = e.decks.A.lastCommitTime >= e.decks.B.lastCommitTime ? e.decks.A : e.decks.B;
      const commitAt = deck.lastCommitTime;
      // where in the deck's bar the change was applied: 0 (or 1) = on the bar line
      const barPhase = (deck.position(commitAt) / deck.barSeconds) % 1;
      return { pressAt: e.lastPressTime, commitAt, barPhase, barSeconds: deck.barSeconds / deck.rate };
    },
    engine: liveEngine,
    crate: () => liveEngine().crate(),
    setUrl: buildSetUrl,
    shareSet,
    saveRecording,
    offerRecording,
    world,
    worldPosition: (name: string, offset: [number, number, number] = [0, 0, 0]) => {
      const object = scene.getObjectByName(name);
      if (object == null) throw new Error(`No object named ${name}`);
      const p = new Vector3(...offset).add(object.position);
      if (object.parent != null) object.parent.localToWorld(p);
      return { x: p.x, y: p.y, z: p.z };
    },
  };
  (window as unknown as { __dropRoom: typeof api }).__dropRoom = api;
}
