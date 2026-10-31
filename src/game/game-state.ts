import { loadBest, loadSettings, nightlyRequest, RequestTracker } from './comeback.js';
import type { BestSet, Settings, Summary } from './comeback.js';

/**
 * The session's come-back and settings state, one mutable object (like
 * `club` and `crowdState`): written by the set flow and the console, read by
 * the screens and mirrored through `__dropRoom` for tests.
 */
export const game = {
  settings: loadSettings() as Settings,
  /** best set from earlier sets (loaded at page start, updated when a set finishes) */
  best: loadBest() as BestSet | null,
  /** tonight's request and how far along it is */
  tracker: new RequestTracker(nightlyRequest(new Date())),
  requestShown: false,
  /** this set so far */
  stats: { peakHype: 0, timeOnFire: 0, bestMove: '', bestMoveGain: 0, bars: 0, firstDropBar: -1, lastMoveBar: 0, moves: 0 },
  finished: false,
  /** Play again is loading the opening tracks */
  restarting: false,
  summary: null as Summary | null,
  /** how many sets were finished this page load */
  finishedSets: 0,
  /** the toast above the console (performance.now ms deadline) */
  toast: { text: '', until: 0, id: 0 },
  /** a one-off ring + label on a control, shown by the coach */
  tip: { id: 0, target: '', label: '', seconds: 0 },
  /** HELP pokes: the coach replays the first-five-minutes tips when this changes */
  tour: { id: 0 },
  /** tips shown this page load, for tests */
  tipsShown: [] as string[],
  /** we pinned crowd energy for the applause (so Play again may release it) */
  forcedApplause: false,
};

export function showToast(text: string, ms = 7000): void {
  game.toast.text = text;
  game.toast.until = performance.now() + ms;
  game.toast.id++;
}

export function showTip(id: string, target: string, label: string, seconds = 6): void {
  game.tip.id++;
  game.tip.target = target;
  game.tip.label = label;
  game.tip.seconds = seconds;
  game.tipsShown.push(id);
}

export function newRequest(date: Date): void {
  game.tracker.reset(nightlyRequest(date));
  game.requestShown = false;
}
