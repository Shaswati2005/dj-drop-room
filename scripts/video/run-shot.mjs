// Shot driver for the demo video (node scripts/video/run-shot.mjs <shot-id|all> [--dry] [--no-setup]).
//   --dry       every `xr run-sequence` runs with dryRun:true (plans the motion, moves nothing);
//               waits, mutes and checks are skipped
//   --no-setup  skip the setup recipes (the page is already in the right state)
// Shots live in scripts/video/shots/*.json (built by build-shots.mjs). Prints PASS/FAIL for the
// shot's expectation, so a take can be re-shot until it does what the shot needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, emulatorDevice, evalInPage, probe, setEmulatorDevice, sh, sleep } from '../probes/day13-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
process.chdir(root);
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const noSetup = args.includes('--no-setup');
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const files = fs.readdirSync(path.join(here, 'shots')).filter((f) => f.endsWith('.json')).sort();
const wanted = files.filter((f) => which === 'all' || f.startsWith(which));
if (wanted.length === 0) {
  console.log(`FAIL no shot matches "${which}"`);
  process.exit(1);
}

const state = () => probe('scripts/probes/day13-shotstate.mjs', 60000);
const sequence = (seq, timeout = 90000) => {
  const input = dry ? { ...seq, dryRun: true } : seq;
  const j = cli('xr run-sequence', input, timeout);
  const r = j.data?.result ?? j;
  return { warnings: r.warnings ?? [], raw: r, ok: j.ok !== false && j.error == null };
};

const PREDICATES = {
  playing: (s) => s.running && s.A.playing,
  dropLanded: (s) => s.drops >= 1 && !s.dropping,
  stemsBack: (s) => s.A.stems.every((v) => v === 1) && s.moves >= 4,
  mirrorballOnB: (s) => s.B.trackId === 'mirrorball' && s.B.status === 'ready',
  faded: (s) => s.crossfader > 0.97,
  crossfaderA: (s) => s.crossfader < -0.97,
  concreteOnA: (s) => s.A.trackId === 'concrete' && s.A.status === 'ready',
  rainyOnB: (s) => s.B.trackId === 'rainy-tape' && s.B.status === 'ready',
  requestShown: (s) => s.requestShown,
  cardUp: (s) => s.cardUp,
  mixed: (s) => s.B.trackId === 'mirrorball' && s.B.playing && s.crossfader > 0.95,
  build: (s) => s.drops >= 1 && s.dim > 0.15,
  tour: (s) => s.B.trackId === 'rainy-tape' && s.B.playing && s.crossfader > 0.95,
  accessibility: (s) => s.reducedFlash && s.drops >= 1,
  glasses: (s) => s.drops >= 1,
};
const waitFor = (name, timeout) => {
  const end = Date.now() + timeout * 1000;
  do {
    if (PREDICATES[name](state())) return true;
    sleep(0.5);
  } while (Date.now() < end);
  return false;
};

function setup(items, shot) {
  for (const item of items) {
    if (item.startsWith('wait:')) {
      if (!dry) sleep(Number(item.slice(5)));
    } else if (item === 'reset') {
      sh('npx @iwsdk/cli xr exit --raw', 60000);
      probe('scripts/probes/day12-reset.mjs', 60000);
    } else if (item === 'seed-best') {
      evalInPage(`localStorage.setItem('dropRoom.best', JSON.stringify({ peakHype: 55, timeOnFire: 20, date: '2026-10-31' })); return true;`);
    } else if (item === 'enter') {
      sh('npx @iwsdk/cli browser reload --raw', 60000);
      sleep(8);
      for (let i = 0; i < 40; i++) {
        const j = cli('ecs find', { withComponents: ['PerfPad'] });
        if ((j.entities ?? j.data?.entities ?? []).length === 16) break;
        sleep(1);
      }
      cli('xr enter', {}, 60000);
      sleep(2);
      cli('xr set-device-state', {});
      cli('xr set-input-mode', { mode: 'hand' });
      sleep(1.5);
    } else if (item === 'unmute') {
      if (!dry) cli('browser set-muted', { muted: false });
    } else if (item === 'music') {
      if (!dry) evalInPage(`await en.start(); await until(() => en.update().A.playing, 15000); return true;`);
    } else if (item === 'onair-mirrorball-b') {
      if (!dry)
        evalInPage(`await en.start(); await until(() => en.update().A.playing, 15000);
          en.requestLoad('B', 'mirrorball'); await until(() => en.update().B.status === 'ready' && en.update().B.trackId === 'mirrorball', 20000);
          en.togglePlay('B'); await until(() => en.update().B.playing, 8000);
          en.setCrossfader(1); await sleep(300); en.togglePlay('A'); await sleep(500); return true;`);
    } else if (item === 'glasses-pose') {
      // seated, head pitched 35 degrees down at the console (headset at 1.6 m), both hands well clear of it
      cli('xr set-transform', { device: 'headset', orientation: { pitch: -35, yaw: 0, roll: 0 } });
      cli('xr set-transform', { device: 'hand-left', anchor: 'wrist', position: { x: -0.6, y: 1.5, z: -0.1 } });
      cli('xr set-transform', { device: 'hand-right', anchor: 'wrist', position: { x: 0.6, y: 1.5, z: -0.1 } });
    } else throw new Error(`unknown setup item ${item} in ${shot.id}`);
  }
}

function targetPosition(name) {
  const j = cli('xr list-targets');
  const list = j.targets ?? j.data?.result?.targets ?? j.result?.targets ?? [];
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`no target ${name}`);
  return t.position;
}

let allOk = true;
const originalDevice = emulatorDevice();
process.on('exit', () => {
  // never leave the glasses profile in the config
  try {
    if (emulatorDevice() !== originalDevice) setEmulatorDevice(originalDevice);
  } catch {}
});
for (const file of wanted) {
  const shot = JSON.parse(fs.readFileSync(path.join(here, 'shots', file), 'utf8'));
  console.log(`\n== ${shot.id}: ${shot.title}  [${shot.timing}]${dry ? '  (dry run)' : ''}`);
  const started = Date.now();
  let ok = true;
  if (!noSetup && shot.device !== emulatorDevice()) setEmulatorDevice(shot.device);
  if (!noSetup) setup(shot.setup, shot);
  for (const step of shot.steps) {
    if (step.seq) {
      const r = sequence(step.seq);
      const label = step.seq.steps?.[0]?.label ?? 'sequence';
      if (!r.ok) {
        ok = false;
        console.log(`FAIL sequence ${label}: ${JSON.stringify(r.raw).slice(0, 300)}`);
      } else console.log(`ok   ${dry ? 'dry-run ' : ''}${step.seq.device} ${label}${r.warnings.length ? `  warnings: ${JSON.stringify(r.warnings).slice(0, 160)}` : ''}`);
    } else if (dry) continue;
    else if (step.wait != null) sleep(step.wait);
    else if (step.waitFor) {
      const reached = waitFor(step.waitFor, step.timeout ?? 20);
      console.log(`${reached ? 'ok  ' : 'FAIL'} wait for ${step.waitFor}`);
      if (!reached) ok = false;
    } else if (step.mute != null) cli('browser set-muted', { muted: step.mute });
    else if (step.slide) {
      // press the knob with the fingertip, slide sideways by dx, lift, rest
      const { name, hand, dx } = step.slide;
      cli('xr run-sequence', { device: hand, steps: [{ target: { name, face: 'top' }, approach: { distance: 0.05 }, anchor: 'index-tip', poseId: 'point', offset: { normal: -0.004 } }] }, 45000);
      const hs = cli('xr get-hand-state', { device: hand });
      const tip = (hs.pin ?? hs.data?.result?.pin)?.target;
      cli('xr animate-to', { device: hand, anchor: 'index-tip', position: { x: tip.x + dx, y: tip.y, z: tip.z }, duration: 0.8, easing: 'minimum-jerk' });
      cli('xr animate-to', { device: hand, anchor: 'index-tip', position: { x: tip.x + dx, y: tip.y + 0.08, z: tip.z }, duration: 0.3, easing: 'minimum-jerk' });
      cli('xr run-sequence', { device: hand, steps: [{ pinch: 0, duration: 0.1 }, { anchor: 'wrist', position: { relativeTo: 'head', x: hand === 'hand-left' ? -0.35 : 0.35, y: -0.25, z: -0.05 } }] }, 45000);
      console.log(`ok   slide ${name} by ${dx} m`);
    } else if (step.ray) {
      // the glasses profile's gaze source is only used by the app with the gazeTracking feature (off:
      // it breaks fader pinch-grab), so the pointer is the far hand's ray
      const p = targetPosition(step.ray.name);
      cli('xr look-at', { device: step.ray.hand, target: { x: p.x, y: p.y + 0.01, z: p.z } });
      console.log(`ok   ray from ${step.ray.hand} at ${step.ray.name}`);
    } else if (step.pinch) {
      cli('xr select', { device: step.pinch.hand, duration: 0.15 });
      console.log(`ok   pinch ${step.pinch.hand}`);
    } else {
      console.log(`FAIL unknown step ${JSON.stringify(step).slice(0, 80)}`);
      ok = false;
    }
  }
  if (dry) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${shot.id} dry run planned`);
  } else {
    const s = state();
    const good = PREDICATES[shot.expect](s);
    ok = ok && good;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${shot.id} does what the shot needs (${shot.expect}) in ${Math.round((Date.now() - started) / 1000)} s`);
  }
  allOk &&= ok;
}
console.log(`\n${allOk ? 'PASS' : 'FAIL'} ${dry ? 'dry-ran' : 'ran'} ${wanted.length} shot(s)`);
process.exit(allOk ? 0 : 1);
