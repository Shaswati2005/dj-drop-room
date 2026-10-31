// Day 12 check, part 2 (npx @iwsdk/cli browser run scripts/verify-day12-set.mjs --timeout 105000 --raw):
// the come-back kit and Finish Set on a live set:
//   - the resident crowd arrives at the tier of the stored best set, but the beams still start at 4
//   - the second-wave tip after the first drop, the nightly request toast ~8 bars after it,
//     and the request celebrated when fulfilled
//   - HELP replays the tips; 16 idle bars bring the idle tip
//   - Finish Set fades the master, stops the decks, shows one card (peak, time on fire, best move,
//     "your best"), saves the best set; Play again restarts on Warm Start
//   - a weaker second set is not a new best and keeps the old one
// Leave XR first. Leaves localStorage clean.
export default async function run({ page, frame }) {
  let app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const wait = (ms) => page.waitForTimeout(ms);
  const ready = async () => {
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      for (const f of [...page.frames()]) {
        try {
          if (await f.evaluate(() => window.__dropRoom != null && window.__dropRoom.game != null)) {
            app = f;
            return;
          }
        } catch {}
      }
      await wait(300);
    }
    throw new Error('app did not come back after reload');
  };
  const reload = async () => {
    await page.reload();
    await ready();
  };
  const probe = () =>
    app.evaluate(() => {
      const d = window.__dropRoom;
      const card = d.world.scene.getObjectByName('SummaryCard');
      const s = d.state();
      let stored = {};
      try {
        stored = { settings: localStorage.getItem('dropRoom.settings'), best: JSON.parse(localStorage.getItem('dropRoom.best') ?? 'null') };
      } catch {}
      return { ...d.game(), cardVisible: card?.visible ?? false, s: { running: s.running, playingA: s.A.playing, playingB: s.B.playing, trackA: s.A.trackId, drops: s.drops, level: s.level, section: s.A.section }, crowd: d.crowd(), lights: d.lights(), stored };
    });
  const waitFor = async (fn, ms, step = 250) => {
    const end = Date.now() + ms;
    for (;;) {
      const p = await probe();
      if (fn(p)) return p;
      if (Date.now() > end) return null;
      await wait(step);
    }
  };
  const startMusic = async () => {
    const button = app.locator('#start-music');
    if (await button.isVisible()) await button.click();
    await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });
  };
  const clear = () =>
    app.evaluate(() => {
      localStorage.removeItem('dropRoom.settings');
      localStorage.removeItem('dropRoom.best');
    });

  await ready();

  // ---- resident crowd: arrives at your best tier, beams still start at 4 ------
  await app.evaluate(() => localStorage.setItem('dropRoom.best', JSON.stringify({ peakHype: 92, timeOnFire: 40, date: '2026-10-30' })));
  await reload();
  let p = await probe();
  check('the stored best set is loaded', p.best?.peakHype === 92, JSON.stringify(p.best));
  await startMusic();
  p = await waitFor((x) => x.crowd.tier >= 3, 5000);
  check('resident crowd: the crowd arrives on fire (the tier of the previous best)', p != null, p ? `tier ${p.crowd.tier}, ${p.crowd.instances} dancers` : 'tier never reached 3');
  p = await probe();
  check('...but the light show tier (beams start at 4, 6 and 8 are earned) is not raised by it', p.lights.tier <= 1 && p.crowd.tier === 3, `light tier ${p.lights.tier}, crowd tier ${p.crowd.tier}`);
  await clear();

  // ---- a first set -----------------------------------------------------------
  await reload();
  await startMusic();
  p = await probe();
  check('first set: no best yet, no request toast, no tips', p.best === null && !p.request.shown && p.tipsShown.length === 0 && p.toast === '');
  await app.evaluate(() => window.__dropRoom.engine().drop());
  p = await waitFor((x) => x.s.drops >= 1, 12000);
  check('DROP lands', p != null);
  await app.evaluate(() => window.__dropRoom.forceHype(0.9));
  p = await waitFor((x) => x.tipsShown.includes('filter'), 9000);
  check('second-wave tip after the first drop ("drag the filter left")', p != null);
  p = await probe();
  const barsAtTip = p.stats.bars - p.stats.firstDropBar;
  check('...and the request toast has not fired yet (it waits ~8 bars)', !p.request.shown, `${barsAtTip.toFixed(1)} bars after the drop`);
  p = await waitFor((x) => x.request.shown, 24000);
  check('the nightly request toast appears ~8 bars after the first drop', p != null && p.toast === p.request.text, p ? `"${p.toast}", ${(p.stats.bars - p.stats.firstDropBar).toFixed(1)} bars after the drop` : 'never shown');
  await wait(400);
  check('...and the toast mesh is up', await app.evaluate(() => window.__dropRoom.world.scene.getObjectByName('RequestToast').visible));
  p = await probe();
  check('the crowd reaches the top tier while pinned hot (stats see it)', p.crowd.tier === 3 && p.stats.peakHype >= 89 && p.stats.timeOnFire > 1, `peak ${p.stats.peakHype.toFixed(0)}, ${p.stats.timeOnFire.toFixed(1)} s on fire`);

  // fulfilment: a short house request while Warm Start (house) plays hot
  await app.evaluate(() => window.__dropRoom.setRequest('house', 2, 2));
  p = await waitFor((x) => x.request.done, 14000);
  check('the request is detected as fulfilled', p != null, p ? `progress ${p.request.progress.toFixed(1)} bars` : 'not done');
  p = await probe();
  check('...and celebrated with a toast', /REQUEST DONE/.test(p.toast), p.toast);

  // HELP replays the tips; the idle tip comes after 16 idle bars
  await app.evaluate(() => window.__dropRoom.settingsAction('help'));
  await wait(600);
  p = await probe();
  check('HELP replays the coach tips', p.tourId === 1 && p.coachShown !== '', `"${p.coachShown}"`);
  await app.evaluate(() => window.__dropRoom.advanceBars(17));
  p = await waitFor((x) => x.tipsShown.includes('idle'), 4000);
  check('16 idle bars bring the idle tip', p != null);

  // ---- Finish Set -------------------------------------------------------------
  await app.evaluate(() => window.__dropRoom.forceHype(null));
  await app.evaluate(() => window.__dropRoom.finishSet());
  p = await probe();
  check('Finish Set: finished, card up, summary has the numbers', p.finished && p.cardVisible && p.summary != null && p.summary.peakHype >= 89 && p.summary.timeOnFire >= 1, JSON.stringify(p.summary));
  check('...a first set is a new best', p.summary.newBest === true && p.summary.previous === null);
  check('...with a best move named', p.summary.bestMove.length > 0, p.summary.bestMove);
  check('...and the best set is saved with its date', p.stored.best?.peakHype === p.summary.peakHype && /^\d{4}-\d\d-\d\d$/.test(p.stored.best?.date ?? ''), JSON.stringify(p.stored.best));
  p = await waitFor((x) => !x.s.playingA && x.s.level < 0.02, 6000);
  check('the master fades out and the decks stop', p != null, p ? `level ${p.s.level.toFixed(3)}` : 'still sounding');
  p = await probe();
  check('the crowd applauds (pinned up) while the card is up', p.crowd.tier === 3);

  // ---- Play again -------------------------------------------------------------
  await app.evaluate(() => window.__dropRoom.playAgain());
  p = await waitFor((x) => !x.finished && x.s.playingA && x.s.trackA === 'warm-start', 8000);
  check('Play again restarts on Warm Start, card gone, drops back to 0', p != null && !p.cardVisible && p.s.drops === 0, p ? `drops ${p.s.drops}` : 'did not restart');
  p = await waitFor((x) => x.s.level > 0.05, 6000);
  check('...and the music is back at level', p != null, p ? `level ${p.s.level.toFixed(2)}` : '');
  p = await probe();
  check('...with the stats started over', p.stats.peakHype < 60 && p.stats.timeOnFire === 0 && p.crowd.tier < 3, `peak ${p.stats.peakHype.toFixed(0)}`);

  // a weaker second set keeps the old best
  await wait(1500);
  await app.evaluate(() => window.__dropRoom.finishSet());
  p = await probe();
  check('a weaker second set is not a new best and shows "your best"', p.finished && p.summary.newBest === false && p.summary.previous?.peakHype >= 89 && p.best.peakHype >= 89, JSON.stringify(p.summary));
  check('...the stored best is unchanged', p.stored.best?.peakHype === p.best.peakHype);
  await clear();
  return out.join('\n');
}
