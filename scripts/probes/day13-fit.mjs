// browser-run helper: where the console and its controls are in the head's view, in degrees from the
// view axis (horizontal = atan2(x, -z), vertical = atan2(y, -z), as the glasses' projection does).
// Meta VR Glasses see +-37 horizontally, +25 up and -43 down. Per control: the extent of the
// bounding boxes of its meshes; the console: the extent of every mesh box in the Console hierarchy
// (chassis, deck plates, crate shelf, settings plate, screens).
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(
    await app.evaluate(() => {
      const w = window.__dropRoom.world;
      const cam = w.renderer.xr.isPresenting ? w.renderer.xr.getCamera() : w.camera;
      cam.updateMatrixWorld(true);
      const inv = cam.matrixWorld.clone().invert();
      const V = w.camera.position.constructor;
      const extent = () => ({ h: [1e9, -1e9], v: [1e9, -1e9] });
      const grow = (e, wp) => {
        const q = wp.clone().applyMatrix4(inv);
        const h = (Math.atan2(q.x, -q.z) * 180) / Math.PI;
        const v = (Math.atan2(q.y, -q.z) * 180) / Math.PI;
        e.h[0] = Math.min(e.h[0], h);
        e.h[1] = Math.max(e.h[1], h);
        e.v[0] = Math.min(e.v[0], v);
        e.v[1] = Math.max(e.v[1], v);
      };
      const shown = (o) => {
        for (let n = o; n != null; n = n.parent) if (n.visible === false) return false;
        return true;
      };
      const meshExtent = (root, e) => {
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          if (!o.isMesh || !o.geometry || !shown(o)) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          for (let i = 0; i < 8; i++) grow(e, new V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld));
        });
      };
      const round = (e) => ({ h: e.h.map((x) => +x.toFixed(1)), v: e.v.map((x) => +x.toFixed(1)) });
      const out = { controls: {}, console: null };
      const CONTROL = /^(Pad|Mode|Jog|Tempo|Sync|Cue|Play|Trim|Hi|Mid|Low|Filter|Fader|Crossfader|Xf End|Fx|Drop|Load|Rec|Club|Share|Set|Start Pad) /;
      w.scene.traverse((o) => {
        if (!o.name || !(CONTROL.test(o.name + ' ') || o.name === 'Crossfader' || o.name === 'Drop' || o.name === 'Club' || o.name === 'Rec' || o.name === 'Share')) return;
        if (out.controls[o.name]) return;
        const e = extent();
        meshExtent(o, e);
        if (e.h[0] < 1e8) out.controls[o.name] = round(e);
      });
      const body = w.scene.getObjectByName('Console');
      const ce = extent();
      meshExtent(body, ce);
      out.console = round(ce);
      const head = new V();
      cam.getWorldPosition(head);
      out.head = { y: +head.y.toFixed(3) };
      return out;
    }),
  );
}
