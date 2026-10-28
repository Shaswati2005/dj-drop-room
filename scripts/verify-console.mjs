// Day 2 XR check (node scripts/verify-console.mjs): in an emulated XR session
// with hands, poke Start, poke deck A's Bass pad and watch the bass leave on
// the next bar, poke it back, and stop/start deck A with PLAY.
import { execFileSync, spawn } from 'node:child_process';

const cwd = process.argv[2] ?? process.cwd();
const q = (s) => `'${JSON.stringify(s)}'`;
function run(args, input, timeout = 60000) {
  const full = ['@iwsdk/cli', ...args];
  if (input) full.push('--input-json', q(input));
  full.push('--raw', '--timeout', String(timeout));
  const out = execFileSync('npx ' + full.join(' '), { cwd, encoding: 'utf8', shell: 'bash', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}
const sleep = (s) => execFileSync(`sleep ${s}`, { shell: 'bash' });
const find = (name) => run(['ecs', 'find'], { namePattern: name }).entities[0].entityIndex;
const values = (index, component) =>
  run(['ecs', 'query'], { entityIndex: index, components: [component] }).components[0].values;
const press = (target, hold = 0.15) =>
  // press straight down onto the top face, as a person would; the default
  // face is the side facing the head, which pokes through the front row first
  run(['xr', 'run-sequence'], {
    device: 'hand-right',
    steps: [
      { label: target, target: { name: target, face: 'top' }, approach: { distance: 0.05 }, press: { hold } },
      { label: 'rest', position: { relativeTo: 'head', x: 0.15, y: -0.3, z: -0.25 } },
    ],
  });

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
};

run(['browser', 'reload']);
// the old page answers queries until the reload lands
sleep(6);
for (let i = 0; i < 40; i++) {
  try {
    if (run(['ecs', 'find'], { withComponents: ['StemPad'] }).entities.length === 8) break;
  } catch {}
  sleep(1);
}
try {
  run(['xr', 'enter']);
} catch {}
run(['xr', 'set-device-state'], {});
run(['xr', 'set-input-mode'], { mode: 'hand' });
sleep(1.5);

const state = find('^Music State$');
const consoleIndex = find('^Console$');
const bassA = find('^Pad A Bass$');
const music = () => values(state, 'MusicState');

// 1. console placed in front of and below the head
const head = run(['xr', 'get-transform'], { device: 'headset' }).position;
const pos = values(consoleIndex, 'Transform').position;
const below = head.y - pos[1];
const ahead = Math.hypot(pos[0] - head.x, pos[2] - head.z);
check('console sits 44 cm ahead, 45 cm below the head', Math.abs(ahead - 0.44) < 0.02 && Math.abs(below - 0.45) < 0.02,
  `ahead ${ahead.toFixed(3)} below ${below.toFixed(3)}`);
check('music not running before Start', music().audioRunning === false);

// 2. poke Start
press('Start Pad');
sleep(1.5);
let m = music();
check('poking Start starts the music', m.audioRunning === true && m.playingA === true, `bar ${m.bar}.${m.beat} ${m.sectionA}`);
check('all deck A stems on', m.stemsA.every((v) => v === 1), JSON.stringify(m.stemsA));

// 3. poke Bass while sampling: armed first, bass leaves on the next bar line
press('Pad A Bass');
const armed = values(bassA, 'StemPad');
// CLI round trips take ~2 s, about a bar, so the change may already be heard
const seen = music();
check('Bass pad armed after the poke (or already applied)', (armed.armed === true && armed.active === true) || seen.stemsA[1] === 0);
let off = null;
for (let i = 0; i < 20 && off == null; i++) {
  const s = music();
  if (s.stemsA[1] === 0) off = s;
  else sleep(0.2);
}
check('bass leaves', off != null);
if (off) {
  const t = JSON.parse(run(['browser', 'run', 'scripts/read-timing.mjs']).data.result);
  const wait = t.commitAt - t.pressAt;
  check('...applied exactly on the next bar line', Math.min(t.barPhase, 1 - t.barPhase) < 0.005 && wait > 0 && wait <= t.barSeconds + 0.2,
    `pressed at ${t.pressAt.toFixed(2)} s, applied at ${t.commitAt.toFixed(2)} s (bar = ${t.barSeconds.toFixed(2)} s, bar phase ${t.barPhase.toFixed(4)})`);
  const pad = values(bassA, 'StemPad');
  check('pad shows off and no longer armed', pad.active === false && pad.armed === false);
}

// 4. pad depress: hold a poke and screenshot mid-hold
const hold = spawn('npx @iwsdk/cli xr run-sequence --raw --input-json ' + q({ device: 'hand-right', steps: [{ target: { name: 'Pad A Melody', face: 'top' }, anchor: 'index-tip', poseId: 'point', offset: { normal: -0.009 } }, { label: 'hold', duration: 2.5 }, { target: { name: 'Pad A Melody', face: 'top' }, anchor: 'index-tip', offset: { normal: 0.06 } }] }), { cwd, shell: 'bash' });
sleep(3.2);
const shot = run(['browser', 'screenshot']);
await new Promise((r) => hold.on('exit', r));
console.log(`INFO mid-press screenshot: ${shot.screenshotPath ?? shot.data?.screenshotPath ?? JSON.stringify(shot).slice(0, 200)}`);

// 5. bass back on, melody (toggled by the hold) back on
press('Pad A Bass');
press('Pad A Melody');
sleep(2.6);
m = music();
check('all four stems back on, nothing else toggled', m.stemsA.every((v) => v === 1), JSON.stringify(m.stemsA));

// 6. PLAY stops deck A on the next bar and starts it again
press('Play A');
sleep(1);
const paused = music();
check('PLAY pauses deck A', paused.playingA === false);
press('Play A');
sleep(2.6);
m = music();
// the playhead moved on from the pause point (it may have wrapped into the outro loop)
check('PLAY resumes deck A', m.playingA === true && Math.abs(m.positionA - paused.positionA) > 0.5, `paused at ${paused.positionA.toFixed(2)} s, now ${m.positionA.toFixed(2)} s`);

console.log(`${results.filter(Boolean).length}/${results.length} passed`);
