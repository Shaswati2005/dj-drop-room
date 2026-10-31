// Day 12 check, part 1 (npx @iwsdk/cli browser run scripts/verify-day12.mjs --timeout 105000 --raw):
// settings (volume, room dimmer, reduced flash) persist across a page reload and
// are applied to the engine and the light show, a blocked/garbage store falls
// back to defaults, the nightly request is seeded by the date (same date, same
// request; other dates differ), and the six tracks are loudness-matched
// (RMS within +-3 dB of each other, peaks <= -1 dBFS, no clips).
// Part 2 (the set: request toast, finish, summary card, play again, resident
// crowd) is verify-day12-set.mjs; the hand pokes are verify-day12-hands.mjs.
// Leave XR first. Leaves localStorage clean.
export default async function run({ page, frame }) {
  // a reload detaches the frame the runner handed us: find the app's frame again
  let app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
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
      await page.waitForTimeout(300);
    }
    throw new Error('app did not come back after reload');
  };
  const game = () => app.evaluate(() => window.__dropRoom.game());
  const reload = async () => {
    await page.reload();
    await ready();
  };

  await ready();
  await app.evaluate(() => {
    localStorage.removeItem('dropRoom.settings');
    localStorage.removeItem('dropRoom.best');
  });
  await reload();

  // ---- settings: defaults, pokes, persistence --------------------------------
  let g = await game();
  check('defaults: volume 100 %, dimmer 0 %, full flash', g.settings.volume === 1 && g.settings.dim === 0 && !g.settings.reducedFlash, JSON.stringify(g.settings));
  await app.evaluate(() => {
    const d = window.__dropRoom;
    for (const a of ['volDown', 'volDown', 'volDown', 'dimUp', 'dimUp', 'flash']) d.settingsAction(a);
  });
  g = await game();
  check('three VOL- pokes: 70 %', g.settings.volume === 0.7, `${g.settings.volume}`);
  check('two DIM+ pokes: 20 %', g.settings.dim === 0.2, `${g.settings.dim}`);
  check('FLASH toggles reduced flash and the light show reads it', g.settings.reducedFlash && (await app.evaluate(() => window.__dropRoom.club().reducedFlash)));
  const engineVolume = await app.evaluate(() => window.__dropRoom.engine().master.volume);
  check('the master bus volume follows the setting', Math.abs(engineVolume - 0.7) < 1e-6, `${engineVolume}`);
  await app.evaluate(() => {
    const d = window.__dropRoom;
    for (let i = 0; i < 20; i++) d.settingsAction('volUp');
    for (let i = 0; i < 3; i++) d.settingsAction('volDown');
    for (let i = 0; i < 20; i++) d.settingsAction('dimDown');
    for (let i = 0; i < 30; i++) d.settingsAction('volDown');
  });
  g = await game();
  check('volume clamps at 0 and the dimmer at 0', g.settings.volume === 0 && g.settings.dim === 0, JSON.stringify(g.settings));
  await app.evaluate(() => {
    const d = window.__dropRoom;
    d.setSetting('volume', 0.4);
    d.setSetting('dim', 0.5);
  });
  await reload();
  g = await game();
  check('settings survive a page reload', g.settings.volume === 0.4 && g.settings.dim === 0.5 && g.settings.reducedFlash === true, JSON.stringify(g.settings));
  check('...and are applied again after the reload (bus volume, reduced flash)', (await app.evaluate(() => window.__dropRoom.engine().master.volume)) === 0.4 && (await app.evaluate(() => window.__dropRoom.club().reducedFlash)));
  const dome = await app.evaluate(() => {
    const s = window.__dropRoom.world.scene;
    let opacity = -1;
    s.traverse((o) => {
      if (o.name === 'RoomDimmer' || o.name === 'Dome') opacity = o.material?.opacity ?? opacity;
    });
    return opacity;
  });
  check('the room dimmer setting is on the light show (veil opacity ~0.375 at 50 %)', dome < 0 || Math.abs(dome - 0.375) < 0.05, `opacity ${dome}`);

  // garbage in storage falls back to defaults instead of breaking the app
  await app.evaluate(() => localStorage.setItem('dropRoom.settings', '{{ not json'));
  await app.evaluate(() => localStorage.setItem('dropRoom.best', '"nope"'));
  await reload();
  g = await game();
  check('a corrupt store falls back to defaults', g.settings.volume === 1 && g.settings.dim === 0 && !g.settings.reducedFlash && g.best === null, JSON.stringify(g.settings));
  await app.evaluate(() => {
    localStorage.removeItem('dropRoom.settings');
    localStorage.removeItem('dropRoom.best');
  });

  // ---- nightly request ---------------------------------------------------------
  const today = await app.evaluate(() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const req = await app.evaluate((t) => window.__dropRoom.requestFor(t), today);
  g = await game();
  check("today's request is the one the date seeds", g.request.text === req.text && g.request.seed === req.seed, g.request.text);
  const days = [];
  for (let day = 1; day <= 14; day++) days.push(await app.evaluate((d) => window.__dropRoom.requestFor(`2026-11-${d}`).text, String(day).padStart(2, '0')));
  check('the same date asks for the same thing twice', days[1] === (await app.evaluate(() => window.__dropRoom.requestFor('2026-11-02').text)));
  check('the request text changes with the date (>= 5 different texts in 14 days)', new Set(days).size >= 5, `${new Set(days).size} distinct: ${days[0]} | ${days[1]}`);
  check('every request is "Tonight: <genre>, <goal>"', days.every((t) => /^Tonight: .+, .+ bars?$/.test(t)));

  // ---- loudness across all six tracks -------------------------------------------
  const reports = [];
  for (const [id, bar] of [['warm-start', 16], ['concrete', 16], ['mirrorball', 16], ['rainy-tape', 16], ['airlock', 24], ['sunrise', 16]]) {
    const r = await app.evaluate(([i, b]) => window.__dropRoom.renderOffline(i, 4, b), [id, bar]);
    reports.push({ id, rms: r.rmsDb, peak: r.peakDb, clips: r.clips });
  }
  const mean = reports.reduce((a, r) => a + r.rms, 0) / reports.length;
  const spread = Math.max(...reports.map((r) => r.rms)) - Math.min(...reports.map((r) => r.rms));
  check('loudness: every track RMS within +-3 dB of the six-track mean', reports.every((r) => Math.abs(r.rms - mean) <= 3), `mean ${mean.toFixed(1)} dB; ${reports.map((r) => `${r.id} ${r.rms}`).join(', ')}`);
  check('loudness: tracks are within 3 dB of each other (spread)', spread <= 3, `spread ${spread.toFixed(1)} dB`);
  check('no clipping and peaks <= -1 dBFS on all six', reports.every((r) => r.clips === 0 && r.peak <= -0.9), reports.map((r) => `${r.id} ${r.peak}`).join(', '));
  return out.join('\n');
}
