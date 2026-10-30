// Day 10 check (node scripts/verify-club.mjs): club mode. Mixed reality is the
// default on load; the CLUB button on the console (poked by a hand) turns the
// opaque warehouse on and off; the room is centred on the booth with its floor
// at world y = 0 and the player's head outside every solid; the LED wall reacts
// to the music; the frame stays inside the draw-call budget.
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
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
};
const probe = (name) => {
  const j = run(['browser', 'run', `scripts/probes/${name}.mjs`]);
  return JSON.parse(j.data?.result ?? j.result);
};
const until = (fn, seconds = 5) => {
  const end = Date.now() + seconds * 1000;
  do {
    if (fn()) return true;
  } while (Date.now() < end);
  return false;
};

// mixed reality is the default
const config = JSON.parse(fs.readFileSync(cwd + '/iwsdk.config.json', 'utf8'));
check('iwsdk.config.json still starts in mixed reality (xr mode "ar")', config.world.xr.mode === 'ar');

try {
  run(['xr', 'exit']);
} catch {}
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
sleep(2);

const ids = {};
for (const c of ['PushButton', 'MusicState']) {
  for (const e of run(['ecs', 'find'], { withComponents: [c] }).entities) ids[e.name] = e.entityIndex;
}
const values = (name, component) => run(['ecs', 'query'], { entityIndex: ids[name], components: [component] }).components[0].values;
const music = () => values('Music State', 'MusicState');
const REST = { x: 0.35, y: -0.25, z: -0.05 };
const press = (name) =>
  run(['xr', 'run-sequence'], {
    device: 'hand-right',
    steps: [
      { label: name, target: { name, face: 'top' }, approach: { distance: 0.05 }, press: { hold: 0.15 } },
      { label: 'rest', anchor: 'wrist', position: { relativeTo: 'head', ...REST }, depart: { distance: 0.06 } },
    ],
  }, 45000);

// on load: MR, club off and hidden, no haze
let info = probe('club-info');
const envBefore = info.env;
check('on load club mode is off (mixed reality)', info.club.on === false && music().club === false);
check('the club room exists but is hidden, no haze', info.roomFound && info.roomVisible === false && info.fog === false);
check('the CLUB button exists on the console', ids['Club'] != null);

// poke CLUB with a hand
press('Club');
check('poking CLUB turns club mode on', until(() => probe('club-info').club.on, 6) && until(() => music().club));
sleep(1.5);
info = probe('club-info');
check('the club room is visible with haze and a dimmed environment', info.roomVisible === true && info.fog === true && info.env < envBefore * 0.6, `env ${info.env.toFixed(2)}`);
check('the CLUB button lights', values('Club', 'PushButton').lit === true);
const dx = Math.hypot(info.roomPos.x - info.consolePos.x, info.roomPos.z - info.consolePos.z);
check('the club is centred on the console (within 5 cm)', dx < 0.05, `${(dx * 100).toFixed(1)} cm`);
check('the club floor is at world y = 0', Math.abs(info.roomPos.y) < 0.001, `y ${info.roomPos.y.toFixed(3)}`);
const tableTop = info.tableHeight;
check('the booth table reaches the console base', Math.abs(tableTop - (info.consolePos.y - 0.045)) < 0.03, `table ${tableTop.toFixed(3)} m, console ${info.consolePos.y.toFixed(3)} m`);
// the head is in the open: inside the room box (14 m wide, 15.5 m deep around the booth) and above the table
const dxh = info.head.x - info.roomPos.x;
const dzh = info.head.z - info.roomPos.z;
check('the player starts inside the room, not inside a wall', Math.abs(dxh) < 6.5 && dzh > -8 && dzh < 6, `head at (${dxh.toFixed(2)}, ${dzh.toFixed(2)}) from the booth`);
check('the head is above the table top (not inside the booth)', info.head.y > tableTop + 0.3, `head ${info.head.y.toFixed(2)} m`);

// LED wall: idle, then music
const idle = [];
for (let i = 0; i < 5; i++) {
  idle.push(probe('club-info').club.ledLuma);
  sleep(0.3);
}
check('the LED wall draws before the music starts', idle.every((v) => v > 0), `luma ${Math.round(Math.min(...idle))}..${Math.round(Math.max(...idle))}`);
press('Start Pad');
check('START starts the music', until(() => music().audioRunning && music().playingA, 8));
sleep(3);
const live = [];
for (let i = 0; i < 12; i++) {
  live.push(probe('club-info').club.ledLuma);
  sleep(0.25);
}
const idleMax = Math.max(...idle);
check('the LED wall reacts to the music (brighter than idle)', Math.max(...live) > idleMax * 1.2, `idle <= ${Math.round(idleMax)}, playing up to ${Math.round(Math.max(...live))}`);
check('the LED wall moves with the beat (frames differ)', new Set(live).size > 3, `${new Set(live).size} distinct frames of ${live.length}`);

// budget
sleep(1);
const stats = probe('club-info');
check('draw calls in club mode are within budget (<= 450)', stats.calls <= 450, `${stats.calls} calls, ${stats.triangles} triangles`);
check('triangles in club mode are within budget (<= 150k)', stats.triangles <= 150000);

// reduced flash flag
run(['browser', 'run', 'scripts/probes/club-flash.mjs']);
check('the reduced-flash flag can be set', probe('club-info').club.reducedFlash === true);

// off again
press('Club');
check('poking CLUB again leaves club mode', until(() => !probe('club-info').club.on, 6));
sleep(1);
info = probe('club-info');
check('the club is hidden again, haze gone, environment restored', info.roomVisible === false && info.fog === false && Math.abs(info.env - envBefore) < 0.001, `env ${info.env.toFixed(2)}`);
check('the music kept playing through both switches', music().playingA);

try {
  run(['xr', 'exit']);
} catch {}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
