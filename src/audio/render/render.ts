import { createOfflineContext } from '../context.js';
import { Master } from '../master.js';
import { TRACKS } from '../tracks/catalog.js';
import { STEMS, trackBars } from '../track-model.js';
import type { Stem, TrackDef } from '../track-model.js';
import { Sequencer } from './sequencer.js';

export const RENDER_RATE = 48000; // Opus' native rate, so encoding never resamples

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

function trackOf(trackId: string): TrackDef {
  const track = TRACKS[trackId];
  if (track == null) throw new Error(`Unknown track ${trackId}`);
  return track;
}

/** Render bars of a track offline: through the master chain (mix checks), or
 * one raw stem with no master processing (stem files). */
async function render(track: TrackDef, startBar: number, seconds: number, stem?: Stem, rate = 44100) {
  const context = createOfflineContext(seconds, rate);
  const sequencer = new Sequencer(context, track, startBar, stem);
  const master = stem == null ? new Master(context) : null;
  if (master != null) sequencer.output.connect(master.input);
  else sequencer.output.toDestination();
  sequencer.start();
  // synchronous render: blocks the page but is much faster (build time and tests only)
  const buffer = await context.render(false);
  const data = buffer.getChannelData(0).slice();
  sequencer.dispose();
  master?.dispose();
  return data;
}

/** One stem of a whole track, exactly `trackBars` bars long, at RENDER_RATE.
 * This is what the build turns into the track's stem file. */
export async function renderStem(trackId: string, stem: Stem): Promise<Float32Array> {
  const track = trackOf(trackId);
  const seconds = (trackBars(track) * 240) / track.bpm;
  return render(track, 0, seconds, stem, RENDER_RATE);
}

function rms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

/** Kick check: low-pass the drums at ~150 Hz and compare the first 50 ms of
 * each bar with the 60 ms just before it. */
function kicks(drums: Float32Array, rate: number, barSeconds: number, bars: number): boolean[] {
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / rate);
  const low = new Float32Array(drums.length);
  let y = 0;
  for (let i = 0; i < drums.length; i++) {
    y += alpha * (drums[i] - y);
    low[i] = Math.abs(y);
  }
  const peak = (from: number, to: number) => {
    let p = 0;
    for (let i = Math.max(0, Math.floor(from * rate)); i < Math.min(low.length, to * rate); i++) {
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

/** Render `bars` bars of a track through the master chain and measure it
 * (PLAN §6.4). Runs in the browser; Node has no OfflineAudioContext. */
export async function renderOffline(trackId: string, bars = 4, startBar = 0): Promise<OfflineReport> {
  const track = trackOf(trackId);
  const barSeconds = 240 / track.bpm;
  const seconds = bars * barSeconds + 0.5;

  const mix = await render(track, startBar, seconds);
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
    const solo = await render(track, startBar, seconds, stem);
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
    kickOnBarStart: kicks(drums, 44100, barSeconds, bars),
  };
}

/** 16-bit PCM of a rendered stem as base64, for the build script to save. */
export function toPcm16Base64(data: Float32Array): string {
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)));
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
