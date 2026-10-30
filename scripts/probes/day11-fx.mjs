// browser-run helper: the beat-FX state (held, send levels, return levels, move count)
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const e = window.__dropRoom.engine();
    const s = e.update();
    return { echo: s.echo, space: s.space, echoWet: s.echoWet, spaceWet: s.spaceWet, echoOut: s.echoOut, spaceOut: s.spaceOut, moves: s.moves };
  }));
}
