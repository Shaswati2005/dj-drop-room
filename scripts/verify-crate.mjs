// Day 9 hands check (node scripts/verify-crate.mjs): in an emulated XR session,
// poke the crate shelf the way a player would. Load buttons put a track on a
// deck, a load onto a playing deck is refused (the music keeps playing), REC
// starts and stops a recording that leaves a non-empty file, SHARE builds the
// set link. Deck A is worked with the left hand, everything else with the right.
import { execFileSync } from 'node:child_process';
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

const ids = {};
for (const c of ['PushButton', 'MusicState', 'ConsoleRoot']) {
  for (const e of run(['ecs', 'find'], { withComponents: [c] }).entities) ids[e.name] = e.entityIndex;
}
const values = (name, component) => run(['ecs', 'query'], { entityIndex: ids[name], components: [component] }).components[0].values;
const music = () => values('Music State', 'MusicState');
const lit = (name) => values(name, 'PushButton').lit;
const handFor = (name) => (/\bA\b/.test(name) ? 'hand-left' : 'hand-right');
const REST = { 'hand-left': { x: -0.35, y: -0.25, z: -0.05 }, 'hand-right': { x: 0.35, y: -0.25, z: -0.05 } };
const press = (name) =>
  run(['xr', 'run-sequence'], {
    device: handFor(name),
    steps: [
      { label: name, target: { name, face: 'top' }, approach: { distance: 0.05 }, press: { hold: 0.15 } },
      { label: 'rest', anchor: 'wrist', position: { relativeTo: 'head', ...REST[handFor(name)] }, depart: { distance: 0.06 } },
    ],
  }, 45000);
const until = (fn, seconds = 5) => {
  const end = Date.now() + seconds * 1000;
  do {
    if (fn()) return true;
  } while (Date.now() < end);
  return false;
};
const hasName = (n) => ids[n] != null;

check('crate shelf has 12 load buttons, REC and SHARE', ['Load Warm Start A', 'Load Warm Start B', 'Load Concrete A', 'Load Concrete B', 'Load Mirrorball A', 'Load Mirrorball B', 'Load Rainy Tape A', 'Load Rainy Tape B', 'Load Airlock A', 'Load Airlock B', 'Load Sunrise A', 'Load Sunrise B', 'Rec', 'Share'].every(hasName));

// everything stays inside the console's width (62 cm): shelf 60 cm, buttons within it
const scene = JSON.parse(fs.readFileSync(cwd + '/public/scenes/droproom.iwsdk.scene.json', 'utf8'));
const consoleNode = scene.nodes.find((n) => n.id === 'console');
const crateNodes = consoleNode.children.filter((n) => /^(load-|rec$|share$)/.test(n.id));
check('crate buttons all sit inside +-0.30 m of the console centre', crateNodes.length === 14 && crateNodes.every((n) => Math.abs(n.transform.position[0]) <= 0.3), `max |x| ${Math.max(...crateNodes.map((n) => Math.abs(n.transform.position[0]))).toFixed(3)}`);

press('Start Pad');
check('START starts the music (Warm Start on A, Concrete on B)', until(() => music().audioRunning && music().playingA && music().trackA === 'warm-start' && music().trackB === 'concrete'));

// refused: deck A is playing
press('Load Concrete A');
check('LOAD onto the playing deck A is refused', until(() => music().refusals >= 1), `refusals ${music().refusals}`);
check('...and the music keeps playing Warm Start', music().playingA && music().trackA === 'warm-start');

// idle deck B: loads
press('Load Mirrorball B');
check('LOAD Mirrorball onto idle deck B works', until(() => music().trackB === 'mirrorball', 8), `B = ${music().trackB}`);
check('...and the button shows it is on B', until(() => lit('Load Mirrorball B')) && !lit('Load Concrete B'));
press('Load Rainy Tape B');
check('LOAD Rainy Tape onto B replaces it', until(() => music().trackB === 'rainy-tape', 8), `B = ${music().trackB}`);
press('Load Warm Start B');
check('a track can sit on both decks', until(() => music().trackB === 'warm-start', 8) && music().trackA === 'warm-start');
press('Load Mirrorball B');
until(() => music().trackB === 'mirrorball', 8);

// a started deck is refused too
press('Play B');
check('PLAY B starts the loaded track', until(() => music().playingB));
const refusals = music().refusals;
press('Load Rainy Tape B');
check('LOAD onto playing deck B is refused', until(() => music().refusals > refusals) && music().trackB === 'mirrorball' && music().playingB, `B = ${music().trackB}`);
press('Play B');
until(() => !music().playingB);

// REC
check('not recording before REC', music().recording === false && music().takes === 0);
press('Rec');
check('REC starts recording and lights', until(() => music().recording) && until(() => lit('Rec')));
sleep(3);
press('Rec');
check('REC again stops it', until(() => !music().recording && music().takes === 1), `takes ${music().takes}`);
check('the take is a non-empty file', music().recBytes > 4000, `${music().recBytes} bytes`);
check('REC goes dark when stopped', until(() => !lit('Rec')));

// SHARE
const moves = music().moves;
check('the poked actions were logged', moves >= 6, `${moves} moves`);
press('Share');
check('SHARE builds the set link', until(() => music().shares === 1));

try {
  run(['xr', 'exit']);
} catch {}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
