// browser-run helper: leave club mode (back to mixed reality)
export default async function run({ page, frame }) {
  await (frame ?? page).evaluate(() => window.__dropRoom.setClub(false));
  return '"ok"';
}
