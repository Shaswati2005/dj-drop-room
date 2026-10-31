/**
 * The come-back kit and settings (PLAN §5.2, §5.5), pure logic plus one tiny
 * localStorage layer. Every storage access is wrapped: with storage blocked
 * (private window, embedded frame) the app runs on defaults and simply
 * forgets. No audio or three imports, so it runs in plain Node tests.
 */

export const SETTINGS_KEY = 'dropRoom.settings';
export const BEST_KEY = 'dropRoom.best';

export interface Settings {
  /** master volume 0..1 */
  volume: number;
  /** extra room dimming in mixed reality 0..1 */
  dim: number;
  /** drop flashes cut to a faint glow (PLAN §5.2) */
  reducedFlash: boolean;
}

export const DEFAULT_SETTINGS: Settings = { volume: 1, dim: 0, reducedFlash: false };

/** Pokes step volume and dim by this much. */
export const SETTING_STEP = 0.1;

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, Math.round(v * 100) / 100)) : fallback;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readJson(key: string, from: Storage | null = store()): unknown {
  try {
    const text = from?.getItem(key);
    return text == null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown, to: Storage | null = store()): boolean {
  try {
    if (to == null) return false;
    to.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(from?: Storage | null): Settings {
  const raw = readJson(SETTINGS_KEY, from) as Partial<Settings> | null;
  return {
    volume: clamp01(raw?.volume, DEFAULT_SETTINGS.volume),
    dim: clamp01(raw?.dim, DEFAULT_SETTINGS.dim),
    reducedFlash: raw?.reducedFlash === true,
  };
}

export function saveSettings(settings: Settings, to?: Storage | null): boolean {
  return writeJson(SETTINGS_KEY, settings, to);
}

/** Step a 0..1 setting up or down by one poke (rounded to avoid drift). */
export function stepSetting(value: number, direction: 1 | -1): number {
  return clamp01(Math.round((value + direction * SETTING_STEP) * 100) / 100, value);
}

// ---- best set -------------------------------------------------------------

export interface BestSet {
  /** highest crowd energy reached, 0..100 */
  peakHype: number;
  /** seconds the crowd spent on fire */
  timeOnFire: number;
  /** local date YYYY-MM-DD */
  date: string;
}

export function loadBest(from?: Storage | null): BestSet | null {
  const raw = readJson(BEST_KEY, from) as Partial<BestSet> | null;
  if (raw == null || typeof raw.peakHype !== 'number' || !Number.isFinite(raw.peakHype)) return null;
  return {
    peakHype: Math.max(0, Math.min(100, raw.peakHype)),
    timeOnFire: typeof raw.timeOnFire === 'number' && Number.isFinite(raw.timeOnFire) ? Math.max(0, raw.timeOnFire) : 0,
    date: typeof raw.date === 'string' ? raw.date : '',
  };
}

export function saveBest(best: BestSet, to?: Storage | null): boolean {
  return writeJson(BEST_KEY, best, to);
}

/** A set beats the best on peak crowd energy, then on time on fire. */
export function isBetter(set: BestSet, best: BestSet | null): boolean {
  if (best == null) return set.peakHype > 0;
  const peak = Math.round(set.peakHype);
  const bestPeak = Math.round(best.peakHype);
  return peak > bestPeak || (peak === bestPeak && Math.round(set.timeOnFire) > Math.round(best.timeOnFire));
}

/** Local calendar date as YYYY-MM-DD. */
export function dateString(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Local calendar date as the integer YYYYMMDD (the request seed). */
export function dateSeed(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// ---- nightly request ------------------------------------------------------

export type RequestGenre = 'house' | 'techno' | 'nu-disco' | 'lofi' | 'dnb';
/** The genres of the six-track catalog. */
export const REQUEST_GENRES: readonly RequestGenre[] = ['house', 'techno', 'nu-disco', 'lofi', 'dnb'];
const GENRE_NAMES: Record<RequestGenre, string> = { house: 'house', techno: 'techno', 'nu-disco': 'nu-disco', lofi: 'lo-fi', dnb: 'drum & bass' };

export interface RequestGoal {
  id: string;
  /** crowd tier to hold (2 hot, 3 on fire) */
  minTier: number;
  bars: number;
  text: string;
}
export const REQUEST_GOALS: readonly RequestGoal[] = [
  { id: 'hot16', minTier: 2, bars: 16, text: 'keep them hot for 16 bars' },
  { id: 'hot24', minTier: 2, bars: 24, text: 'keep them hot for 24 bars' },
  { id: 'fire8', minTier: 3, bars: 8, text: 'get them on fire for 8 bars' },
  { id: 'fire12', minTier: 3, bars: 12, text: 'hold them on fire for 12 bars' },
];

export interface NightlyRequest {
  /** YYYYMMDD */
  seed: number;
  genre: RequestGenre;
  goal: RequestGoal;
  /** toast text, e.g. "Tonight: techno, keep them hot for 16 bars" */
  text: string;
}

/** Deterministic: the same local date always asks for the same thing. */
export function nightlyRequest(date: Date): NightlyRequest {
  const seed = dateSeed(date);
  // a small integer hash so consecutive days do not walk the lists in lockstep
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  const genre = REQUEST_GENRES[h % REQUEST_GENRES.length];
  const goal = REQUEST_GOALS[Math.floor(h / REQUEST_GENRES.length) % REQUEST_GOALS.length];
  return { seed, genre, goal, text: `Tonight: ${GENRE_NAMES[genre]}, ${goal.text}` };
}

/**
 * Watches the set for the request: the playing deck's genre must be the
 * requested one while the crowd stays at or above the goal tier. Progress is
 * consecutive bars; dropping below the tier (or leaving the genre) starts over.
 */
export class RequestTracker {
  /** consecutive qualifying bars */
  progress = 0;
  done = false;
  constructor(public request: NightlyRequest) {}

  /** `bars` = how many bars passed since the last call. Returns true on the call that completes it. */
  update(bars: number, tier: number, genre: string): boolean {
    if (this.done) return false;
    if (genre === this.request.genre && tier >= this.request.goal.minTier) this.progress += bars;
    else this.progress = 0;
    if (this.progress >= this.request.goal.bars) {
      this.done = true;
      return true;
    }
    return false;
  }

  reset(request = this.request): void {
    this.request = request;
    this.progress = 0;
    this.done = false;
  }
}

// ---- resident crowd -------------------------------------------------------

/** Crowd energy for the tier of your best set: the crowd arrives at that size. */
const RESIDENT_ENERGY = [0, 0.3, 0.55, 0.8];

export function residentEnergy(best: BestSet | null): number {
  if (best == null) return 0;
  const e = best.peakHype / 100;
  const tier = e < 0.25 ? 0 : e < 0.5 ? 1 : e < 0.75 ? 2 : 3;
  return RESIDENT_ENERGY[tier];
}

// ---- summary --------------------------------------------------------------

export interface Summary {
  peakHype: number;
  timeOnFire: number;
  bestMove: string;
  /** the best set before this one, or null on a first set */
  previous: BestSet | null;
  newBest: boolean;
}

export function makeSummary(
  peakHype: number,
  timeOnFire: number,
  bestMove: string,
  previous: BestSet | null,
  date: Date,
): { summary: Summary; best: BestSet | null } {
  const set: BestSet = { peakHype: Math.round(peakHype), timeOnFire: Math.round(timeOnFire), date: dateString(date) };
  const newBest = isBetter(set, previous);
  return { summary: { peakHype: set.peakHype, timeOnFire: set.timeOnFire, bestMove, previous, newBest }, best: newBest ? set : previous };
}

export function formatBest(best: BestSet | null): string {
  if (best == null) return 'No best yet';
  const t = best.timeOnFire;
  return `Your best: ${best.peakHype}% crowd, ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} on fire`;
}
