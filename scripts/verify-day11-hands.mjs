// Day 11 hands check (node scripts/verify-day11-hands.mjs): in an emulated XR
// session, poke the six-slot crate shelf and HOLD the ECHO and SPACE pads with
// a fingertip the way a player would. Holding ramps the effect send up, releasing
// shuts it and leaves the tail ringing, then it decays; the presses land in the
// move log. The hold runs as a background command while the state is polled.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const cwd = process.argv[2] ?? process.cwd();
const q = (s) => `'${JSON.stringify(s)}'`;
function run(args, input, timeout = 60000) {
  const full = ['@iwsdk/cli', ...args];
  if (input) full.push('--input-json', q(input));
  full.push('--raw', '--timeout', String(timeout));
  return JSON.parse(execFileSync('npx ' + full.join(' '), { cwd, encoding: 'utf8', shell: 'bash', stdio: ['ignore', 'pipe', 'pipe'] }));
}
const sleep = (s) => execFileSync(`sleep ${s}`, { shell: 'bash' });
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
};
const probe = (name) => {
  const j = run(['browser', 'run', `scripts/probes/${name}.mjs`]);
  return JSON.parse(j.data?.result ?? j.result);
};

run(['browser', 'reload']);
sleep(6);
for (let i = 0; i < 40; i++) {
  try {
    if (run(['ecs', 'find'], { withComponents: ['PerfPad'] }).entities.length === 16) break;
  } catch {}
  sleep(1);
}
try {
  run(['xr', 'enter']);
} catch {}
run(['xr', 'set-device-state'], {});
run(['xr', 'set-input-mode'], { mode: 'hand' });
sleep(1.5);

const ids = {};
for (const c of ['PushButton', 'MusicState']) {
  for (const e of run(['ecs', 'find'], { withComponents: [c] }).entities) ids[e.name] = e.entityIndex;
}
const values = (name, component) => run(['ecs', 'query'], { entityIndex: ids[name], components: [component] }).components[0].values;
const music = () => values('Music State', 'MusicState');
const lit = (name) => values(name, 'PushButton').lit;
const handFor = (name) => (/\bA\b/.test(name) ? 'hand-left' : 'hand-right');
const REST = { 'hand-left': { x: -0.35, y: -0.25, z: -0.05 }, 'hand-right': { x: 0.35, y: -0.25, z: -0.05 } };
const sequence = (name, hold) => ({
  device: handFor(name),
  steps: [
    { label: name, target: { name, face: 'top' }, approach: { distance: 0.05 }, press: { hold } },
    { label: 'rest', anchor: 'wrist', position: { relativeTo: 'head', ...REST[handFor(name)] }, depart: { distance: 0.06 } },
  ],
});
// press.hold is capped at 0.2 s, so a long hold is a fingertip put 8 mm into the pad and left there
const holdSteps = (name, seconds) => [
  { label: name, target: { name, face: 'top' }, anchor: 'index-tip', poseId: 'point', approach: { distance: 0.05 }, offset: { normal: -0.008 } },
  { label: 'hold', duration: seconds },
  { label: 'rest', anchor: 'wrist', position: { relativeTo: 'head', ...REST[handFor(name)] }, depart: { distance: 0.06 } },
];
const press = (name) => run(['xr', 'run-sequence'], sequence(name, 0.15), 45000);
const until = (fn, seconds = 5) => {
  const end = Date.now() + seconds * 1000;
  do {
    if (fn()) return true;
  } while (Date.now() < end);
  return false;
};
const hasName = (n) => ids[n] != null;

// ---- the shelf: 12 load buttons for 6 tracks -------------------------------
const tracks = ['Warm Start', 'Concrete', 'Mirrorball', 'Rainy Tape', 'Airlock', 'Sunrise'];
check('crate shelf has 12 load buttons, REC and SHARE', tracks.every((t) => hasName(`Load ${t} A`) && hasName(`Load ${t} B`)) && hasName('Rec') && hasName('Share'));
const scene = JSON.parse(fs.readFileSync(cwd + '/public/scenes/droproom.iwsdk.scene.json', 'utf8'));
const consoleNode = scene.nodes.find((n) => n.id === 'console');
const crateNodes = consoleNode.children.filter((n) => /^(load-|rec$|share$)/.test(n.id));
check('crate buttons all sit inside +-0.30 m of the console centre', crateNodes.length === 14 && crateNodes.every((n) => Math.abs(n.transform.position[0]) <= 0.3), `${crateNodes.length} buttons, max |x| ${Math.max(...crateNodes.map((n) => Math.abs(n.transform.position[0]))).toFixed(3)}`);
// buttons keep a clear gap: same row >= 4.5 cm centre to centre, A and B rows >= 3.4 cm apart
const rows = {};
for (const n of crateNodes.filter((n) => n.id.startsWith('load-'))) (rows[n.transform.position[2].toFixed(3)] ??= []).push(n.transform.position[0]);
const pitch = Math.min(...Object.values(rows).map((xs) => Math.min(...xs.slice().sort((a, b) => a - b).map((x, i, a) => (i ? x - a[i - 1] : Infinity)))));
const rowGap = Math.min(...Object.keys(rows).map(Number).sort((a, b) => a - b).map((z, i, a) => (i ? z - a[i - 1] : Infinity)));
check('load buttons are well spaced (>= 7 cm along a row, >= 3.4 cm between rows)', Object.keys(rows).length === 2 && pitch >= 0.07 && rowGap >= 0.034, `pitch ${(pitch * 100).toFixed(1)} cm, rows ${(rowGap * 100).toFixed(1)} cm apart`);

press('Start Pad');
check('START starts the music', until(() => music().audioRunning && music().playingA, 8));
sleep(2);

// ---- hand-load the new tracks onto the idle deck B ---------------------------
press('Load Airlock B');
check('LOAD Airlock onto B works', until(() => music().trackB === 'airlock', 10), `B = ${music().trackB}`);
check('...and its button lights', until(() => lit('Load Airlock B')));
press('Load Sunrise B');
check('LOAD Sunrise onto B works', until(() => music().trackB === 'sunrise', 10), `B = ${music().trackB}`);

// ---- hold ECHO ----------------------------------------------------------------
for (const [pad, key, wetKey, outKey] of [['Fx Echo', 'echo', 'echoWet', 'echoOut'], ['Fx Space', 'space', 'spaceWet', 'spaceOut']]) {
  const name = pad.slice(3).toUpperCase();
  const logBefore = probe('day11-fx').moves;
  const child = spawn('npx', ['@iwsdk/cli', 'xr', 'run-sequence', '--input-json', q({ device: handFor(pad), steps: holdSteps(pad, 9) }), '--raw', '--timeout', '60000'], { cwd, shell: 'bash', stdio: 'ignore' });
  // the page itself watches for the hold and samples the ramp (CLI round trips are too slow for that)
  const watch = probe('day11-fx-watch').series;
  const held = watch[0][key];
  check(`${name}: held by the fingertip, the engine reports it held and the pad lights`, held && lit(pad));
  const wets = watch.map((s) => s[wetKey]);
  check(`${name}: the send rises while held (starts low, climbs towards 0.6)`, wets[0] < 0.5 && wets[wets.length - 1] > wets[0] + 0.1 && wets.every((v, i) => i === 0 || v >= wets[i - 1] - 1e-6), `${wets[0].toFixed(2)} -> ${wets[wets.length - 1].toFixed(2)}`);
  const peakOut = Math.max(...watch.map((s) => s[outKey]));
  check(`${name}: the return reaches the master while held`, peakOut > 0.003, `return ${peakOut.toFixed(4)}`);
  // wait for the finger to lift
  const released = until(() => !probe('day11-fx')[key], 25);
  check(`${name}: lifting the finger releases it`, released);
  const after = probe('day11-fx');
  check(`${name}: on release the send shuts (the tail itself is checked in verify-day11)`, after[wetKey] < 0.02, `wet ${after[wetKey].toFixed(3)}`);
  const logAfter = probe('day11-fx').moves;
  check(`${name}: press and release were logged`, logAfter >= logBefore + 2, `${logAfter - logBefore} moves`);
  child.kill();
}

try {
  run(['xr', 'exit']);
} catch {}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
