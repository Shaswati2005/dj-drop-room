// Day 8 check (node scripts/verify-placement.mjs): in the emulated living room,
// the console floats in front of the player where no table is in reach, and
// sits on the real (detected) table when the player is seated at one.
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

try {
  run(['xr', 'exit']);
} catch {}
run(['browser', 'reload']);
sleep(14);
run(['xr', 'enter']);
run(['xr', 'set-device-state'], {});
sleep(4);
const planes = run(['ecs', 'find'], { withComponents: ['XRPlane'] }).entities.length;
const meshes = run(['ecs', 'find'], { withComponents: ['XRMesh'] }).entities.length;
check('scene understanding reports the room', planes > 0 && meshes > 0, `${planes} planes, ${meshes} meshes`);
let p = browser('scripts/probes/placement.mjs');
check('no table in reach at the default spot: console floats in front', p.placement === 'head', JSON.stringify(p.console));

// seated at the 76 cm table at (-0.95, 1.35), facing it (-X)
run(['xr', 'set-device-state'], { state: { headset: { position: { x: -0.05, y: 1.2, z: 1.35 }, orientation: { x: 0, y: 0.7071, z: 0, w: 0.7071 } } } });
browser('scripts/probes/replace-console.mjs');
p = browser('scripts/probes/placement.mjs');
check('seated at a table: the console moves onto it', p.placement === 'table');
check('...resting on the table top (0.76 m)', Math.abs(p.console.y - 0.805) < 0.01, `y ${p.console.y.toFixed(3)}`);
check('...within reach in front of the player', p.console.x < -0.45 && p.console.x > -0.85 && Math.abs(p.console.z - 1.35) < 0.02, `x ${p.console.x.toFixed(2)}`);

console.log(`${results.filter(Boolean).length}/${results.length} passed`);
