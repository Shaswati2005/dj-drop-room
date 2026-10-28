import { liveEngine } from '../audio/live.js';
import { renderOffline } from '../audio/offline.js';
import type { DeckId } from '../audio/deck.js';
import { STEMS } from '../audio/track-model.js';
import type { Stem } from '../audio/track-model.js';

/**
 * `window.__dropRoom`, for CLI and Playwright tests (PLAN §6.4):
 * - state(): a copy of the engine state as heard
 * - start(): start the session (needs a prior user gesture to be audible)
 * - press('A.bass' | 'B.play' | ...): the same command a pad poke sends
 * - renderOffline(trackId, bars, startBar): offline render + metrics
 * - timing(): when the last stem press happened and when it was applied
 */
export function installDebugApi(): void {
  const api = {
    state: () => JSON.parse(JSON.stringify(liveEngine().update())),
    start: () => liveEngine().start(),
    press: (control: string) => {
      const [deck, what] = control.split('.') as [DeckId, string];
      if (what === 'play') liveEngine().togglePlay(deck);
      else if ((STEMS as readonly string[]).includes(what)) liveEngine().toggleStem(deck, what as Stem);
      else throw new Error(`Unknown control ${control}`);
    },
    renderOffline,
    timing: () => {
      const e = liveEngine();
      const commitAt = Math.max(e.decks.A.lastCommitTime, e.decks.B.lastCommitTime);
      return {
        pressAt: e.lastPressTime,
        commitAt,
        commitTicks: e.transport.getTicksAtTime(commitAt),
        ticksPerBar: e.transport.PPQ * 4,
        barSeconds: 240 / e.transport.bpm.value,
      };
    },
    engine: liveEngine,
  };
  (window as unknown as { __dropRoom: typeof api }).__dropRoom = api;
}
