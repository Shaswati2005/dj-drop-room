// browser-run helper for soak.mjs: day13-cycle.mjs calibration mode off (same script, no app work)
export default async function run({ page, frame }) {
  await (frame ?? page).evaluate(() => { window.__noopCycle = false; });
  return JSON.stringify({ noopCycle: false });
}
