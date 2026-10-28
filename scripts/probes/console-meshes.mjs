// browser-run helper: the console body's meshes grouped by name prefix
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const c = window.__dropRoom.world.scene.getObjectByName('Console');
    const counts = {};
    c.traverseVisible((o) => {
      if (!o.isMesh) return;
      const key = (o.name || o.parent?.name || '?').replace(/[_\d]+$/, '').replace(/ [AB]$/, '');
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);
  }));
}
