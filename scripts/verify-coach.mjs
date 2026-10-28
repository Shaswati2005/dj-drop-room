// Day 8 check (node scripts/verify-coach.mjs): a first-time player is led
// through start → bass out → bass back → deck B → mix → DROP by coach rings,
// each advancing when the step happens; a returning player is not coached.
import { execFileSync } from 'node:child_process';

const cwd = process.argv[2] ?? process.cwd();
const q = (s) => `'${JSON.stringify(s)}'`;
function run(args, input, timeout = 60000) {
  const full = ['@iwsdk/cli', ...args];
  if (input) full.push('--input-json', q(input));
  full.push('--raw', '--timeout', String(timeout));
  return JSON.parse(execFileSync('npx ' + full.join(' '), { cwd, encoding: 'utf8', shell: 'bash', stdio: ['ignore', 'pipe', 'pipe'] }));
}
const sleep = (s) => execFileSync(`sleep ${s}`, { shell: 'bash' });
const browser = (script) => { const r = run(['browser', 'run', script], undefined, 30000); return JSON.parse(r.data?.result ?? r.result); };
const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
};
// hands parked out to the sides and back, well clear of the pads (resting
// over the console let a fingertip graze the Chords pads)
const REST = { 'hand-left': { x: -0.35, y: -0.25, z: -0.05 }, 'hand-right': { x: 0.35, y: -0.25, z: -0.05 } };
const press = (name, hand = 'hand-right') =>
  run(['xr', 'run-sequence'], { device: hand, steps: [{ target: { name, face: 'top' }, approach: { distance: 0.05 }, press: { hold: 0.15 } }, { anchor: 'wrist', position: { relativeTo: 'head', ...REST[hand] }, depart: { distance: 0.06 } }] }, 45000);
const until = (fn, seconds) => { const end = Date.now() + seconds * 1000; do { if (fn()) return true; } while (Date.now() < end); return false; };

try { run(['xr', 'exit']); } catch {}
browser('scripts/probes/coach-reset.mjs');
run(['browser', 'reload']);
sleep(14);
run(['xr', 'enter']);
run(['xr', 'set-device-state'], {});
run(['xr', 'set-input-mode'], { mode: 'hand' });
sleep(1.5);
let c = browser('scripts/probes/coach.mjs');
check('first visit: ring on START', c.step === 0 && c.ringVisible);
const steps = [
  ['Start Pad', 'hand-right', 1, 'START → ring moves to the Bass pad'],
  ['Pad A Bass', 'hand-left', 2, 'bass out → ring asks for it back'],
  ['Pad A Bass', 'hand-left', 3, 'bass back → ring on PLAY B'],
  ['Play B', 'hand-right', 4, 'deck B playing → ring on the B end'],
  ['Xf End B', 'hand-right', 5, 'mixing to B → ring on DROP'],
  ['Drop', 'hand-right', 6, 'DROP → coaching done'],
];
for (const [target, hand, next, label] of steps) {
  press(target, hand);
  check(label, until(() => browser('scripts/probes/coach.mjs').step >= next, 8));
}
c = browser('scripts/probes/coach.mjs');
check('ring gone and the visit remembered', !c.ringVisible && c.stored === '1');
run(['browser', 'reload']);
sleep(14);
c = browser('scripts/probes/coach.mjs');
check('returning player: no coaching', c.step === 6 && !c.ringVisible);
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
