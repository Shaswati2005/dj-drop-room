// Every-control sweep (node scripts/verify-all-controls.mjs): in an emulated XR
// session with hands, operate each of the console's 51 controls the way a
// player would (poke, press-and-slide, pinch-drag, pinch-twist) and check that
// each one changes the engine. Deck A is worked with the left hand, deck B and
// the centre with the right.
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

// name → entity index for every control
const ids = {};
for (const c of ['PushButton', 'PerfPad', 'Knob', 'Fader', 'JogWheel', 'MusicState', 'ConsoleRoot']) {
  for (const e of run(['ecs', 'find'], { withComponents: [c] }).entities) ids[e.name] = e.entityIndex;
}
const values = (name, component) => run(['ecs', 'query'], { entityIndex: ids[name], components: [component] }).components[0].values;
const music = () => values('Music State', 'MusicState');
const lit = (name) => values(name, 'PushButton').lit;
const handFor = (name) => (/\bA\b/.test(name) && name !== 'Xf End B' ? 'hand-left' : 'hand-right');
// hands parked out to the sides and back, well clear of the pads (resting
// over the console let a fingertip graze the Chords pads)
const REST = { 'hand-left': { x: -0.35, y: -0.25, z: -0.05 }, 'hand-right': { x: 0.35, y: -0.25, z: -0.05 } };
const rest = (hand) => run(['xr', 'run-sequence'], { device: hand, steps: [{ pinch: 0, duration: 0.1 }, { anchor: 'wrist', position: { relativeTo: 'head', ...REST[hand] } }] });
const press = (name) =>
  run(['xr', 'run-sequence'], {
    device: handFor(name),
    steps: [
      { label: name, target: { name, face: 'top' }, approach: { distance: 0.05 }, press: { hold: 0.15 } },
      // lift straight off the control first, as a real tap does, so the way back
      // to rest cannot graze a neighbouring pad
      { label: 'rest', anchor: 'wrist', position: { relativeTo: 'head', ...REST[handFor(name)] }, depart: { distance: 0.06 } },
    ],
  }, 45000);
/** Poll `fn` (CLI round trips ~1 s) until it returns true or `seconds` pass. */
const until = (fn, seconds = 4) => {
  const end = Date.now() + seconds * 1000;
  do {
    if (fn()) return true;
  } while (Date.now() < end);
  return false;
};

// console transform: scene-local → world
const scene = JSON.parse(fs.readFileSync(cwd + '/public/scenes/droproom.iwsdk.scene.json', 'utf8'));
const consoleNode = scene.nodes.find((n) => n.id === 'console');
const ct = values('Console', 'Transform');
const toWorld = ([x, y, z]) => {
  const [qx, qy, qz, qw] = ct.orientation;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return {
    x: ct.position[0] + x + qw * tx + (qy * tz - qz * ty),
    y: ct.position[1] + y + qw * ty + (qz * tx - qx * tz),
    z: ct.position[2] + z + qw * tz + (qx * ty - qy * tx),
  };
};

// ── transport ──
press('Start Pad');
check('START starts the music', until(() => music().audioRunning && music().playingA), '');
press('Play B');
check('PLAY B starts deck B', until(() => music().playingB));
press('Play A');
check('PLAY A pauses deck A', until(() => !music().playingA));
press('Play A');
check('PLAY A resumes deck A', until(() => music().playingA));
press('Cue A');
check('CUE A (playing) returns to the cue point and stops', until(() => !music().playingA && lit('Cue A')), `at ${music().positionA.toFixed(2)} s`);
press('Play A');
until(() => music().playingA);
press('Sync B');
check('SYNC B matches deck B to deck A', until(() => Math.abs(music().bpmB - music().bpmA) < 0.01 && lit('Sync B')), `${music().bpmA.toFixed(2)} / ${music().bpmB.toFixed(2)}`);
press('Sync A');
check('SYNC A lights (tempos already matched)', until(() => lit('Sync A')));

// ── pads, STEMS mode: top row toggles a stem on the next bar, bottom row solos ──
const STEMS = ['Drums', 'Bass', 'Chords', 'Melody'];
for (const deck of ['A', 'B']) {
  const stems = () => music()[`stems${deck}`];
  for (let i = 0; i < 4; i++) {
    const pad = `Pad ${deck} ${STEMS[i]}`;
    press(pad);
    const off = until(() => stems()[i] === 0, 5);
    press(pad);
    const on = until(() => stems()[i] === 1, 5);
    check(`${pad} mutes then brings back its stem`, off && on, `off=${off} on=${on} stems=${stems().join("")}`);
  }
  for (let i = 0; i < 4; i++) {
    const pad = `Pad ${deck} ${i + 5}`;
    press(pad);
    const solo = until(() => stems().every((v, j) => v === (j === i ? 1 : 0)), 5);
    press(pad);
    const all = until(() => stems().every((v) => v === 1), 5);
    check(`${pad} solos ${STEMS[i]}, then un-solos`, solo && all);
  }
}

// ── pad modes: HOT CUES and LOOP ──
for (const deck of ['A', 'B']) {
  const padLit = (n) => values(`Pad ${deck} ${n}`, 'PerfPad').lit;
  press(`Mode ${deck} Cues`);
  check(`MODE ${deck} HOT CUES lights`, until(() => lit(`Mode ${deck} Cues`) && !lit(`Mode ${deck} Stems`)));
  const dim = padLit('Drums');
  press(`Pad ${deck} Drums`);
  check(`HOT CUE 1 on deck ${deck} is set (pad lights)`, until(() => padLit('Drums') > dim + 0.3), `lit ${dim.toFixed(2)} → ${padLit('Drums').toFixed(2)}`);
  press(`Pad ${deck} 5`);
  check(`bottom pad deletes HOT CUE 1 on deck ${deck}`, until(() => padLit('Drums') <= dim + 0.05));
  press(`Mode ${deck} Loop`);
  check(`MODE ${deck} LOOP lights`, until(() => lit(`Mode ${deck} Loop`)));
  const before = padLit('Bass');
  press(`Pad ${deck} Bass`);
  check(`LOOP pad 2 on deck ${deck} starts a 2-bar loop (pad lights)`, until(() => padLit('Bass') > before + 0.3));
  press(`Pad ${deck} Bass`);
  check(`LOOP pad 2 again exits the loop`, until(() => padLit('Bass') <= before + 0.05));
  press(`Mode ${deck} Stems`);
  check(`MODE ${deck} STEMS lights`, until(() => lit(`Mode ${deck} Stems`)));
}

// ── FX, crossfader ends, DROP ──
// ECHO and SPACE are hold pads (day 11): lit while the finger stays down, off on release
for (const fx of ['Fx Echo', 'Fx Space']) {
  const child = spawn('npx', ['@iwsdk/cli', 'xr', 'run-sequence', '--input-json', q({
    device: handFor(fx),
    // press.hold is capped at 0.2 s: a long hold is a fingertip 8 mm into the pad, left there
    steps: [
      { label: fx, target: { name: fx, face: 'top' }, anchor: 'index-tip', poseId: 'point', approach: { distance: 0.05 }, offset: { normal: -0.008 } },
      { label: 'hold', duration: 6 },
      { label: 'rest', anchor: 'wrist', position: { relativeTo: 'head', ...REST[handFor(fx)] }, depart: { distance: 0.06 } },
    ],
  }), '--raw', '--timeout', '60000'], { cwd, shell: 'bash', stdio: 'ignore' });
  const on = until(() => lit(fx), 10);
  // the press ends after ~6 s; the child cannot be awaited while the loop is blocked, so wait it out
  const off = until(() => !lit(fx), 20);
  sleep(2);
  child.kill();
  check(`${fx.slice(3).toUpperCase()} lights while held and goes dark on release`, on && off);
}
press('Xf End B');
check('crossfader B-end glides to deck B', until(() => music().crossfader > 0.95, 10), `x = ${music().crossfader.toFixed(2)}`);
press('Xf End A');
check('crossfader A-end glides back to deck A', until(() => music().crossfader < -0.95, 10), `x = ${music().crossfader.toFixed(2)}`);
// the button is lit for only ~3 s, too short to poll reliably: count landings
const dropsBefore = music().drops;
press('Drop');
check('DROP charges (riser) and then lands', until(() => music().drops > dropsBefore, 8), `drops ${dropsBefore} → ${music().drops}`);

// ── knobs: press and slide right 1.5 cm, then tap ──
for (const deck of ['A', 'B']) {
  const hand = deck === 'A' ? 'hand-left' : 'hand-right';
  for (const k of ['Trim', 'Hi', 'Mid', 'Low', 'Filter']) {
    const name = `${k} ${deck}`;
    run(['xr', 'run-sequence'], {
      device: hand,
      steps: [{ target: { name, face: 'top' }, approach: { distance: 0.05 }, anchor: 'index-tip', poseId: 'point', offset: { normal: -0.004 } }],
    }, 45000);
    const tip = run(['xr', 'get-hand-state'], { device: hand }).pin.target;
    run(['xr', 'animate-to'], { device: hand, anchor: 'index-tip', position: { x: tip.x + 0.015, y: tip.y, z: tip.z }, duration: 0.6 });
    run(['xr', 'animate-to'], { device: hand, anchor: 'index-tip', position: { x: tip.x + 0.015, y: tip.y + 0.08, z: tip.z }, duration: 0.3 });
    const turned = until(() => values(name, 'Knob').value > 0.2, 2);
    check(`${name.toUpperCase()} turns up with a slide`, turned, `value ${values(name, 'Knob').value.toFixed(2)}`);
    rest(hand);
    press(name);
    if (k === 'Trim' || k === 'Filter') {
      check(`${name.toUpperCase()} tap snaps back to centre`, until(() => values(name, 'Knob').value === 0));
    } else {
      const killed = until(() => values(name, 'Knob').killed);
      press(name);
      check(`${name.toUpperCase()} tap kills the band, tap again restores`, killed && until(() => !values(name, 'Knob').killed));
    }
  }
}

// ── faders: pinch the cap and drag along its slot ──
const nodeOf = (id) => consoleNode.children.find((n) => n.id === id);
const drag = (name, id, toEnd, hand) => {
  const node = nodeOf(id);
  const [x, y, z] = node.transform.position;
  const { from, to } = node.components.Fader;
  const target = name === 'Crossfader' ? [toEnd === 'to' ? to : from, y, z] : [x, y, toEnd === 'to' ? to : from];
  rest(hand);
  run(['xr', 'run-sequence'], {
    device: hand,
    steps: [
      // settle on the cap before pinching: at full frame rate a pinch made
      // while still arriving can miss it
      { label: `reach ${name}`, anchor: 'grasp', target: { name }, approach: { distance: 0.06 } },
      { label: `pinch ${name}`, pinch: 1, duration: 0.4 },
      { label: 'drag', position: toWorld(target) },
    ],
  }, 45000);
  sleep(0.3);
  const grabbed = run(['ecs', 'query'], { entityIndex: ids[name], components: ['Grabbed'] }).components.length > 0;
  rest(hand);
  return grabbed;
};
for (const [name, id, hand, end, test, label] of [
  ['Fader A', 'fader-a', 'hand-left', 'from', (v) => v < 0.6, 'channel A fader down lowers deck A'],
  ['Fader A', 'fader-a', 'hand-left', 'to', (v) => v > 0.8, 'channel A fader back up'],
  ['Fader B', 'fader-b', 'hand-right', 'from', (v) => v < 0.6, 'channel B fader down lowers deck B'],
  ['Fader B', 'fader-b', 'hand-right', 'to', (v) => v > 0.8, 'channel B fader back up'],
  ['Tempo A', 'tempo-a', 'hand-left', 'to', (v) => v > 0.3, 'TEMPO A fader speeds deck A up'],
  ['Tempo B', 'tempo-b', 'hand-right', 'from', (v) => v < -0.3, 'TEMPO B fader slows deck B down'],
  ['Crossfader', 'crossfader', 'hand-right', 'to', (v) => v > 0.3, 'crossfader drag toward B'],
]) {
  const grabbed = drag(name, id, end, hand);
  const v = values(name, 'Fader').value;
  check(label, grabbed && test(v), `grabbed ${grabbed}, value ${v.toFixed(2)}`);
}

// ── jog wheels: pinch the platter and twist the hand 60° ──
for (const [deck, hand] of [['A', 'hand-left'], ['B', 'hand-right']]) {
  // a paused deck shows a jog turn as a playhead move
  if (music()[`playing${deck}`]) press(`Play ${deck}`);
  until(() => !music()[`playing${deck}`]);
  const p0 = music()[`position${deck}`];
  rest(hand);
  run(['xr', 'run-sequence'], {
    device: hand,
    steps: [{ target: { name: `Jog ${deck}`, face: 'top' }, approach: { distance: 0.06 }, pinch: { value: 1, at: 'arrival' } }],
  }, 45000);
  const g = run(['xr', 'get-hand-state'], { device: hand }).pin.target;
  run(['xr', 'animate-to'], { device: hand, anchor: 'grasp', position: g, orientation: { fingers: [-0.85, -0.5, 0], palm: 'down' }, duration: 0.8 });
  sleep(0.3);
  const p1 = music()[`position${deck}`];
  rest(hand);
  check(`JOG ${deck} twist moves a paused track`, Math.abs(p1 - p0) > 0.05, `${p0.toFixed(2)} → ${p1.toFixed(2)} s`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
for (const r of results) if (!r.ok) console.log('  failed:', r.label);
