// browser-run helper: horizontal/vertical angles (deg) of key elements in the
// camera's frame; glasses view is ±37° across, +25°/-43° up/down
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const w = window.__dropRoom.world;
    const cam = w.renderer.xr.isPresenting ? w.renderer.xr.getCamera() : w.camera;
    cam.updateMatrixWorld();
    const inv = cam.matrixWorld.clone().invert();
    const V = w.camera.position.constructor;
    const ang = (p) => { const q = p.clone().applyMatrix4(inv); return [+(Math.atan2(q.x, -q.z) * 57.3).toFixed(1), +(Math.atan2(q.y, -q.z) * 57.3).toFixed(1)]; };
    const out = {};
    const body = w.scene.getObjectByName('Console');
    // corners of the console body in its own frame
    body.updateMatrixWorld();
    const g = []; body.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); g.push(o); } });
    let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
    const inv2 = body.matrixWorld.clone().invert();
    for (const o of g) { const b = o.geometry.boundingBox; for (let i = 0; i < 8; i++) { const p = new V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld).applyMatrix4(inv2); min = [Math.min(min[0], p.x), Math.min(min[1], p.y), Math.min(min[2], p.z)]; max = [Math.max(max[0], p.x), Math.max(max[1], p.y), Math.max(max[2], p.z)]; } }
    for (const [n, x, z] of [['nearL', min[0], max[2]], ['nearR', max[0], max[2]], ['farL', min[0], min[2]], ['farR', max[0], min[2]]]) out[n] = ang(new V(x, max[1], z).applyMatrix4(body.matrixWorld));
    for (const n of ['Start Pad', 'Pad A Bass', 'Drop', 'Play B', 'Xf End B', 'Jog A', 'CoachLabel', 'Light Rig', 'Crowd']) { const o = w.scene.getObjectByName(n); if (o?.visible !== undefined) out[n] = ang(o.getWorldPosition(new V())); }
    return out;
  }));
}
