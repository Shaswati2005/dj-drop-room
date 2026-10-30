// browser-run helper: where the club is, what it shows, how big the frame is
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const d = window.__dropRoom;
    const scene = d.world.scene;
    const V = scene.position.constructor;
    const room = scene.getObjectByName('Club Room') ?? scene.getObjectByName('ClubRoom');
    const cons = scene.getObjectByName('Console') ?? scene.getObjectByName('ConsoleBody');
    const wp = (o) => {
      if (!o) return null;
      const v = o.getWorldPosition(new V());
      return { x: v.x, y: v.y, z: v.z };
    };
    const h = d.world.camera.getWorldPosition(new V());
    const table = scene.getObjectByName('BoothTable');
    const r = d.world.renderer;
    return {
      club: d.club(),
      roomFound: room != null,
      roomVisible: room ? room.visible : null,
      roomPos: wp(room),
      consolePos: wp(cons),
      head: { x: h.x, y: h.y, z: h.z },
      tableHeight: table ? table.scale.y : null,
      fog: scene.fog != null,
      env: scene.environmentIntensity,
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
    };
  }));
}
