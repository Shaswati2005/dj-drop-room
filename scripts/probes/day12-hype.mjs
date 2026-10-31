// browser-run helper: pin the crowd hot for ~2.5 s so a hands-driven set has a peak to report
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.evaluate(() => { window.__dropRoom.forceHype(0.9); setTimeout(() => window.__dropRoom.forceHype(null), 2500); });
  return JSON.stringify({ ok: true });
}
