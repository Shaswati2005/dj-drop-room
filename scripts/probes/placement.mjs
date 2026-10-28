// browser-run helper: where the console is and how it was placed
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const api = window.__dropRoom;
    let placement = '';
    for (const s of api.world.systems.values()) if (s.constructor.name === 'ConsolePlacementSystem') placement = s.placement;
    return { placement, console: api.worldPosition('Console') };
  }));
}
