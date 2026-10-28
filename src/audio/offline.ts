import { createOfflineContext } from './context.js';
import { Engine } from './engine.js';
import { TRACKS } from './tracks/catalog.js';
import { STEMS } from './track-model.js';
import type { Stem } from './track-model.js';

const SAMPLE_RATE = 44100;

export interface OfflineReport {
  trackId: string;
  startBar: number;
  bars: number;
  peakDb: number;
  rmsDb: number;
  clips: number;
  stemRmsDb: Record<Stem, number>;
  /** per rendered bar: is there a kick on step 0? (drums solo, low-passed) */
  kickOnBarStart: boolean[];
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round = (x: number) => Math.round(x * 10) / 10;

async function render(trackId: string, startBar: number, seconds: number, solo?: Stem): Promise<Float32Array> {
  const context = createOfflineContext(seconds, SAMPLE_RATE);
  const engine = new Engine(context);
  engine.startOffline(trackId, startBar);
  if (solo != null) STEMS.forEach((stem, i) => engine.decks.A.setStemNow(i, stem === solo));
  const buffer = await context.render();
  const data = buffer.getChannelData(0).slice();
  engine.dispose();
  return data;
}

function rms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

/** Kick check: low-pass the drums at ~150 Hz and compare the first 50 ms of
 * each bar with the 60 ms just before it. */
function kicks(drums: Float32Array, barSeconds: number, bars: number): boolean[] {
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / SAMPLE_RATE);
  const low = new Float32Array(drums.length);
  let y = 0;
  for (let i = 0; i < drums.length; i++) {
    y += alpha * (drums[i] - y);
    low[i] = Math.abs(y);
  }
  const peak = (from: number, to: number) => {
    let p = 0;
    for (let i = Math.max(0, Math.floor(from * SAMPLE_RATE)); i < Math.min(low.length, to * SAMPLE_RATE); i++) {
      if (low[i] > p) p = low[i];
    }
    return p;
  };
  const out: boolean[] = [];
  for (let b = 0; b < bars; b++) {
    const t = b * barSeconds;
    const inside = peak(t, t + 0.05);
    const before = b === 0 ? 0 : peak(t - 0.07, t - 0.01);
    out.push(inside > 0.05 && inside > 2 * before);
  }
  return out;
}

/** Render `bars` bars of a track through Tone's offline context and measure
 * it (PLAN §6.4). Runs in the browser; Node has no OfflineAudioContext. */
export async function renderOffline(trackId: string, bars = 4, startBar = 0): Promise<OfflineReport> {
  const track = TRACKS[trackId];
  if (track == null) throw new Error(`Unknown track ${trackId}`);
  const barSeconds = 240 / track.bpm;
  const seconds = bars * barSeconds + 0.5;

  const mix = await render(trackId, startBar, seconds);
  let peak = 0;
  let clips = 0;
  for (let i = 0; i < mix.length; i++) {
    const a = Math.abs(mix[i]);
    if (a > peak) peak = a;
    if (a >= 1) clips++;
  }
  const stemRmsDb = {} as Record<Stem, number>;
  let drums = mix;
  for (const stem of STEMS) {
    const solo = await render(trackId, startBar, seconds, stem);
    stemRmsDb[stem] = round(db(rms(solo)));
    if (stem === 'drums') drums = solo;
  }
  return {
    trackId,
    startBar,
    bars,
    peakDb: round(db(peak)),
    rmsDb: round(db(rms(mix))),
    clips,
    stemRmsDb,
    kickOnBarStart: kicks(drums, barSeconds, bars),
  };
}
