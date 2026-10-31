// Day 12 hands check (node scripts/verify-day12-hands.mjs): in an emulated XR
// session, poke the settings tab at the back of the console with a fingertip
// (VOL-, DIM+, FLASH, the ? tips button), then FINISH SET and the START pad
// that comes back as PLAY AGAIN. Nothing modal blocks the console: the
// regular DROP/START pads still answer while the summary card is up. Settings
// persist (read back from localStorage). Leaves storage clean.
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
const probe = (name = 'day12-game') => {
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
const REST = { x: 0.35, y: -0.25, z: -0.05 };
const press = (name) =>
  run(
    ['xr', 'run-sequence'],
    {
      device: 'hand-right',
      steps: [
        { target: { name, face: 'top' }, approach: { distance: 0.05 }, press: { hold: 0.15 } },
        { anchor: 'wrist', position: { relativeTo: 'head', ...REST }, depart: { distance: 0.06 } },
      ],
    },
    45000,
  );

try {
  run(['xr', 'exit']);
} catch {}
probe('day12-reset');
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
for (const e of run(['ecs', 'find'], { withComponents: ['PushButton'] }).entities) ids[e.name] = e.entityIndex;
const lit = (name) => run(['ecs', 'query'], { entityIndex: ids[name], components: ['PushButton'] }).components[0].values.lit;

// ---- the settings tab sits on the console and stays inside its width -----------
const tabs = ['Set Help', 'Set Vol Down', 'Set Vol Up', 'Set Dim Down', 'Set Dim Up', 'Set Flash', 'Set Finish'];
check('the settings tab has seven buttons', tabs.every((t) => ids[t] != null));
const scene = JSON.parse(fs.readFileSync(cwd + '/public/scenes/droproom.iwsdk.scene.json', 'utf8'));
const consoleNode = scene.nodes.find((n) => n.id === 'console');
const tabNodes = consoleNode.children.filter((n) => n.id.startsWith('set-'));
const xs = tabNodes.map((n) => n.transform.position[0]).sort((a, b) => a - b);
const gap = Math.min(...xs.map((x, i) => (i ? x - xs[i - 1] : Infinity)));
check('the tab stays inside the console width (|x| <= 0.30 m) and the buttons are >= 5 cm apart', tabNodes.length === 7 && xs.every((x) => Math.abs(x) <= 0.3) && gap >= 0.05, `max |x| ${Math.max(...xs.map(Math.abs)).toFixed(3)}, gap ${(gap * 100).toFixed(1)} cm`);

// ---- start the music, poke the settings ---------------------------------------
press('Start Pad');
check('START starts the music', until(() => probe().running && probe().playingA, 8));
sleep(1);

press('Set Vol Down');
press('Set Vol Down');
let g = probe();
check('two pokes on VOL- bring the volume to 80 %', until(() => probe().settings.volume === 0.8, 4), `${probe().settings.volume}`);
check('...the master bus follows', Math.abs(probe().volume - 0.8) < 1e-6);
press('Set Dim Up');
check('DIM+ raises the room dimmer to 10 %', until(() => probe().settings.dim === 0.1, 4), `${probe().settings.dim}`);
press('Set Flash');
check('FLASH turns reduced flash on, its button lights', until(() => probe().settings.reducedFlash && probe().reducedFlash, 4) && until(() => lit('Set Flash'), 3));
press('Set Help');
check('the ? button replays the coach tips', until(() => probe().tourId >= 1 && probe().coachShown !== '', 4), `"${probe().coachShown}"`);
g = probe();
check('settings are saved to storage', JSON.parse(g.stored.settings ?? '{}').volume === 0.8 && JSON.parse(g.stored.settings ?? '{}').reducedFlash === true, g.stored.settings);

// ---- FINISH SET -------------------------------------------------------------------
run(['browser', 'run', 'scripts/probes/day12-hype.mjs']);
sleep(3);
press('Set Finish');
check('FINISH SET shows the summary card', until(() => probe().finished && probe().cardVisible, 6));
g = probe();
check('...with the set\'s numbers and a new best', g.summary != null && g.summary.peakHype >= 80 && g.summary.newBest === true, JSON.stringify(g.summary));
check('...the master fades out and the decks stop', until(() => !probe().playingA, 8));
check('...the START pad is back as PLAY AGAIN', until(() => lit('Start Pad'), 4));

// the console is not blocked: the START pad answers while the card is up
press('Start Pad');
check('PLAY AGAIN: poke START, the card goes and Warm Start plays from the top', until(() => !probe().finished && probe().playingA && probe().trackA === 'warm-start', 12));
g = probe();
check('...the best set is remembered', g.best != null && g.best.peakHype >= 80 && JSON.parse(g.stored.best ?? '{}').peakHype === g.best.peakHype, JSON.stringify(g.best));

probe('day12-reset');
try {
  run(['xr', 'exit']);
} catch {}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
