// browser-run helper: start the music and land a DROP (rig, beams, crowd on)
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 30000 });
  await app.evaluate(() => window.__dropRoom.engine().start());
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 10000 });
  await app.evaluate(() => window.__dropRoom.engine().drop());
  await app.waitForFunction(() => { const s = window.__dropRoom.engine().state; return s.drops > 0; }, null, { timeout: 15000 });
  return '"ok"';
}
