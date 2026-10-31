// browser-run helper: JS heap after a forced garbage collection (CDP HeapProfiler), plus the
// GPU resource counts. Falls back to the raw reading when CDP is not available.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  let forced = false;
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.detach();
    forced = true;
  } catch {}
  return JSON.stringify(
    await app.evaluate((f) => {
      const r = window.__dropRoom.world.renderer;
      const m = performance.memory;
      return { forcedGc: f, heapMB: +(m.usedJSHeapSize / 1e6).toFixed(1), totalMB: +(m.totalJSHeapSize / 1e6).toFixed(1), geometries: r.info.memory.geometries, textures: r.info.memory.textures };
    }, forced),
  );
}
