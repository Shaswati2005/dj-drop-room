// browser-run helper: forget the Day 12 settings and best set (tests leave a clean slate)
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.evaluate(() => { try { localStorage.removeItem('dropRoom.settings'); localStorage.removeItem('dropRoom.best'); } catch {} });
  return JSON.stringify({ ok: true });
}
