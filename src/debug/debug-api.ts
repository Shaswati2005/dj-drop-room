import { Vector3 } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { renderOffline, renderStem, renderStemChunk, toPcm16Base64 } from '../audio/render/render.js';
import type { DeckId } from '../audio/deck.js';
import { STEMS } from '../audio/track-model.js';
import { club, setClub } from '../show/club-state.js';
import { crowdState } from '../show/crowd-state.js';
import { lights, resetLightPeaks } from '../show/light-state.js';
import { dateString, nightlyRequest } from '../game/comeback.js';
import type { RequestGenre } from '../game/comeback.js';
import { game } from '../game/game-state.js';
import { changeSetting, finishSet, playAgain, settingsAction } from '../game/set-flow.js';
import { CoachSystem } from '../systems/coach-system.js';
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
 * - club(): club mode state (on, changes, reducedFlash, LED wall brightness); setClub(on) switches it
 * - crowd(): the crowd (context table/club, dancers drawn, how many in each state, tier, draw calls); forceHype(v | null) pins its energy 0..1
 * - lights(): the light show (tier, heads lit, riser dim, drop burst, sweep speed, peaks, strobe-guard counts); resetLightPeaks()
 * - game(): settings, best set, tonight's request and progress, this set's stats, finished + summary card data, toast, tips shown
 * - setSetting(key, value) / settingsAction('volUp' | 'help' | ...) / finishSet() / playAgain(); requestFor('YYYY-MM-DD') is the request that date would get
 * - drawCalls(): renderer draw calls and triangles of the last frame
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
    renderStemChunk: async (trackId: string, stem: Stem, fromBar: number, bars: number) => toPcm16Base64(await renderStemChunk(trackId, stem, fromBar, bars)),
    timing: () => {
      const e = liveEngine();
      const deck = e.decks.A.lastCommitTime >= e.decks.B.lastCommitTime ? e.decks.A : e.decks.B;
      const commitAt = deck.lastCommitTime;
      // where in the deck's bar the change was applied: 0 (or 1) = on the bar line
      const barPhase = (deck.position(commitAt) / deck.barSeconds) % 1;
      return { pressAt: e.lastPressTime, commitAt, barPhase, barSeconds: deck.barSeconds / deck.rate };
    },
    engine: liveEngine,
    club: () => ({ ...club }),
    setClub,
    setReducedFlash: (on: boolean) => changeSetting('reducedFlash', on),
    game: () => {
      const toastOn = performance.now() < game.toast.until;
      return {
        settings: { ...game.settings },
        best: game.best == null ? null : { ...game.best },
        request: {
          genre: game.tracker.request.genre,
          text: game.tracker.request.text,
          goalBars: game.tracker.request.goal.bars,
          minTier: game.tracker.request.goal.minTier,
          seed: game.tracker.request.seed,
          progress: game.tracker.progress,
          done: game.tracker.done,
          shown: game.requestShown,
        },
        stats: { ...game.stats },
        finished: game.finished,
        finishedSets: game.finishedSets,
        summary: game.summary == null ? null : JSON.parse(JSON.stringify(game.summary)),
        toast: toastOn ? game.toast.text : '',
        tipsShown: [...game.tipsShown],
        tourId: game.tour.id,
        coachShown: world.getSystem(CoachSystem)?.shown ?? '',
        coachStep: world.getSystem(CoachSystem)?.step ?? -1,
      };
    },
    setSetting: (key: 'volume' | 'dim' | 'reducedFlash', value: number | boolean) => changeSetting(key, value as never),
    settingsAction,
    finishSet,
    playAgain,
    requestFor: (isoDate: string) => {
      const [y, m, d] = isoDate.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return { ...nightlyRequest(date), date: dateString(date) };
    },
    /** tests: swap tonight's request for a short one (genre, bars to hold, minimum tier) */
    setRequest: (genre: RequestGenre, bars: number, minTier: number) => {
      game.tracker.reset({ ...game.tracker.request, genre, goal: { id: 'test', minTier, bars, text: `test for ${bars} bars` }, text: `Tonight: ${genre}, test for ${bars} bars` });
    },
    /** tests: pretend n bars of the set have passed (the idle tip waits 16 idle bars) */
    advanceBars: (n: number) => {
      game.stats.bars += n;
    },
    /** tests: set the session's request clock-free (tracker progress and the shown flag) */
    forceRequestShown: () => {
      game.requestShown = true;
    },
    crate: () => liveEngine().crate().map((slot) => ({ ...slot })),
    crowd: () => ({ ...crowdState, counts: [...crowdState.counts] }),
    forceHype: (value: number | null) => {
      crowdState.force = value;
    },
    lights: () => ({ ...lights, colors: Array.from(lights.colors) }),
    resetLightPeaks,
    drawCalls: () => {
      const info = world.renderer.info;
      return { calls: info.render.calls, triangles: info.render.triangles };
    },
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
