// browser-run helper: wait until ECHO or SPACE is held (up to 14 s), then sample the
// FX state every 100 ms for 2.4 s inside the page (CLI round trips are too slow to see a ramp)
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(async () => {
    const e = window.__dropRoom.engine();
    const pick = () => {
      const s = e.update();
      return { echo: s.echo, space: s.space, echoWet: s.echoWet, spaceWet: s.spaceWet, echoOut: s.echoOut, spaceOut: s.spaceOut };
    };
    const end = performance.now() + 14000;
    while (performance.now() < end && !(pick().echo || pick().space)) await new Promise((r) => setTimeout(r, 30));
    const series = [];
    for (let i = 0; i < 24; i++) {
      series.push(pick());
      await new Promise((r) => setTimeout(r, 100));
    }
    return { series };
  }));
}
