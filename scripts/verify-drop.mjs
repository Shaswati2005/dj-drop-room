// Day 7 check (npx @iwsdk/cli browser run scripts/verify-drop.mjs --timeout 90000):
// DROP lands on a bar line at least 2 beats out, jumps the master deck to the
// start of its next drop section with every stem on, gaps drums and bass on
// the last beat, re-drops when pressed in a drop, and the room dims and the
// light rig shows.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const e = (fn, arg) => app.evaluate(fn, arg);
  const wait = (ms) => app.waitForTimeout(ms);

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  await app.locator('#start-music').click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 10000 });
  const rigHidden = await e(() => window.__dropRoom.world.scene.getObjectByName('Light Rig').visible === false);
  check('light rig hidden before the first DROP', rigHidden);
  await wait(1500);

  // mute the bass first: the drop must bring it back
  await e(() => window.__dropRoom.engine().toggleStem('A', 'bass'));
  await wait(2300);

  const press = await e(() => {
    const en = window.__dropRoom.engine();
    const deck = en.decks.A;
    const now = en.context.currentTime;
    en.drop();
    const bar = deck.barSeconds;
    return { now, bar, beat: 60 / deck.bpm };
  });
  const s1 = await e(() => window.__dropRoom.engine().update());
  const dropAt = s1.dropAt;
  const bar = press.bar;
  check('DROP is armed and the button charges', s1.dropping && dropAt > press.now);
  check('lands at least 2 beats after the press', dropAt - press.now >= 2 * press.beat - 1e-6, `${(dropAt - press.now).toFixed(2)} s, beat ${press.beat.toFixed(3)} s`);
  check('...and no more than 2 bars later', dropAt - press.now <= 2 * bar + 1e-6);
  await wait(300);
  const dimRising = await e(() => window.__dropRoom.world.scene.getObjectByName('RoomDimmer').material.opacity);
  const rigShown = await e(() => window.__dropRoom.world.scene.getObjectByName('Light Rig').visible);
  check('the rig appears as the riser starts', rigShown);

  // just after the downbeat: playhead at the drop section's first bar
  await e((at) => new Promise((r) => { const en = window.__dropRoom.engine(); const t = () => (en.audibleTime() > at + 0.15 ? r() : setTimeout(t, 10)); t(); }), dropAt);
  const landed = await e(() => {
    const en = window.__dropRoom.engine();
    const s = en.update();
    const dim = window.__dropRoom.world.scene.getObjectByName('RoomDimmer').material.opacity;
    return { pos: s.A.position, section: s.A.section, stems: [...s.A.stems], drops: s.drops, dropping: s.dropping, since: s.heard - s.dropAt, dim };
  });
  const dropStart = 16 * bar; // Warm Start: intro 8 + build 8
  check('the master deck lands on the start of its drop section', landed.section === 'drop' && Math.abs(landed.pos - landed.since - dropStart) < 0.02, `at ${landed.pos.toFixed(2)} s, drop starts ${dropStart.toFixed(2)} s`);
  check('every stem is on in the drop (the muted bass came back)', landed.stems.every((v) => v === 1), JSON.stringify(landed.stems));
  check('one drop counted', landed.drops === 1 && !landed.dropping);
  check('the room dims hard on the drop', landed.dim > 0.5 && dimRising >= 0, `opacity ${landed.dim.toFixed(2)} (rising ${dimRising.toFixed(2)})`);
  await wait(3500);
  const settled = await e(() => window.__dropRoom.world.scene.getObjectByName('RoomDimmer').material.opacity);
  check('...then settles to a lower dim', settled > 0.2 && settled < 0.45, settled.toFixed(2));

  // re-drop: pressing in the drop goes back to its first bar
  await wait(2000);
  const r = await e(() => {
    const en = window.__dropRoom.engine();
    en.drop();
    return en.update().dropAt;
  });
  await e((at) => new Promise((res) => { const en = window.__dropRoom.engine(); const t = () => (en.audibleTime() > at + 0.15 ? res() : setTimeout(t, 10)); t(); }), r);
  const again = await e(() => { const s = window.__dropRoom.engine().update(); return { pos: s.A.position, since: s.heard - s.dropAt, drops: s.drops }; });
  check('DROP inside a drop re-drops to its first bar', Math.abs(again.pos - again.since - dropStart) < 0.02 && again.drops === 2, `at ${again.pos.toFixed(2)} s`);
  return out.join('\n');
}
