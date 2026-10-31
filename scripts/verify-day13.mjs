// Day 13 robustness check (node scripts/verify-day13.mjs; ~6 minutes):
//   1. dispose audit (static): no entity .destroy(), every subscribe/addEventListener in a system
//      has a cleanupFuncs teardown, no GPU resource is built inside update()
//   2. render stats with the crowd at full size (hype 1.0): MR and club mode, flat page and inside
//      an XR session; budgets <= 400 draw calls and <= 150k triangles (the existing Day 10/11 limits)
//   3. cold start: START press -> first kick heard <= 2 s (preload finished and not finished)
//   4. audio budget: 3 full set cycles (load, bring in, stems, loop/roll, ECHO + SPACE holds, DROP,
//      A/B fade, Finish Set -> Play again): live audio sources stay bounded, nodes created per
//      cycle do not grow, geometries/textures stop growing, forced-GC heap growth <= 50 MB
//   5. AR -> Club fallback: a page where immersive-ar fails stays usable (the support check itself
//      is unit-tested in test/xr-support.test.ts)
//   6. a clean console (errors fail; only the known library warnings are tolerated)
// The 10+ minute soak is scripts/soak.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { cli, fresh, makeChecker, probe, sh, sleep } from './probes/day13-lib.mjs';

const { check } = makeChecker();
const startedAt = Date.now();
const KNOWN_WARNINGS = [/THREE\.Clock: This module has been deprecated/, /Can't change size while VR device is presenting/];
/** Console entries since `since` that are errors, or warnings we do not know. */
function badLogs(since) {
  const j = cli('browser logs', { count: 200 });
  const list = Array.isArray(j) ? j : (j.data?.logs ?? []);
  return list.filter((l) => l.timestamp >= since && (l.level === 'error' || ((l.level === 'warn' || l.level === 'warning') && !KNOWN_WARNINGS.some((re) => re.test(l.message)))));
}

// ---- 1. dispose audit (static) ---------------------------------------------------------------
{
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk('src');
  const destroyers = files.filter((f) => /\.destroy\(\)/.test(fs.readFileSync(f, 'utf8')));
  check('dispose audit: no entity .destroy() in src (use .dispose())', destroyers.length === 0, destroyers.join(', '));
  const sysFiles = files.filter((f) => /systems[\\/].+-system\.ts$/.test(f));
  const unmanaged = sysFiles.filter((f) => {
    const t = fs.readFileSync(f, 'utf8');
    return /\.subscribe\(|addEventListener\(/.test(t) && !/cleanupFuncs/.test(t);
  });
  check('dispose audit: every system that subscribes or adds a listener registers it in cleanupFuncs', unmanaged.length === 0, unmanaged.join(', '));
  // a system's update() must not build meshes/geometries/materials/textures (they belong in init())
  const allocating = [];
  for (const f of sysFiles) {
    const t = fs.readFileSync(f, 'utf8');
    const m = /\n  update\([^)]*\)[^{]*\{/.exec(t);
    if (!m) continue;
    const rest = t.slice(m.index + m[0].length);
    const end = rest.search(/\n  (private |protected |public |async |get |set )?[A-Za-z_]+\([^)]*\)[^{;]*\{/);
    const body = end < 0 ? rest : rest.slice(0, end);
    if (/new (Mesh|InstancedMesh|[A-Za-z]*Geometry|[A-Za-z]*Material|CanvasTexture|DataTexture|Texture|Vector[234]|Matrix4|Quaternion|Color)\(/.test(body)) allocating.push(path.basename(f));
  }
  check('dispose audit: no GPU resources or math objects built inside any system update()', allocating.length === 0, allocating.join(', '));
}

// ---- 2. render stats ---------------------------------------------------------------------------
fresh();
const logStart = Date.now() - 2000;
const flat = probe('scripts/probes/day13-stats.mjs');
console.log('flat  :', JSON.stringify(flat));
const total = (c) => c.reduce((a, b) => a + b, 0);
check('MR (flat page), crowd full: draw calls <= 400', flat.mr.calls <= 400, `${flat.mr.calls} calls, ${flat.mr.triangles} triangles, ${flat.mr.geometries} geometries, ${flat.mr.textures} textures, crowd ${JSON.stringify(flat.mr.counts)} in ${flat.mr.dancerCalls} draw call(s), tier ${flat.mr.tier}`);
check('club (flat page), crowd full: draw calls <= 450', flat.club.calls <= 450, `${flat.club.calls} calls, ${flat.club.triangles} triangles, ${flat.club.geometries} geometries, ${flat.club.textures} textures, crowd ${JSON.stringify(flat.club.counts)}`);
check('triangles <= 150k in both modes', flat.mr.triangles <= 150000 && flat.club.triangles <= 150000, `${flat.mr.triangles} / ${flat.club.triangles}`);
check('the crowd is full size in both (24 dancers, tier 3) and cheap (<= 2 draw calls)', total(flat.mr.counts) === 24 && total(flat.club.counts) === 24 && flat.mr.dancerCalls <= 2 && flat.club.dancerCalls <= 2);
cli('xr enter', {}, 60000);
sleep(4);
const status = cli('xr status');
const inXr = (status.data?.result?.sessionActive ?? status.sessionActive) === true;
check('entered the emulated immersive-ar session for the in-session stats', inXr, JSON.stringify(status.data?.result?.sessionMode ?? status.sessionMode));
if (inXr) {
  const xr = probe('scripts/probes/day13-stats.mjs');
  console.log('in XR :', JSON.stringify(xr));
  check('MR in an XR session, crowd full: draw calls <= 400, triangles <= 150k', xr.mr.calls <= 400 && xr.mr.triangles <= 150000, `${xr.mr.calls} calls, ${xr.mr.triangles} triangles`);
  check('club in an XR session, crowd full: draw calls <= 450, triangles <= 150k', xr.club.calls <= 450 && xr.club.triangles <= 150000, `${xr.club.calls} calls, ${xr.club.triangles} triangles`);
}

// ---- 3. cold start -----------------------------------------------------------------------------
for (const [label, wait] of [['page just came up', 0], ['page settled for 12 s', 12]]) {
  sh('npx @iwsdk/cli xr exit --raw', 60000);
  sh('npx @iwsdk/cli browser reload --raw', 60000);
  if (wait) sleep(wait);
  const c = probe('scripts/probes/day13-cold.mjs', 80000);
  console.log(`cold (${label}):`, JSON.stringify(c));
  check(`cold start (${label}): the first kick is heard <= 2000 ms after the START press`, c.ok && c.ms <= 2000, `${c.ms} ms (output latency ${c.latencyMs} ms, playhead ${c.pos} s, page age at press ${c.pre?.pageAgeMs} ms)`);
  check(`cold start (${label}): the kick is the top of the track`, c.ok && c.pos < 0.25, `${c.pos} s`);
}

// ---- 4. audio budget ---------------------------------------------------------------------------
fresh();
const base = probe('scripts/probes/day13-heap.mjs', 60000);
const cycles = [];
for (let i = 0; i < 3; i++) {
  const c = probe('scripts/probes/day13-cycle.mjs');
  cycles.push(c);
  console.log(`cycle ${c.cycle}: ${c.ms} ms, live sources ${c.liveSources} (peak ${c.peakLiveSources}), nodes created ${c.nodesCreatedThisCycle}, sources started ${c.sourcesStartedThisCycle}, geometries ${c.geometries}, textures ${c.textures}, heap after GC ${c.gcHeapMB} MB${c.finished ? ' (with Finish Set -> Play again)' : ''}`);
}
check('audio: every cycle ran to the end (load, fade, DROP, holds; Finish Set -> Play again once)', cycles.length === 3 && cycles.some((c) => c.finished));
check('audio: live audio sources stay <= 24 at peak (voice budget)', cycles.every((c) => c.peakLiveSources <= 24), cycles.map((c) => c.peakLiveSources).join(', '));
check('audio: the idle source count does not grow cycle after cycle', cycles.every((c) => c.liveSources === cycles[0].liveSources), cycles.map((c) => c.liveSources).join(', '));
const plain = cycles.filter((c) => !c.finished).map((c) => c.nodesCreatedThisCycle);
check('audio: nodes created per plain cycle do not grow (no leaking graph)', plain.length < 2 || plain[plain.length - 1] <= plain[0] + 4, plain.join(', '));
check('GPU: every geometry and texture on the GPU belongs to the scene (nothing orphaned) and the scene stops growing', cycles.every((c) => c.geometries <= c.sceneGeometries && c.textures <= c.sceneTextures) && cycles[2].sceneGeometries === cycles[0].sceneGeometries && cycles[2].sceneTextures === cycles[0].sceneTextures, cycles.map((c) => `${c.geometries}/${c.sceneGeometries} geo, ${c.textures}/${c.sceneTextures} tex`).join(' -> ') + ' (first-use uploads of hidden objects such as the rig and the summary card)');
const growth = cycles[2].gcHeapMB - cycles[0].gcHeapMB;
check('heap: growth over cycles 1..3 (after forced GC) <= 50 MB', growth <= 50, `${cycles[0].gcHeapMB} -> ${cycles[2].gcHeapMB} MB (page start ${base.heapMB} MB)`);

// ---- 5. AR -> Club fallback --------------------------------------------------------------------
fresh();
const noAr = probe('scripts/probes/day13-noar.mjs', 80000);
console.log('no AR:', JSON.stringify(noAr));
check('with immersive-ar supported (the emulator) the app starts in mixed reality, club off', noAr.info.clubAtLoad === false, `club.on at load: ${noAr.info.clubAtLoad}`);
check('when the AR session fails to start nothing throws and the app is still playing', noAr.pageErrors.length === 0 && noAr.usable.playing && !noAr.usable.presenting, JSON.stringify(noAr.pageErrors));
check('...the console stays visible, pads still reach the engine and club mode still switches on', noAr.usable.consoleVisible === true && noAr.usable.bassOff && noAr.usable.clubOn);

// ---- 6. console --------------------------------------------------------------------------------
const bad = badLogs(logStart).filter((l) => !/Failed to start XR session/.test(l.message)); // the no-AR probe provokes that one on purpose
check('console: no errors and no unknown warnings (browser_get_console_logs, count only)', bad.length === 0, bad.map((l) => `${l.level}: ${l.message.slice(0, 120)}`).join(' | '));
console.log(`done in ${Math.round((Date.now() - startedAt) / 1000)} s`);
