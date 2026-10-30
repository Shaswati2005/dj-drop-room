// browser-run helper: switch the reduced-flash flag on
export default async function run({ page, frame }) {
  await (frame ?? page).evaluate(() => window.__dropRoom.setReducedFlash(true));
  return '"ok"';
}
