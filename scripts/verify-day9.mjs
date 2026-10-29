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
  // ---- crate: badges, loading, refusing a playing deck -----------------------
  // (A plays Warm Start, B is parked on Rainy Tape)
  const crate = await app.evaluate(() => window.__dropRoom.crate());
  check('crate lists the 4 tracks with BPM and Camelot key', crate.map((c) => `${c.name} ${c.bpm} ${c.key}`).join(' | ') === 'Warm Start 124 8A | Concrete 128 8A | Mirrorball 120 9A | Rainy Tape 116 8B', crate.map((c) => c.key).join(','));
  check('badges match against the playing deck: key +-1 and tempo +-6 %', crate.map((c) => c.match).join() === 'false,true,true,false', crate.map((c) => c.match).join());
  check('badges show which deck holds a track', crate[3].onB && crate[0].onA && !crate[1].onA && !crate[1].onB);
  let r = await app.evaluate(() => window.__dropRoom.engine().requestLoad('A', 'concrete'));
  await wait(300);
  let s2 = await state();
  check('loading onto the PLAYING deck is refused; the music keeps playing', r === 'refused' && s2.A.trackId === 'warm-start' && s2.A.playing && s2.refusedDeck === 'A' && s2.heard - s2.refusedAt < 2, `${r}, A=${s2.A.trackId}`);
  r = await app.evaluate(() => window.__dropRoom.engine().requestLoad('B', 'mirrorball'));
  await app.waitForFunction(() => window.__dropRoom.state().B.status === 'ready', null, { timeout: 15000 });
  s2 = await state();
  check('loading onto the idle deck B works', r === 'loading' && s2.B.trackId === 'mirrorball', s2.B.trackName);
  await press('B.sync');
  await press('B.play');
  await wait(2500);
  r = await app.evaluate(() => window.__dropRoom.engine().requestLoad('B', 'rainy-tape'));
  s2 = await state();
  check('a deck that has just been started is refused too', r === 'refused' && s2.B.trackId === 'mirrorball' && s2.B.playing);
  const crate2 = await app.evaluate(() => window.__dropRoom.crate());
  check('badges follow the deck: Mirrorball is now on B', crate2[2].onB && !crate2[3].onB);
  await press('B.play');
  await wait(300);

  // ---- REC: master output to an audio file --------------------------------
  const rec = await app.evaluate(async () => {
    const e = window.__dropRoom.engine();
    e.recorder.start();
    const during = e.update().recording;
    await new Promise((res) => setTimeout(res, 2600));
    const blob = await e.recorder.stop();
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    return { during, size: blob.size, type: blob.type, seconds: audio.duration, peak, kept: e.recorder.blob === blob, after: e.update().recording, takes: e.update().takes };
  });
  check('REC: recording flag on while recording, off after', rec.during === true && rec.after === false && rec.takes === 1);
  check('REC: a non-empty audio Blob', rec.size > 4000 && /^audio\//.test(rec.type), `${rec.size} bytes ${rec.type}`);
  check('REC: the file decodes to about the recorded length and has sound', rec.seconds > 2 && rec.seconds < 3.6 && rec.peak > 0.02, `${rec.seconds.toFixed(2)} s, peak ${rec.peak.toFixed(3)}`);
  check('REC: the Blob is kept for saving after XR', rec.kept);
  await wait(700);
  const saveVisible = await app.evaluate(async () => {
    await window.__dropRoom.offerRecording();
    return !document.getElementById('save-recording').hidden && !document.getElementById('set-tools').hidden;
  });
  check('REC: "Save recording" button is on the page', saveVisible);

  // ---- move log and share link ---------------------------------------------
  const log = await app.evaluate(async () => {
    const e = window.__dropRoom.engine();
    const url = await window.__dropRoom.setUrl();
    const { decodeMoves, setFromHash } = await import('/src/audio/move-log.ts');
    const decoded = await decodeMoves(setFromHash(new URL(url).hash));
    return { url, moves: JSON.parse(JSON.stringify(e.log.moves)), decoded, origin: location.origin };
  });
  check('share link is built on location.origin with a #set= hash', log.url.startsWith(log.origin) && /#set=[zj][A-Za-z0-9_-]+$/.test(log.url), `${log.url.length} chars`);
  check('the link round-trips the move log', JSON.stringify(log.decoded) === JSON.stringify(log.moves) && log.moves.length > 5, `${log.moves.length} moves`);
  const ops = log.moves.map((m) => m[1]).join('');
  check('log holds the loads and plays but not the refused load', ops.split('L').length - 1 === 1 && ops.includes('p') && ops.includes('s'), ops);
  check('log is compact (< 1.2 KB of link for this set)', log.url.length - log.url.indexOf('#') < 1200, `${log.url.length - log.url.indexOf('#')} chars`);
  return out.join('\n');
}
// sync matches B to A's tempo, so the playhead speed is A.bpm / track bpm
function d9rate(t, r) {
  return r.bpm / t.bpm;
}
