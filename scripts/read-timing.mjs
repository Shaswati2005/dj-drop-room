// Helper for verify-console.mjs: the engine's last press/commit times.
export default async function run({ page, frame }) {
  return JSON.stringify(await (frame ?? page).evaluate(() => window.__dropRoom.timing()));
}
