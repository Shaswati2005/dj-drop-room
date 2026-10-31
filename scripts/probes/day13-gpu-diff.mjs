// browser-run debug helper: which GPU resources appear between two calls (run twice)
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const w = window.__dropRoom.world;
    const geos = new Map();
    const texs = new Map();
    w.scene.traverse((o) => {
      if (o.geometry) geos.set(o.geometry.uuid, o.name || o.type);
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) for (const k of Object.keys(m)) if (m[k]?.isTexture) texs.set(m[k].uuid, `${o.name || o.type}.${k}`);
    });
    const prev = window.__gpuPrev ?? { geos: [], texs: [] };
    const gNew = [...geos].filter(([u]) => !prev.geos.includes(u)).map(([, n]) => n);
    const tNew = [...texs].filter(([u]) => !prev.texs.includes(u)).map(([, n]) => n);
    window.__gpuPrev = { geos: [...geos.keys()], texs: [...texs.keys()] };
    const r = w.renderer.info.memory;
    return { sceneGeos: geos.size, sceneTexs: texs.size, info: { geometries: r.geometries, textures: r.textures }, newGeos: gNew.slice(0, 20), newTexs: tNew.slice(0, 20) };
  }));
}
