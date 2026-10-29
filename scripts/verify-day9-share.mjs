// Day 9 share-link check (npx @iwsdk/cli browser run scripts/verify-day9-share.mjs
// --timeout 105000 --raw): perform a short set, build its link, reload the page
// on that link, press Start, and check that the replay ends in the same state
// (same tracks, deck B started on the same bar, same stems, knobs, crossfader,
// FX), and that the replay does not log itself. Leave XR first.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const wait = (ms) => app.waitForTimeout(ms);
  const press = (c) => app.evaluate((x) => window.__dropRoom.press(x), c);
  const engine = (fn, arg) => app.evaluate(fn, arg);

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  const hash0 = await app.evaluate(() => location.hash);
  check('the page starts without a set link', hash0 === '');
  await app.locator('#start-music').click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });

  // actions are taken in the middle of a bar, so a few ms of jitter cannot move
  // a quantised change onto a different bar line
  const midBar = () =>
    app.evaluate(async () => {
      const e = window.__dropRoom.engine();
      for (;;) {
        const t = e.context.currentTime;
        const ph = (e.decks.A.position(t) / e.decks.A.barSeconds) % 1;
        if (ph > 0.25 && ph < 0.55) return;
        await new Promise((r) => setTimeout(r, 15));
      }
    });
  // what the set did to the controls, plus where B sits against A in bars
  const snapshot = () =>
    app.evaluate(() => {
      const w = window.__dropRoom;
      const e = w.engine();
      const s = w.state();
      const t = e.context.currentTime;
      return {
        a: s.A.trackId,
        b: s.B.trackId,
        bPlaying: s.B.playing,
        aStems: s.A.stems.join(''),
        aLow: s.A.knobs[3],
        bFader: s.B.fader,
        crossfader: s.crossfader,
        echo: s.echo,
        aPadMode: s.A.padMode,
        bpmB: Math.round(s.B.bpm * 100) / 100,
        barsApart: e.decks.A.position(t) / e.decks.A.barSeconds - e.decks.B.position(t) / e.decks.B.barSeconds,
        moves: e.log.moves.length,
      };
    });

  // ---- perform ---------------------------------------------------------------
  await engine(() => window.__dropRoom.engine().requestLoad('B', 'mirrorball'));
  await app.waitForFunction(() => window.__dropRoom.state().B.status === 'ready', null, { timeout: 15000 });
  await wait(1200);
  await press('B.sync');
  await midBar();
  await press('B.play');
  await wait(1500);
  await midBar();
  await press('A.bass');
  await engine(() => {
    const e = window.__dropRoom.engine();
    e.setKnob('A', 'low', 0.4);
    e.setFader('B', 0.7);
    e.setPadMode('A', 'cues');
    e.toggleEcho();
  });
  await wait(600);
  // a slow crossfader drag (many samples) ends at 0.4
  await engine(async () => {
    const e = window.__dropRoom.engine();
    for (let i = 0; i <= 40; i++) {
      e.setCrossfader((i / 40) * 0.4);
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  await wait(2800); // the stem change lands on the next bar line
  const before = await snapshot();
  const url = await engine(() => window.__dropRoom.setUrl());
  check('performed set has the expected final state', before.b === 'mirrorball' && before.bPlaying && before.aStems === '1011' && Math.abs(before.aLow - 0.4) < 0.011 && before.echo && before.aPadMode === 'cues' && Math.abs(before.crossfader - 0.4) < 0.011, JSON.stringify(before));
  check('the crossfader drag was compacted', before.moves < 40, `${before.moves} moves`);
  check('link carries the set', url.includes('#set='), `${url.length} chars`);

  // ---- replay from the link ----------------------------------------------
  try {
    await app.evaluate((u) => {
      history.replaceState(null, '', u);
      location.reload();
    }, url);
  } catch {
    // the page went away mid-call, as expected
  }
  await wait(4000);
  await app.waitForFunction(() => window.__dropRoom != null && window.__dropRoom.state().replayTotal > 0, null, { timeout: 30000 });
  const label = await app.locator('#start-music').textContent();
  check('opening the link offers to play the shared set', /shared set/i.test(label), label);
  const queued = await engine(() => window.__dropRoom.state());
  check('moves are queued, not started: music silent until Start', queued.replayTotal === before.moves && !queued.running && queued.replayDone === 0, `${queued.replayTotal} moves`);
  await app.locator('#start-music').click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });
  await app.waitForFunction(() => { const s = window.__dropRoom.state(); return s.replayTotal > 0 && s.replayDone === s.replayTotal && !s.replaying; }, null, { timeout: 40000 });
  check('replay played every move', true);
  await wait(3200); // quantised changes land
  const after = await snapshot();
  const same = (k) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
  check('replay: same tracks on A and B', same('a') && same('b'), `${after.a}/${after.b}`);
  check('replay: B playing, stems, pad mode, echo match', after.bPlaying && same('aStems') && same('aPadMode') && same('echo'), `${after.aStems} ${after.aPadMode} echo ${after.echo}`);
  check('replay: knob, fader and crossfader values match', Math.abs(after.aLow - before.aLow) < 0.011 && Math.abs(after.bFader - before.bFader) < 0.011 && Math.abs(after.crossfader - before.crossfader) < 0.011, `low ${after.aLow} fader ${after.bFader} xf ${after.crossfader}`);
  check('replay: deck B started on the same bar (same phase against A)', Math.abs(after.barsApart - before.barsApart) < 0.05, `${before.barsApart.toFixed(3)} vs ${after.barsApart.toFixed(3)} bars`);
  check('replay: tempo matches', same('bpmB'), `${after.bpmB} BPM`);
  check('the replay did not log itself', after.moves === 0, `${after.moves} moves`);
  // leave the page on a plain URL: later tests reload it and must not replay this set
  await app.evaluate(() => history.replaceState(null, '', location.pathname));
  return out.join('\n');
}
