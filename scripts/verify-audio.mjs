// Day 1 audio check (run with `npx @iwsdk/cli browser run scripts/verify-audio.mjs`):
// one click starts the loop, the transport advances, and an offline render
// of 4 bars has a kick on step 0 of every bar.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const results = [];
  const check = (label, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);

  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  const button = app.locator('#start-music');
  if (await button.isVisible()) await button.click();
  await app.waitForTimeout(2500);
  const s1 = await app.evaluate(() => window.__dropRoom.state());
  await app.waitForTimeout(2000);
  const s2 = await app.evaluate(() => window.__dropRoom.state());
  check('engine running after one click', s1.running === true);
  check('deck A playing Warm Start', s1.A.playing && s1.A.trackId === 'warm-start', s1.A.section);
  check('transport advances', s2.bar * 16 + s2.step > s1.bar * 16 + s1.step, `bar ${s1.bar}.${s1.beat} -> ${s2.bar}.${s2.beat}`);
  const peak = await app.evaluate(async () => { let m = 0; for (let i = 0; i < 12; i++) { m = Math.max(m, window.__dropRoom.state().level); await new Promise((r) => setTimeout(r, 100)); } return m; });
  check('master level peaks > 0.05 over 1.2 s (sound is flowing)', peak > 0.05, `peak ${peak.toFixed(3)}`);

  const t0 = Date.now();
  const intro = await app.evaluate(() => window.__dropRoom.renderOffline('warm-start', 4, 0));
  check('offline intro: kick on step 0 of all 4 bars', intro.kickOnBarStart.every(Boolean), JSON.stringify(intro.kickOnBarStart));
  const drop = await app.evaluate(() => window.__dropRoom.renderOffline('warm-start', 4, 16));
  check('offline drop: kick on step 0 of all 4 bars', drop.kickOnBarStart.every(Boolean), JSON.stringify(drop.kickOnBarStart));
  check('offline drop: peak <= -1 dBFS, no clips', drop.peakDb <= -0.9 && drop.clips === 0, `peak ${drop.peakDb} dB, clips ${drop.clips}`);
  results.push(`INFO intro rms ${intro.rmsDb} dB stems ${JSON.stringify(intro.stemRmsDb)}`);
  results.push(`INFO drop rms ${drop.rmsDb} dB stems ${JSON.stringify(drop.stemRmsDb)} (${Date.now() - t0} ms for 10 renders)`);
  return results.join('\n');
}
