import { liveEngine } from '../audio/live.js';
import { ButtonActions } from '../console-components.js';
import { club } from '../show/club-state.js';
import { crowdState } from '../show/crowd-state.js';
import { loadBest, makeSummary, nightlyRequest, saveBest, saveSettings, stepSetting } from './comeback.js';
import { game, showToast } from './game-state.js';

/** Applause pins the crowd at this energy (hands up, jumping). */
const APPLAUSE = 0.92;

/** Push the settings into the things they control. */
export function applySettings(): void {
  liveEngine().master.setVolume(game.settings.volume);
  club.reducedFlash = game.settings.reducedFlash;
}

/** Change one setting, apply it and remember it. */
export function changeSetting<K extends 'volume' | 'dim' | 'reducedFlash'>(key: K, value: (typeof game.settings)[K]): void {
  game.settings[key] = value;
  saveSettings(game.settings);
  applySettings();
}

/** A settings-tab poke. Works before the music starts, too. Returns true when the action was one of ours. */
export function settingsAction(action: string): boolean {
  const s = game.settings;
  switch (action) {
    case ButtonActions.volDown:
      changeSetting('volume', stepSetting(s.volume, -1));
      break;
    case ButtonActions.volUp:
      changeSetting('volume', stepSetting(s.volume, 1));
      break;
    case ButtonActions.dimDown:
      changeSetting('dim', stepSetting(s.dim, -1));
      break;
    case ButtonActions.dimUp:
      changeSetting('dim', stepSetting(s.dim, 1));
      break;
    case ButtonActions.flash:
      changeSetting('reducedFlash', !s.reducedFlash);
      break;
    case ButtonActions.help:
      game.tour.id++;
      break;
    case ButtonActions.finish:
      finishSet();
      break;
    default:
      return false;
  }
  return true;
}

/** Finish Set: the bus fades, the crowd applauds, one card sums the set up (PLAN §5.4). */
export function finishSet(): void {
  const engine = liveEngine();
  if (!engine.state.running || game.finished) return;
  const st = game.stats;
  const { summary, best } = makeSummary(st.peakHype, st.timeOnFire, st.bestMove || 'No standout move yet', game.best, new Date());
  game.summary = summary;
  if (summary.newBest && best != null) saveBest(best);
  game.best = best;
  game.finished = true;
  game.finishedSets++;
  if (crowdState.force == null) {
    crowdState.force = APPLAUSE;
    game.forcedApplause = true;
  }
  crowdState.jump = 1;
  engine.endSet(3);
  engine.click(true);
}

/** Play again: back to the opening state, Warm Start on deck A. */
export function playAgain(): void {
  const engine = liveEngine();
  if (!game.finished || game.restarting) return;
  game.restarting = true;
  engine.click(true);
  // the card stays until the decks are back, so the old set's energy cannot leak into the new stats
  void engine.restartSet().then(() => {
    game.restarting = false;
    game.finished = false;
    game.summary = null;
    if (game.forcedApplause) {
      crowdState.force = null;
      game.forcedApplause = false;
    }
    crowdState.energy = 0.2;
    crowdState.tier = 0;
    const st = game.stats;
    st.peakHype = 0;
    st.timeOnFire = 0;
    st.bestMove = '';
    st.bestMoveGain = 0;
    st.bars = 0;
    st.firstDropBar = -1;
    st.lastMoveBar = 0;
    st.moves = 0;
    game.best = loadBest() ?? game.best;
    game.tracker.reset(nightlyRequest(new Date()));
    game.requestShown = false;
    showToast('NEW SET: WARM START', 3000);
  });
}
