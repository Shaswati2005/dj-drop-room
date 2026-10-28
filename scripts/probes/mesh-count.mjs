// browser-run helper: visible meshes per top-level scene object
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const scene = window.__dropRoom.world.scene;
    const counts = {};
    scene.traverseVisible((o) => {
      if (!o.isMesh) return;
      let top = o;
      while (top.parent && top.parent !== scene && top.parent.parent !== scene) top = top.parent;
      const key = top.name || top.type;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }));
}
