// browser-run helper: draw calls and triangles in MR and in club mode with the crowd
// at full size (hype pinned at 1.0). Starts the music if it is not running.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  const button = app.locator('#start-music');
  if (await button.isVisible()) await button.click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });
  const read = (label) =>
    app.evaluate(async (l) => {
      const d = window.__dropRoom;
      await new Promise((r) => setTimeout(r, 2500));
      const s = d.drawCalls();
      const c = d.crowd();
      const r = d.world.renderer;
      return { label: l, calls: s.calls, triangles: s.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, context: c.context, tier: c.tier, drawn: c.drawn ?? null, counts: c.counts, dancerCalls: c.drawCalls, lightHeads: d.lights().heads ?? null };
    }, label);
  const out = {};
  await app.evaluate(() => { window.__dropRoom.setClub(false); window.__dropRoom.forceHype(1); });
  out.mr = await read('mr');
  await app.evaluate(() => window.__dropRoom.setClub(true));
  out.club = await read('club');
  await app.evaluate(() => { window.__dropRoom.setClub(false); window.__dropRoom.forceHype(null); });
  return JSON.stringify(out);
}
