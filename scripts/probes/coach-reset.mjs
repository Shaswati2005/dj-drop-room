// browser-run helper: forget that the player was coached
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.evaluate(() => { try { localStorage.removeItem('dropRoom.coached'); } catch {} });
  return '"ok"';
}
