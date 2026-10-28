// Day 3 deck check (npx @iwsdk/cli browser run scripts/verify-decks.mjs):
// file-based decks behave like DJ decks — cold start, stems on the bar,
// quantised PLAY, tempo fader, SYNC, CUE, instant pause.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const out = [];
  const check = (label, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
  const wait = (ms) => app.waitForTimeout(ms);
  const state = () => app.evaluate(() => window.__dropRoom.state());
  const press = (c) => app.evaluate((x) => window.__dropRoom.press(x), c);
  // where each deck is inside its bar, 0..1, read at one audio instant
  const phases = () =>
    app.evaluate(() => {
      const e = window.__dropRoom.engine();
      const t = e.context.currentTime;
      const ph = (d) => (d.position(t) / d.barSeconds) % 1;
      return { a: ph(e.decks.A), b: ph(e.decks.B) };
    });
  const phaseGap = ({ a, b }) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  // timed inside the page: the automation click itself can take seconds
  await app.evaluate(() => {
    document.getElementById('start-music').addEventListener('click', () => (window.__clickAt = performance.now()), { once: true });
  });
  await app.locator('#start-music').click();
  const startMs = await app.evaluate(async () => {
    while (!window.__dropRoom.state().A.playing) await new Promise((r) => setTimeout(r, 5));
    return performance.now() - window.__clickAt;
  });
  check('cold start: Start click to deck A heard <= 2 s', startMs <= 2000, `${startMs.toFixed(0)} ms`);
  let s = await state();
  check('Warm Start on A, Concrete waiting on B', s.A.status === 'ready' && s.B.status === 'ready' && s.A.trackId === 'warm-start' && s.B.trackId === 'concrete');

  // stems on the bar line
  await press('A.bass');
  await wait(2300);
  const t = await app.evaluate(() => window.__dropRoom.timing());
  const onLine = Math.min(t.barPhase, 1 - t.barPhase) < 0.005;
  check('bass toggle applied on the bar line', onLine && t.commitAt - t.pressAt <= t.barSeconds + 0.15,
    `phase ${t.barPhase.toFixed(4)}, waited ${(t.commitAt - t.pressAt).toFixed(2)} s`);
  s = await state();
  check('bass heard off', s.A.stems[1] === 0);
  await press('A.bass');

  // match B's tempo first (Concrete is 128 BPM), then quantised PLAY starts B
  // on A's bar line, so they are in phase
  await press('B.sync');
  await press('B.play');
  await wait(2500);
  s = await state();
  check('deck B playing', s.B.playing === true);
  check('B started on A\'s bar line (in phase)', phaseGap(await phases()) < 0.01, JSON.stringify(await phases()));

  // tempo fader: +4 % drifts B away; SYNC brings it back
  await app.evaluate(() => window.__dropRoom.tempo('B', 0.5));
  await wait(1500);
  s = await state();
  check('tempo fader +0.5 → Concrete at 128 × 1.04', Math.abs(s.B.bpm - 133.12) < 0.01, `${s.B.bpm.toFixed(2)} BPM`);
  check('B drifted out of phase', phaseGap(await phases()) > 0.01, JSON.stringify(await phases()));
  await press('B.sync');
  await wait(300);
  s = await state();
  check('SYNC: B tempo matches A', Math.abs(s.B.bpm - s.A.bpm) < 0.01, `${s.B.bpm.toFixed(2)} vs ${s.A.bpm.toFixed(2)}`);
  check('SYNC: B back in phase', phaseGap(await phases()) < 0.01, JSON.stringify(await phases()));

  // instant pause, CUE
  await press('B.play');
  await wait(300);
  const p1 = (await state()).B.position;
  await wait(500);
  const p2 = (await state()).B.position;
  check('PAUSE is instant and holds the playhead', !((await state()).B.playing) && Math.abs(p2 - p1) < 0.001, `${p1.toFixed(3)} s`);
  await press('B.cue');
  s = await state();
  const beat = 240 / 128 / 4;
  check('CUE while paused sets the cue point on the nearest beat', Math.abs(s.B.cuePoint / beat - Math.round(s.B.cuePoint / beat)) < 1e-6 && Math.abs(s.B.cuePoint - p2) <= beat / 2,
    `cue ${s.B.cuePoint.toFixed(3)} s`);
  const cuePoint = s.B.cuePoint;
  await press('B.play');
  await wait(2500);
  await press('B.cue');
  await wait(200);
  s = await state();
  check('CUE while playing returns to the cue point and stops', !s.B.playing && Math.abs(s.B.position - cuePoint) < 1e-6, `${s.B.position.toFixed(3)} s`);

  const peak = await app.evaluate(async () => {
    let m = 0;
    for (let i = 0; i < 12; i++) {
      m = Math.max(m, window.__dropRoom.state().level);
      await new Promise((r) => setTimeout(r, 100));
    }
    return m;
  });
  check('sound flowing from the stem files', peak > 0.05, `peak ${peak.toFixed(3)}`);
  return out.join('\n');
}
