// browser-run helper: cold start. Time from the START press (the click event reaching the page)
// to the first kick being HEARD: deck A playing as heard (audio clock minus output latency), its
// playhead at the top of the track (a kick on step 0). Run on a freshly reloaded page.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.waitForFunction(() => window.__dropRoom != null && document.getElementById('start-music') != null, null, { timeout: 40000 });
  await app.evaluate(() => {
    window.__cold = { t0: 0 };
    document.getElementById('start-music').addEventListener('click', () => (window.__cold.t0 = performance.now()), { capture: true });
  });
  const pre = await app.evaluate(() => ({ pageAgeMs: Math.round(performance.now()), ctx: window.__dropRoom.engine().context.rawContext.state, A: window.__dropRoom.state().A.status, B: window.__dropRoom.state().B.status }));
  await app.locator('#start-music').click();
  const r = await app.evaluate(
    () =>
      new Promise((resolve) => {
        const d = window.__dropRoom;
        const en = d.engine();
        const poll = () => {
          const s = d.state();
          const now = performance.now();
          if (s.A.playing) {
            resolve({ ok: true, ms: Math.round(now - window.__cold.t0), pos: +s.A.position.toFixed(3), latencyMs: +s.latencyMs.toFixed(1), ctx: en.context.rawContext.state, heardMinusStart: +(s.heard).toFixed(3) });
          } else if (now - window.__cold.t0 > 15000) resolve({ ok: false, ms: -1 });
          else setTimeout(poll, 4);
        };
        poll();
      }),
  );
  return JSON.stringify({ pre, ...r });
}
