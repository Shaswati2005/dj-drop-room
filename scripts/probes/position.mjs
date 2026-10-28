// browser-run helper: deck A's playhead (as heard) and the audio context state
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const en = window.__dropRoom.engine();
    return { pos: en.decks.A.position(en.audibleTime()), ctx: en.context.rawContext.state };
  }));
}
