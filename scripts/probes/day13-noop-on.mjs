// browser-run helper for soak.mjs: day13-cycle.mjs calibration mode on (same script, no app work)
export default async function run({ page, frame }) {
  await (frame ?? page).evaluate(() => { window.__noopCycle = true; });
  return JSON.stringify({ noopCycle: true });
}
