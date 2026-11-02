// Soak test (node scripts/soak.mjs [minutes]; default 10). NOT part of verify-everything.
// Plays an automated set on a fresh page for the given time: every cycle loads the next track on
// the off-air deck, brings it in on the bar, plays stems / loop / roll / filter, holds ECHO and
// SPACE, DROPs, A/B-fades across and retires the old deck; every third cycle also runs
// Finish Set -> Play again. After every cycle the JS heap is read after a forced GC.
// Asserts: heap growth (last sample vs the sample after cycle 1) <= 50 MB, live audio sources
// stay bounded and do not grow, GPU resources stay attributable to the scene and the scene does
// not grow, and the console has no errors and no unknown warnings (browser_get_console_logs).
import { cli, fresh, makeChecker, probe } from './probes/day13-lib.mjs';

const minutes = Number(process.argv[2] ?? 10);
const { check } = makeChecker();
const KNOWN_WARNINGS = [/THREE\.Clock: This module has been deprecated/, /Can't change size while VR device is presenting/];
const bad = [];
let logsSeen = 0;
function sweepLogs(since) {
  const j = cli('browser logs', { count: 200 });
  const list = Array.isArray(j) ? j : (j.data?.logs ?? []);
  logsSeen = Math.max(logsSeen, list.length);
  for (const l of list) {
    if (l.timestamp < since || bad.some((b) => b.timestamp === l.timestamp && b.message === l.message)) continue;
    if (l.level === 'error' || ((l.level === 'warn' || l.level === 'warning') && !KNOWN_WARNINGS.some((re) => re.test(l.message)))) bad.push(l);
  }
}

fresh();
// Every `browser run` costs the page heap by itself (the page keeps each evaluated script while
// DevTools is attached), and the cost grows with the script's size: ~1.4 MB for the small heap
// probe but ~2.4 MB for the cycle script. So calibrate with the cycle script itself in its no-op
// mode, then report growth both raw and with that drift removed.
for (let i = 0; i < 2; i++) probe('scripts/probes/day13-cycle.mjs'); // music running, first loads done
probe('scripts/probes/day13-noop-on.mjs', 60000);
const calibration = [];
for (let i = 0; i < 8; i++) calibration.push(probe('scripts/probes/day13-cycle.mjs', 60000).gcHeapMB);
probe('scripts/probes/day13-noop-off.mjs', 60000);
const drift = (calibration[calibration.length - 1] - calibration[0]) / (calibration.length - 1);
console.log(`harness drift with the app idle: ${calibration.join(' ')} MB => ${drift.toFixed(2)} MB per browser run`);
const t0 = Date.now();
const since = t0 - 1000;
const samples = [];
while (Date.now() - t0 < minutes * 60000) {
  const c = probe('scripts/probes/day13-cycle.mjs');
  samples.push({ cycle: c.cycle, t: Math.round((Date.now() - t0) / 1000), heap: c.gcHeapMB, live: c.liveSources, peak: c.peakLiveSources, geos: c.geometries, texs: c.textures, sceneGeos: c.sceneGeometries, sceneTexs: c.sceneTextures, nodes: c.nodesCreatedThisCycle, finished: c.finished });
  const s = samples[samples.length - 1];
  console.log(`t=${String(s.t).padStart(4)} s  cycle ${String(s.cycle).padStart(2)}  heap(GC) ${s.heap} MB  live sources ${s.live} (peak ${s.peak})  GPU ${s.geos}/${s.sceneGeos} geo ${s.texs}/${s.sceneTexs} tex  nodes ${s.nodes}${s.finished ? '  [finish -> play again]' : ''}`);
  sweepLogs(since);
}
const seconds = Math.round((Date.now() - t0) / 1000);
const first = samples[0];
const last = samples[samples.length - 1];
const maxHeap = Math.max(...samples.map((s) => s.heap));
console.log(`soak ran ${seconds} s (${(seconds / 60).toFixed(1)} min), ${samples.length} set cycles, ${samples.filter((s) => s.finished).length} Finish Set -> Play again`);
check(`soak ran at least ${minutes} minutes`, seconds >= minutes * 60, `${seconds} s`);
const runs = samples.length - 1;
const corrected = (s) => s.heap - first.heap - drift * (s.cycle - first.cycle);
// A leak raises the heap FLOOR. Single high samples that are gone by the next cycle (seen around
// Finish Set -> Play again: stopping sources can still hold the old stems when the GC runs) are
// transients: reported, bounded by the peak check, but not counted as growth. So growth compares
// floors (the lowest sample of a window), never one sample against another.
const floor = (list) => Math.min(...list.map(corrected));
const appGrowth = floor(samples.slice(-6)) - floor(samples.slice(0, 6));
console.log(`heap after forced GC: ${first.heap} -> ${last.heap} MB raw (${(last.heap - first.heap).toFixed(1)} MB); harness drift over ${runs} runs ${(drift * runs).toFixed(1)} MB; app floor growth ${appGrowth.toFixed(1)} MB`);
check('JS heap floor growth (after forced GC, harness drift removed) <= 50 MB, first 6 cycles vs last 6', appGrowth <= 50, `${appGrowth.toFixed(1)} MB over ${(seconds / 60).toFixed(1)} min (raw ${(last.heap - first.heap).toFixed(1)} MB)`);
// the heap holds the decoded stems of the tracks on the decks (Rainy Tape, at 86 BPM, is the longest and
// is ~45 MB heavier than the others), so also compare the same point of the 6-track rotation: the floor
// of each point over the first two rotations against its floor over the last two
const lateFrom = Math.max(0, Math.floor((samples.length - 12) / 6) * 6);
let worstPoint = -Infinity;
for (let p = 0; p < 6; p++) {
  const early = samples.filter((s, i) => i % 6 === p && i < 12);
  const late = samples.filter((s, i) => i % 6 === p && i >= lateFrom);
  if (early.length && late.length) worstPoint = Math.max(worstPoint, floor(late) - floor(early));
}
check('...and the floor at the same point of the track rotation (first two rotations vs last two) grows by <= 50 MB', worstPoint <= 50, `worst ${worstPoint.toFixed(1)} MB`);
const transients = samples.filter((s, i) => i > 0 && i < samples.length - 1 && s.heap - Math.min(samples[i - 1].heap, samples[i + 1].heap) > 100);
console.log(`transient spikes (> 100 MB above both neighbours, gone by the next cycle): ${transients.length ? transients.map((s) => `cycle ${s.cycle} ${s.heap} MB${s.finished ? ' [finish]' : ''}`).join(', ') : 'none'}`);
check('peak JS heap <= 900 MB (two decks of decoded stems plus a load in flight)', maxHeap <= 900, `${maxHeap} MB`);
check('live audio sources bounded (<= 24 peak) and flat when idle', samples.every((s) => s.peak <= 24 && s.live === first.live), `peak ${Math.max(...samples.map((s) => s.peak))}, idle ${[...new Set(samples.map((s) => s.live))].join('/')}`);
check('GPU resources belong to the scene and the scene did not grow', samples.every((s) => s.geos <= s.sceneGeos && s.texs <= s.sceneTexs && s.sceneGeos === first.sceneGeos && s.sceneTexs === first.sceneTexs), `${last.geos}/${last.sceneGeos} geo, ${last.texs}/${last.sceneTexs} tex`);
check('console: no errors and no unknown warnings over the whole soak (count-only log reads)', bad.length === 0, bad.map((l) => `${l.level}: ${l.message.slice(0, 120)}`).join(' | '));
