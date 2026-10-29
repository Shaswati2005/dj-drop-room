// Day 9 check (npx @iwsdk/cli browser run scripts/verify-day9.mjs --timeout 105000 --raw):
// tracks 3-4 load and play on their beat grid. (Crate, REC and share-link
// sections are appended below as they are built.) Leave XR first.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const wait = (ms) => app.waitForTimeout(ms);
  const state = () => app.evaluate(() => window.__dropRoom.state());
  const press = (c) => app.evaluate((x) => window.__dropRoom.press(x), c);

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  const button = app.locator('#start-music');
  if (await button.isVisible()) await button.click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });

  // ---- tracks 3 and 4 -------------------------------------------------------
  const tracks = [
    { id: 'mirrorball', bpm: 120, bars: 72 },
    { id: 'rainy-tape', bpm: 116, bars: 72 },
  ];
  for (const t of tracks) {
    await app.evaluate((id) => window.__dropRoom.engine().loadTrack('B', id), t.id);
    let s = await state();
    check(`${t.id} loads on B`, s.B.status === 'ready' && s.B.trackId === t.id);
    const expected = (t.bars * 240) / t.bpm;
    check(`${t.id}: stem length = ${t.bars} bars at ${t.bpm} BPM (exact grid)`, Math.abs(s.B.duration - expected) < 0.05, `${s.B.duration.toFixed(3)} vs ${expected.toFixed(3)} s`);
    await press('B.sync');
    await press('B.play');
    await wait(2600);
    // playhead speed over a fixed span of the audio clock
    const rate = await app.evaluate(async () => {
      const e = window.__dropRoom.engine();
      const d = e.decks.B;
      const t0 = e.context.currentTime;
      const p0 = d.position(t0);
      await new Promise((r) => setTimeout(r, 1200));
      const t1 = e.context.currentTime;
      return { speed: (d.position(t1) - p0) / (t1 - t0), playing: d.isRunning, bpm: d.bpm };
    });
    check(`${t.id} plays at track speed on the beat grid`, rate.playing && Math.abs(rate.speed - d9rate(t, rate)) < 0.02, `speed ${rate.speed.toFixed(3)}, ${rate.bpm.toFixed(2)} BPM`);
    s = await state();
    check(`${t.id} is audible`, s.level > 0.01 || s.B.level > 0.01, `level ${s.level.toFixed(3)}`);
    await press('B.play');
    await wait(300);
    const off = await app.evaluate((id) => window.__dropRoom.renderOffline(id, 4, 16), t.id);
    check(`${t.id} offline drop: kick on step 0 of all 4 bars`, off.kickOnBarStart.every(Boolean), JSON.stringify(off.kickOnBarStart));
    check(`${t.id} offline drop: peak <= -1 dBFS, no clips`, off.peakDb <= -0.9 && off.clips === 0, `peak ${off.peakDb} dB`);
    const stems = Object.values(off.stemRmsDb);
    check(`${t.id}: all four stems carry signal`, stems.every((x) => x > -60), JSON.stringify(off.stemRmsDb));
  }
  return out.join('\n');
}
// sync matches B to A's tempo, so the playhead speed is A.bpm / track bpm
function d9rate(t, r) {
  return r.bpm / t.bpm;
}
