// Day 2 XR check (node scripts/verify-console.mjs): in an emulated XR session
// with hands, poke Start, poke deck A's Bass pad and watch the bass leave on
// the next bar, poke it back, and stop/start deck A with PLAY.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

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
const armed = values(bassA, 'PerfPad');
// CLI round trips take ~2 s, about a bar, so the change may already be heard
const seen = music();
check('Bass pad armed after the poke (or already applied)', (armed.armed === true && armed.lit > 0.5) || seen.stemsA[1] === 0);
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
  const pad = values(bassA, 'PerfPad');
  check('pad shows off and no longer armed', pad.lit < 0.5 && pad.armed === false);
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

// 7. mixer by hand (Days 5-6): poke a knob to kill its band, poke the pad-mode
// and crossfader-end buttons, pinch-drag a channel fader
const knob = find('^Low A$');
press('Low A');
sleep(0.5);
check('poking the LOW knob kills the band', values(knob, 'Knob').killed === true);
press('Low A');
sleep(0.5);
check('poking it again brings the bass back', values(knob, 'Knob').killed === false);

press('Mode A Loop');
sleep(0.4);
check('LOOP mode button lights', values(find('^Mode A Loop$'), 'PushButton').lit === true);
press('Pad A Bass'); // the 2nd top pad is a 2-bar loop in LOOP mode
sleep(0.4);
check('in LOOP mode the 2nd pad starts a 2-bar loop', values(bassA, 'PerfPad').lit === 1);
press('Pad A Bass');
press('Mode A Stems');
sleep(0.4);
check('back in STEMS mode the pad shows the stem again', values(bassA, 'PerfPad').lit === 1 && values(find('^Mode A Stems$'), 'PushButton').lit === true);

press('Xf End B');
sleep(2);
const x1 = music().crossfader;
check('B end button glides the crossfader toward B', x1 > 0.2, `x = ${x1.toFixed(2)}`);
press('Xf End A');
sleep(4.5);
check('A end button glides it back', music().crossfader < x1 - 0.3, `x = ${music().crossfader.toFixed(2)}`);

// fader cap world position: console transform applied to the cap's local position
const scene = JSON.parse(fs.readFileSync(cwd + '/public/scenes/droproom.iwsdk.scene.json', 'utf8'));
const faderNode = scene.nodes.find((n) => n.id === 'console').children.find((n) => n.id === 'fader-a');
const ct = values(consoleIndex, 'Transform');
const toWorld = ([x, y, z]) => {
  const [qx, qy, qz, qw] = ct.orientation;
  // v' = v + w·t + q×t with t = 2·(q×v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return {
    x: ct.position[0] + x + qw * tx + (qy * tz - qz * ty),
    y: ct.position[1] + y + qw * ty + (qz * tx - qx * tz),
    z: ct.position[2] + z + qw * tz + (qx * ty - qy * tx),
  };
};
const [fx, fy] = faderNode.transform.position;
const { from, to } = faderNode.components.Fader;
const fader = find('^Fader A$');
// let go of anything the A/B pokes may have closed on (the crossfader sits beside them)
run(['xr', 'run-sequence'], { device: 'hand-right', steps: [{ pinch: 0, duration: 0.15 }, { anchor: 'wrist', position: { relativeTo: 'head', x: 0.15, y: -0.3, z: -0.25 } }] });
run(['xr', 'run-sequence'], {
  device: 'hand-right',
  steps: [
    // settle on the cap before pinching: at full frame rate a pinch made
    // while still arriving can miss it
    { label: 'reach fader', anchor: 'grasp', target: { name: 'Fader A' }, approach: { distance: 0.06 } },
    { label: 'pinch fader', pinch: 1, duration: 0.4 },
    // the emulated pinch holds the cap a little off-centre, so aim for the far end
    { label: 'drag down', position: toWorld([fx, fy, from]) },
  ],
}, 45000);
sleep(0.4);
const held = run(['ecs', 'query'], { entityIndex: fader, components: ['Grabbed', 'Fader'] }).components;
const fv = held.find((c) => c.componentId === 'Fader')?.values.value;
check('pinching the channel fader grabs it', held.some((c) => c.componentId === 'Grabbed'));
check('dragging it down turns the channel down', fv < 0.6, `value ${fv?.toFixed(2)}`);
run(['xr', 'run-sequence'], { device: 'hand-right', steps: [{ pinch: 0, duration: 0.15 }, { anchor: 'wrist', position: { relativeTo: 'head', x: 0.15, y: -0.3, z: -0.25 } }] });
const pos2 = values(fader, 'Transform').position;
check('released cap stays on its slot line (x, y locked)', Math.abs(pos2[0] - fx) < 0.001 && Math.abs(pos2[1] - fy) < 0.001, pos2.map((v) => v.toFixed(3)).join(', '));

// 8. turn a knob: press HI with a fingertip and slide 1.5 cm to the right in a
// straight line (run-sequence moves in arcs, which would lift the finger)
const hi = find('^Hi A$');
// deck A's knobs with the left hand, which reaches them without crossing DROP
run(['xr', 'run-sequence'], {
  device: 'hand-left',
  steps: [{ label: 'press HI', target: { name: 'Hi A', face: 'top' }, approach: { distance: 0.05 }, anchor: 'index-tip', poseId: 'point', offset: { normal: -0.004 } }],
}, 45000);
const tip = run(['xr', 'get-hand-state'], { device: 'hand-left' }).pin.target;
run(['xr', 'animate-to'], { device: 'hand-left', anchor: 'index-tip', position: { x: tip.x + 0.015, y: tip.y, z: tip.z }, duration: 0.6 });
run(['xr', 'animate-to'], { device: 'hand-left', anchor: 'index-tip', position: { x: tip.x + 0.015, y: tip.y + 0.08, z: tip.z }, duration: 0.3 });
sleep(0.4);
const turned = values(hi, 'Knob');
check('pressing HI and sliding right turns it up (no kill)', turned.value > 0.2 && turned.killed === false, `value ${turned.value.toFixed(2)}`);

console.log(`${results.filter(Boolean).length}/${results.length} passed`);
