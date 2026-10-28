// browser-run helper: draw calls, triangles and frame time over ~2 s
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(async () => {
    const r = window.__dropRoom.world.renderer;
    r.info.autoReset = true;
    const session = r.xr.getSession();
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (times.length < 120) (session ?? window).requestAnimationFrame(tick);
        else resolve();
      };
      (session ?? window).requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    return { calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, medianMs: +times[60].toFixed(1), p95Ms: +times[114].toFixed(1) };
  }));
}
