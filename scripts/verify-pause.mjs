// Day 8 check (node scripts/verify-pause.mjs): leaving the XR session mid-set
// freezes the music; coming back resumes it from the same spot.
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
const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
};

try {
  run(['xr', 'exit']);
} catch {}
run(['browser', 'reload']);
sleep(14);
run(['xr', 'enter']);
run(['xr', 'set-device-state'], {});
run(['xr', 'set-input-mode'], { mode: 'hand' });
sleep(1.5);
run(['xr', 'run-sequence'], { device: 'hand-right', steps: [{ target: { name: 'Start Pad', face: 'top' }, approach: { distance: 0.05 }, press: { hold: 0.15 } }] }, 45000);
sleep(3);
const state = run(['ecs', 'find'], { namePattern: '^Music State$' }).entities[0].entityIndex;
const music = () => run(['ecs', 'query'], { entityIndex: state, components: ['MusicState'] }).components[0].values;
const before = music().positionA;
check('the set is playing', music().playingA && before > 1, `at ${before.toFixed(2)} s`);
run(['xr', 'exit']);
const left = run(['browser', 'run', 'scripts/probes/position.mjs']);
sleep(3);
const later = run(['browser', 'run', 'scripts/probes/position.mjs']);
const p0 = JSON.parse(left.data?.result ?? left.result);
const p1 = JSON.parse(later.data?.result ?? later.result);
check('leaving XR freezes the music', p0.ctx === 'suspended' && Math.abs(p1.pos - p0.pos) < 0.05, `${p0.ctx}, ${p0.pos.toFixed(2)} → ${p1.pos.toFixed(2)} s over 3 s`);
const entered = Date.now();
run(['xr', 'enter']);
sleep(2);
const back = run(['browser', 'run', 'scripts/probes/position.mjs']);
const p2 = JSON.parse(back.data?.result ?? back.result);
// it may only have moved on by the real time since re-entering (CLI calls are slow)
const elapsed = (Date.now() - entered) / 1000;
check('coming back resumes from the same spot', p2.ctx === 'running' && p2.pos > p1.pos && p2.pos - p1.pos <= elapsed + 0.3, `${p1.pos.toFixed(2)} → ${p2.pos.toFixed(2)} s in ${elapsed.toFixed(1)} s`);
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
