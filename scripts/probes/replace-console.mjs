// browser-run helper: re-place the console from the current head pose (as at session start)
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.evaluate(() => {
    for (const s of window.__dropRoom.world.systems.values()) if (s.constructor.name === 'ConsolePlacementSystem') s.pending = true;
  });
  await app.waitForTimeout(1500);
  return '"ok"';
}
