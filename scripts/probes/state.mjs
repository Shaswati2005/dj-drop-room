// browser-run helper: running flag and deck A bass stem
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => { const s = window.__dropRoom.state(); return { running: s.running, bassA: s.A.stems[1] }; }));
}
