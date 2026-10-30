export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.evaluate(() => window.__dropRoom.setClub(true));
  return '"ok"';
}
