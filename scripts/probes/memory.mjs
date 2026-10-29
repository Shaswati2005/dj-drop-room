// browser-run helper: JS heap, GPU resource counts and frame time
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(async () => {
    const r = window.__dropRoom.world.renderer;
    const m = performance.memory;
    const session = r.xr.getSession();
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (times.length < 60) (session ?? window).requestAnimationFrame(tick);
        else resolve();
      };
      (session ?? window).requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    return { heapMB: m ? +(m.usedJSHeapSize / 1e6).toFixed(1) : null, geometries: r.info.memory.geometries, textures: r.info.memory.textures, medianMs: +times[30].toFixed(1) };
  }));
}
