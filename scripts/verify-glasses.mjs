// Meta VR Glasses check #2 (node scripts/verify-glasses.mjs; ~8 minutes). Switches
// dev.emulator.device to metaVRGlasses (Vite restarts in place), and ALWAYS restores metaQuest3.
// gazeTracking stays off in iwsdk.config.json (it breaks fader pinch-grab).
//   1. profile: the emulator reports "Meta VR Glasses"
//   2. fit: at a natural seated head pitch of 30, 35 and 40 degrees down, the WHOLE console (chassis,
//      decks, crate shelf, settings plate at the very back, screens) and every control's box sit
//      inside the glasses' view (+-37 horizontal, +25 up, -43 down, from the view axis)
//   3. every control is reached by the glasses' pointer (gaze when the profile has a gaze source,
//      else the hand ray): hovered after aiming at it
//   4. pinch (select) works through it on every kind of control: pads, buttons, the crate load
//      buttons, the settings tab (all seven), the A/B ends, DROP, CLUB, a knob tap and a fader grab
import { cli, emulatorDevice, evalInPage, fresh, makeChecker, probe, setEmulatorDevice, sh, sleep } from './probes/day13-lib.mjs';

const { check } = makeChecker();
const original = emulatorDevice();
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  try {
    if (emulatorDevice() !== original) setEmulatorDevice(original);
  } catch (e) {
    console.log(`FAIL could not restore the emulator device: ${e.message}`);
  }
};
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));

const LIMITS = { h: 37, up: 25, down: -43 };
const unwrap = (j) => j.data?.result ?? j.result ?? j;

try {
  // ---- 1. profile -----------------------------------------------------------------------------
  check('starting from the Quest 3 profile in iwsdk.config.json', original === 'metaQuest3', original);
  setEmulatorDevice('metaVRGlasses');
  fresh();
  evalInPage(`try { localStorage.removeItem('dropRoom.settings'); localStorage.removeItem('dropRoom.best'); localStorage.removeItem('dropRoom.coach'); } catch {} return true;`);
  sh('npx @iwsdk/cli browser reload --raw', 60000);
  sleep(10);
  cli('xr enter', {}, 60000);
  sleep(3);
  cli('xr set-device-state', {});
  cli('xr set-input-mode', { mode: 'hand' });
  sleep(1.5);
  const status = unwrap(cli('xr status'));
  check('the emulator is the Meta VR Glasses profile', status.deviceName === 'Meta VR Glasses', `${status.deviceName}; session ${status.sessionMode}; features ${(status.enabledFeatures ?? []).join(',')}`);
  const dev = unwrap(cli('xr get-device-state'));
  const gazeOn = dev.gaze?.connected === true;
  console.log(`gaze source: ${gazeOn ? 'connected' : 'not present in this session'} (gaze-tracking feature ${(status.enabledFeatures ?? []).includes('gaze-tracking') ? 'granted' : 'not requested, as intended'})`);
  const head = dev.headset?.position ?? dev.head?.position ?? { x: 0, y: 1.17, z: 0 };

  // start the music so the whole show (and the crate states) is live
  evalInPage(`await en.start(); await until(() => en.update().A.playing, 15000); return true;`);

  // ---- 2. fit ---------------------------------------------------------------------------------
  // hands well clear of the console (gaze is suppressed while a hand rests near it)
  const clearHands = () => {
    cli('xr set-transform', { device: 'hand-left', anchor: 'wrist', position: { x: head.x - 0.6, y: head.y - 0.1, z: head.z - 0.1 } });
    cli('xr set-transform', { device: 'hand-right', anchor: 'wrist', position: { x: head.x + 0.6, y: head.y - 0.1, z: head.z - 0.1 } });
  };
  clearHands();
  const worst = {};
  for (const pitch of [30, 35, 40]) {
    cli('xr set-transform', { device: 'headset', orientation: { pitch: -pitch, yaw: 0, roll: 0 } });
    sleep(1);
    const fit = probe('scripts/probes/day13-fit.mjs', 60000);
    const names = Object.keys(fit.controls);
    const ex = { h: [Infinity, -Infinity], v: [Infinity, -Infinity], hName: '', vlo: '', vhi: '' };
    let hMax = 0;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const n of names) {
      const c = fit.controls[n];
      const ah = Math.max(Math.abs(c.h[0]), Math.abs(c.h[1]));
      if (ah > hMax) (hMax = ah), (ex.hName = n);
      if (c.v[0] < vMin) (vMin = c.v[0]), (ex.vlo = n);
      if (c.v[1] > vMax) (vMax = c.v[1]), (ex.vhi = n);
    }
    const c = fit.console;
    const cH = Math.max(Math.abs(c.h[0]), Math.abs(c.h[1]));
    worst[pitch] = { controls: names.length, hMax, vMin, vMax, cH, cV: c.v, ex };
    console.log(`pitch ${pitch} deg down: ${names.length} controls; widest ${hMax.toFixed(1)} deg (${ex.hName}); lowest ${vMin.toFixed(1)} (${ex.vlo}); highest ${vMax.toFixed(1)} (${ex.vhi}); whole console h +-${cH.toFixed(1)}, v ${c.v[0]}..${c.v[1]}`);
    check(`pitch ${pitch}: every control (${names.length}) is inside the glasses' view, boxes included`, names.length >= 70 && hMax <= LIMITS.h && vMin >= LIMITS.down && vMax <= LIMITS.up, `h <= ${hMax.toFixed(1)} of ${LIMITS.h}; v ${vMin.toFixed(1)}..${vMax.toFixed(1)} of ${LIMITS.down}..${LIMITS.up}`);
    check(`pitch ${pitch}: the whole console (chassis, crate shelf, settings plate, screens) is inside the view`, cH <= LIMITS.h && c.v[0] >= LIMITS.down && c.v[1] <= LIMITS.up, `h +-${cH.toFixed(1)}; v ${c.v[0]}..${c.v[1]}`);
    const sets = Object.keys(fit.controls).filter((n) => n.startsWith('Set '));
    const setV = [Math.min(...sets.map((n) => fit.controls[n].v[0])), Math.max(...sets.map((n) => fit.controls[n].v[1]))];
    check(`pitch ${pitch}: the settings tab (${sets.length} buttons, the very back of the console) keeps >= 3 degrees of margin on the top edge`, sets.length === 7 && setV[1] <= LIMITS.up - 3, `v ${setV[0]}..${setV[1]}`);
    if (pitch === 35) sh('npx @iwsdk/cli browser screenshot --output-file artifacts/day13-glasses-fit.png --raw', 60000);
  }

  // ---- 3 + 4. pointer reach and pinch --------------------------------------------------------
  cli('xr set-transform', { device: 'headset', orientation: { pitch: -35, yaw: 0, roll: 0 } });
  clearHands();
  sleep(1);
  const targets = (() => {
    const j = unwrap(cli('xr list-targets'));
    return j.targets ?? j;
  })();
  const pos = Object.fromEntries(targets.map((t) => [t.name, t]));
  // does the app act on the gaze source? (only when the gazeTracking feature is requested, which stays off)
  let pointer = 'hand-right';
  if (gazeOn) {
    const t = pos['Pad A Bass'];
    cli('xr look-at', { device: 'gaze', target: { x: t.position.x, y: t.position.y, z: t.position.z } });
    sleep(0.6);
    const gazeHover = (() => {
      const j = cli('ecs find', { withComponents: ['Hovered'] });
      return (j.entities ?? j.data?.entities ?? []).map((e) => e.name);
    })();
    if (gazeHover.includes('Pad A Bass')) pointer = 'gaze';
    console.log(`gaze source hovers the pad: ${gazeHover.includes('Pad A Bass')} (the app registers GazeSystem only with the gazeTracking feature, which stays off)`);
  }
  const pinchHand = pointer === 'gaze' ? 'hand-right' : pointer;
  const aim = (name) => {
    const t = pos[name];
    cli('xr look-at', { device: pointer, target: { x: t.position.x, y: t.position.y + Math.min(t.size.y / 2, 0.01), z: t.position.z } });
    sleep(0.4);
  };
  const hovered = () => {
    const j = cli('ecs find', { withComponents: ['Hovered'] });
    return (j.entities ?? j.data?.entities ?? []).map((e) => e.name);
  };
  const state = () => probe('scripts/probes/day13-shotstate.mjs', 60000);
  const until = (fn, seconds = 6) => {
    const end = Date.now() + seconds * 1000;
    do {
      if (fn()) return true;
      sleep(0.4);
    } while (Date.now() < end);
    return false;
  };
  console.log(`pointer: ${pointer === 'gaze' ? 'gaze' : 'the hand ray (far hand, pointing from beside the console)'}; pinch hand: ${pinchHand}`);
  const missed = [];
  // sliders and jog wheels are near-pinch grabs (OneHandGrabbable), not ray targets: tested separately below
  const GRABS = /^(Jog |Tempo |Fader |Crossfader$)/;
  const checked = targets.filter((t) => !/^Start Pad$/.test(t.name) && !GRABS.test(t.name));
  for (const t of checked) {
    aim(t.name);
    const h = hovered();
    if (!h.includes(t.name)) {
      sleep(0.5);
      if (!hovered().includes(t.name)) missed.push(t.name);
    }
  }
  check(`the pointer reaches every control: ${checked.length - missed.length}/${checked.length} hovered when aimed at`, missed.length === 0, missed.join(', '));

  const pinch = () => cli('xr select', { device: pinchHand, duration: 0.15 });
  const act = (name, test, label, seconds = 8) => {
    aim(name);
    pinch();
    const ok = until(() => test(state()), seconds);
    check(`${label} by ${pointer === 'gaze' ? 'gaze' : 'ray'} + pinch`, ok, name);
  };
  const s0 = state();
  act('Load Sunrise B', (s) => s.B.trackId === 'sunrise' && s.B.status === 'ready', 'crate: LOAD SUNRISE onto deck B', 12);
  act('Play B', (s) => s.B.playing, 'PLAY B starts deck B', 10);
  act('Pad A Bass', (s) => s.A.stems[1] === 0, 'a stem pad mutes the bass', 8);
  act('Xf End B', (s) => s.crossfader > 0.1, 'the B end starts the crossfade', 8);
  act('Drop', (s) => s.drops >= 1, 'DROP lands', 20);
  act('Club', (s) => s.club === true, 'the CLUB button switches club mode on', 5);
  act('Club', (s) => s.club === false, 'the CLUB button switches it off again', 5);
  act('Set Help', (s) => s.tourId > s0.tourId, 'settings: ? replays the tips', 5);
  act('Set Vol Down', (s) => s.volume < 1, 'settings: VOL- lowers the volume', 5);
  act('Set Vol Up', (s) => s.volume === 1, 'settings: VOL+ raises it', 5);
  act('Set Dim Up', (s) => s.dimSetting > 0, 'settings: DIM+ raises the room dimmer', 5);
  act('Set Dim Down', (s) => s.dimSetting === 0, 'settings: DIM- lowers it', 5);
  act('Set Flash', (s) => s.reducedFlash === true, 'settings: FLASH turns reduced flash on', 5);
  // a knob: set it off-centre, tap it with a pinch, it snaps back to the centre
  evalInPage(`en.setKnob('A', 'filter', 0.6); return true;`);
  act('Filter A', (s) => Math.abs(s.A.filter) < 0.01, 'a knob tap snaps FILTER A back to the centre', 5);
  // sliders: the near pinch on the cap (hand-tracking pinch-grab; gazeTracking stays off because it breaks this), dragged along the slot
  const value = (name) => {
    const ids = cli('ecs find', { withComponents: ['Fader'] });
    const e = (ids.entities ?? ids.data?.entities ?? []).find((x) => x.name === name);
    const q = cli('ecs query', { entityIndex: e.entityIndex, components: ['Fader'] });
    return (q.components ?? q.data?.components)[0].values.value;
  };
  for (const [name, hand, axis] of [['Crossfader', 'hand-right', 'x'], ['Fader B', 'hand-right', 'z'], ['Tempo A', 'hand-left', 'z']]) {
    const t = pos[name].position;
    const before = value(name);
    // the crossfader goes to whichever end it is not at; a channel fader starts up, so drag it toward the player; the tempo fader away
    const sign = name === 'Crossfader' ? (before > 0 ? -1 : 1) : name.startsWith('Fader') ? 1 : -1;
    const to = { x: t.x + (axis === 'x' ? sign * 0.1 : 0), y: t.y, z: t.z + (axis === 'z' ? sign * 0.1 : 0) };
    cli('xr run-sequence', { device: hand, steps: [{ label: 'reach', anchor: 'grasp', target: { name }, approach: { distance: 0.06 } }, { label: 'pinch', pinch: 1, duration: 0.4 }, { label: 'drag', position: to }] }, 45000);
    sleep(0.3);
    const g = cli('ecs find', { withComponents: ['Grabbed'] });
    const held = (g.entities ?? g.data?.entities ?? []).map((e) => e.name);
    const after = value(name);
    cli('xr run-sequence', { device: hand, steps: [{ pinch: 0, duration: 0.2 }] }, 45000);
    check(`slider by near pinch: ${name} is grabbed and dragged along its slot`, held.includes(name) && Math.abs(after - before) > 0.2, `grabbed [${held.join(',')}], value ${before.toFixed(2)} -> ${after.toFixed(2)}`);
    clearHands();
  }
  // either hand commits: one select with the left hand
  {
    cli('xr set-transform', { device: 'hand-left', anchor: 'wrist', position: { x: head.x - 0.6, y: head.y - 0.1, z: head.z - 0.1 } });
    cli('xr look-at', { device: 'hand-left', target: pos['Set Flash'].position });
    sleep(0.4);
    cli('xr select', { device: 'hand-left', duration: 0.15 });
    check('either hand commits: a left-hand pinch toggles FLASH back off', until(() => state().reducedFlash === false, 5));
  }
  act('Set Finish', (s) => s.cardUp, 'settings: FINISH SET shows the summary card', 12);
  // gaze fallback: with the gaze source gone the hand ray takes over (only where gaze drives the pointer)
  if (pointer === 'gaze') {
    cli('xr set-connected', { device: 'gaze', connected: false });
    cli('xr look-at', { device: 'hand-right', target: { x: pos['Set Flash'].position.x, y: pos['Set Flash'].position.y, z: pos['Set Flash'].position.z } });
    sleep(0.5);
    cli('xr select', { device: 'hand-right', duration: 0.15 });
    check('with gaze disconnected the hand ray still selects', until(() => state().reducedFlash === true, 5));
    cli('xr set-connected', { device: 'gaze', connected: true });
  }
  const logs = cli('browser logs', { count: 200 });
  const list = Array.isArray(logs) ? logs : (logs.data?.logs ?? []);
  const errs = list.filter((l) => l.level === 'error');
  check('console: no errors during the glasses run', errs.length === 0, errs.map((l) => l.message.slice(0, 100)).join(' | '));
} finally {
  restore();
  check('iwsdk.config.json is back on the metaQuest3 emulator device', emulatorDevice() === original, emulatorDevice());
  const cfg = sh('node -e "const c=require(\'./iwsdk.config.json\');console.log(JSON.stringify(c.world.xr.features))"');
  check('gazeTracking was never enabled in iwsdk.config.json', !/gazeTracking/.test(cfg), cfg.trim());
}
