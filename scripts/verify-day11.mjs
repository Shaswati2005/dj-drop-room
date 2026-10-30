// Day 11 check, part 1 (npx @iwsdk/cli browser run scripts/verify-day11.mjs --timeout 105000 --raw):
// the 6-slot crate and its badges (Airlock 2x over Rainy Tape), tracks 5 and 6
// load, play audibly on their beat grid and pass the offline sound metrics,
// and the ECHO / SPACE beat FX: the send rises while held, the tail keeps
// sounding after release and then decays, and every press is in the move log.
// Part 2 (crowd, lights, draw calls) is verify-day11-show.mjs; the hand-held
// FX presses are verify-day11-hands.mjs. Leave XR first.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const wait = (ms) => app.waitForTimeout(ms);
  const state = () => app.evaluate(() => window.__dropRoom.state());
  const press = (c) => app.evaluate((x) => window.__dropRoom.press(x), c);
  const engine = (fn, arg) => app.evaluate(fn, arg);

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  const button = app.locator('#start-music');
  if (await button.isVisible()) await button.click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });

  // ---- ECHO and SPACE (music is playing: Warm Start on A) --------------------
  await wait(2500);
  const fx0 = await state();
  check('FX are off and silent before they are held', !fx0.echo && !fx0.space && fx0.echoWet === 0 && fx0.spaceWet === 0);
  const t0 = await engine(() => {
    const e = window.__dropRoom.engine();
    e.holdEcho(true);
    e.holdSpace(true);
    return e.context.currentTime;
  });
  const wets = [];
  for (let i = 0; i < 9; i++) {
    await wait(300);
    const s = await state();
    wets.push({ e: s.echoWet, s: s.spaceWet, eo: s.echoOut, so: s.spaceOut, held: s.echo && s.space });
  }
  const echoWets = wets.map((w) => w.e);
  const spaceWets = wets.map((w) => w.s);
  check('ECHO and SPACE report held while the pads are down', wets.every((w) => w.held));
  check('the ECHO send rises while held (0 -> up to 0.6)', echoWets[8] > echoWets[0] && echoWets[8] > 0.3 && echoWets[8] <= 0.6 + 1e-6, echoWets.map((v) => v.toFixed(2)).join(' '));
  check('the SPACE send rises while held (0 -> up to 0.6)', spaceWets[8] > spaceWets[0] && spaceWets[8] > 0.3 && spaceWets[8] <= 0.6 + 1e-6, spaceWets.map((v) => v.toFixed(2)).join(' '));
  const monotonic = (a) => a.every((v, i) => i === 0 || v >= a[i - 1] - 1e-6);
  check('...smoothly (never drops while held)', monotonic(echoWets) && monotonic(spaceWets));
  const peakEcho = Math.max(...wets.map((w) => w.eo));
  const peakSpace = Math.max(...wets.map((w) => w.so));
  check('the echo return carries signal into the master while held', peakEcho > 0.004, `echo return peak ${peakEcho.toFixed(4)}`);
  check('the reverb return carries signal into the master while held', peakSpace > 0.004, `space return peak ${peakSpace.toFixed(4)}`);

  // release: the sends shut at once, the tails keep ringing, then die away
  const bar = await engine(() => 240 / window.__dropRoom.state().bpm);
  await engine(() => {
    const e = window.__dropRoom.engine();
    e.holdEcho(false);
    e.holdSpace(false);
  });
  await wait(400);
  const early = await state();
  check('on release the sends shut (wet back to 0)', early.echoWet < 0.01 && early.spaceWet < 0.01 && !early.echo && !early.space, `wet ${early.echoWet.toFixed(3)} / ${early.spaceWet.toFixed(3)}`);
  // sample the returns over the next 2 bars, keeping the loudest moments
  let tailEcho = 0;
  let tailSpace = 0;
  const until = Date.now() + bar * 2 * 1000 * 0.8;
  while (Date.now() < until) {
    const s = await state();
    tailEcho = Math.max(tailEcho, s.echoOut);
    tailSpace = Math.max(tailSpace, s.spaceOut);
    await wait(100);
  }
  check('the ECHO tail keeps ringing after release', Math.max(early.echoOut, tailEcho) > 0.003, `tail ${Math.max(early.echoOut, tailEcho).toFixed(4)} vs held peak ${peakEcho.toFixed(4)}`);
  check('the SPACE tail keeps ringing after release', Math.max(early.spaceOut, tailSpace) > 0.003, `tail ${Math.max(early.spaceOut, tailSpace).toFixed(4)} vs held peak ${peakSpace.toFixed(4)}`);
  await wait(bar * 1000 * 1.6);
  let late = { echoOut: 0, spaceOut: 0 };
  for (let i = 0; i < 6; i++) {
    const s = await state();
    late = { echoOut: Math.max(late.echoOut, s.echoOut), spaceOut: Math.max(late.spaceOut, s.spaceOut) };
    await wait(100);
  }
  check('the ECHO tail has decayed ~4 bars after release', late.echoOut < Math.max(peakEcho * 0.25, 0.003), `${late.echoOut.toFixed(4)} < ${(peakEcho * 0.25).toFixed(4)}`);
  check('the SPACE tail has decayed ~4 bars after release', late.spaceOut < Math.max(peakSpace * 0.25, 0.003), `${late.spaceOut.toFixed(4)} < ${(peakSpace * 0.25).toFixed(4)}`);
  const logged = await engine(() => window.__dropRoom.engine().log.moves.filter((m) => m[1] === 'E' || m[1] === 'S').map((m) => `${m[1]}${m[2]}`).join(','));
  check('both presses and releases are in the move log (share link / REC replay)', logged === 'E1,S1,E0,S0', logged);
  const startedOnGrid = await engine(() => {
    // a fresh press waits for the next 1/8: the send must still be 0 just before and rising after
    const e = window.__dropRoom.engine();
    const deck = e.decks[e.update().master];
    const now = e.context.currentTime;
    const next = deck.nextEighthTime(now);
    return { wait: next - now, eighth: 30 / deck.bpm };
  });
  check('the next 1/8 line is never more than an eighth away', startedOnGrid.wait > 0 && startedOnGrid.wait <= startedOnGrid.eighth + 1e-3, `${startedOnGrid.wait.toFixed(3)} s of ${startedOnGrid.eighth.toFixed(3)} s`);

  // ---- the crate: six slots ---------------------------------------------------
  await press('A.play'); // pause A
  await wait(200);
  const crate = await engine(() => window.__dropRoom.crate());
  check('the crate lists the 6 tracks with BPM and Camelot key', crate.map((c) => `${c.name} ${c.bpm} ${c.key}`).join(' | ') === 'Warm Start 124 8A | Concrete 128 8A | Mirrorball 120 9A | Rainy Tape 86 8B | Airlock 172 9A | Sunrise 124 8B', crate.map((c) => c.key).join(','));
  const byId = Object.fromEntries(crate.map((c) => [c.trackId, c]));
  // reference = deck A's Warm Start (124, 8A) while nothing else plays
  const refWarm = await engine(() => window.__dropRoom.crate().map((c) => `${c.trackId}:${c.badge}:${c.ratio}`).join(' '));
  check('against Warm Start: Concrete, Mirrorball, Sunrise green; Rainy Tape and Airlock grey (tempo would shift)', /concrete:green:\S* mirrorball:green:\S* rainy-tape:grey:\S* airlock:grey:\S* sunrise:green/.test(refWarm), refWarm);
  check('the shelf has the six slots in the right order', crate.length === 6 && byId.airlock != null && byId.sunrise != null);

  // ---- Rainy Tape on deck B, then Airlock over it at 2x ---------------------
  await engine(() => window.__dropRoom.engine().loadTrack('B', 'rainy-tape'));
  let s = await state();
  check('Rainy Tape loads (86 BPM)', s.B.status === 'ready' && s.B.trackId === 'rainy-tape' && Math.abs(s.B.bpm - 86) < 0.01, `${s.B.bpm}`);
  await press('B.play');
  await wait(600);
  const refRainy = await engine(() => window.__dropRoom.crate().map((c) => `${c.trackId}:${c.badge}:${c.ratio}`).join(' '));
  check('against Rainy Tape: Airlock shows the 2x tag (amber), Sunrise and Warm Start grey', /airlock:amber:2x/.test(refRainy) && /sunrise:grey:/.test(refRainy) && /warm-start:grey:/.test(refRainy), refRainy);
  await press('B.play'); // pause B so a track can be loaded onto it
  await wait(200);

  // ---- tracks 5 and 6 --------------------------------------------------------
  const tracks = [
    { id: 'airlock', bpm: 172, bars: 104 },
    { id: 'sunrise', bpm: 124, bars: 72 },
  ];
  for (const t of tracks) {
    await engine((id) => window.__dropRoom.engine().loadTrack('B', id), t.id);
    s = await state();
    check(`${t.id} loads on B`, s.B.status === 'ready' && s.B.trackId === t.id);
    const expected = (t.bars * 240) / t.bpm;
    check(`${t.id}: stem length = ${t.bars} bars at ${t.bpm} BPM (exact grid)`, Math.abs(s.B.duration - expected) < 0.05, `${s.B.duration.toFixed(3)} vs ${expected.toFixed(3)} s`);
    await press('B.play');
    await wait(2500);
    const rate = await engine(async () => {
      const e = window.__dropRoom.engine();
      const d = e.decks.B;
      const a = e.context.currentTime;
      const p0 = d.position(a);
      await new Promise((r) => setTimeout(r, 1000));
      const b = e.context.currentTime;
      return { speed: (d.position(b) - p0) / (b - a), playing: d.isRunning, bpm: d.bpm };
    });
    check(`${t.id} plays at its own speed on the beat grid`, rate.playing && Math.abs(rate.speed - 1) < 0.02 && Math.abs(rate.bpm - t.bpm) < 0.01, `speed ${rate.speed.toFixed(3)}, ${rate.bpm.toFixed(2)} BPM`);
    s = await state();
    check(`${t.id} is audible`, s.B.level > 0.01 || s.level > 0.01, `channel ${s.B.level.toFixed(3)}, master ${s.level.toFixed(3)}`);
    await press('B.play');
    await wait(250);
    const startBar = t.id === 'airlock' ? 24 : 16; // first drop bar
    const off = await engine(([id, bar]) => window.__dropRoom.renderOffline(id, 4, bar), [t.id, startBar]);
    check(`${t.id} offline drop: kick on step 0 of all 4 bars`, off.kickOnBarStart.every(Boolean), JSON.stringify(off.kickOnBarStart));
    check(`${t.id} offline drop: peak <= -1 dBFS, no clips`, off.peakDb <= -0.9 && off.clips === 0, `peak ${off.peakDb} dB, rms ${off.rmsDb} dB`);
    check(`${t.id}: all four stems carry signal`, Object.values(off.stemRmsDb).every((x) => x > -60), JSON.stringify(off.stemRmsDb));
    check(`${t.id}: loud enough (rms >= -24 dBFS)`, off.rmsDb >= -24, `${off.rmsDb} dB`);
  }

  // ---- Airlock rides at 2x over Rainy Tape (SYNC) ---------------------------
  await engine(() => window.__dropRoom.engine().loadTrack('A', 'rainy-tape'));
  await engine(() => window.__dropRoom.engine().loadTrack('B', 'airlock'));
  await press('A.play');
  await wait(400);
  await press('B.sync');
  await press('B.play');
  await wait(2800);
  const lock = await engine(() => {
    const e = window.__dropRoom.engine();
    const s = e.update();
    const a = e.decks.A;
    const b = e.decks.B;
    const t = e.context.currentTime + 0.03;
    // one Rainy Tape bar = two Airlock bars: compare the bar phase of B against 2x that of A
    const pa = ((a.position(t) / a.barSeconds) * 2) % 1;
    const pb = (b.position(t) / b.barSeconds) % 1;
    let d = Math.abs(pa - pb);
    d = Math.min(d, 1 - d);
    return { rateB: b.rate, bpmA: a.bpm, bpmB: b.bpm, phase: d, playing: s.A.playing && s.B.playing };
  });
  check('SYNC puts Airlock at exactly twice Rainy Tape\'s tempo (no stretching)', lock.playing && Math.abs(lock.bpmB - 2 * lock.bpmA) < 0.05 && Math.abs(lock.rateB - 1) < 0.01, `A ${lock.bpmA.toFixed(2)} BPM, B ${lock.bpmB.toFixed(2)} BPM, rate ${lock.rateB.toFixed(3)}`);
  check('...and its bars line up with two of Rainy Tape\'s per bar', lock.phase < 0.08, `phase error ${lock.phase.toFixed(3)} bar`);
  await press('A.play');
  await press('B.play');
  return out.join('\n');
}
