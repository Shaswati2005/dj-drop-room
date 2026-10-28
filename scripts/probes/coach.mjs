// browser-run helper: the coach's step and where its ring is; `?reset` in the
// script name is not supported, so pass reset through localStorage first
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const w = window.__dropRoom.world;
    let step = -1;
    for (const s of w.systems.values()) if (s.constructor.name === 'CoachSystem') step = s.step;
    const ring = w.scene.getObjectByName('CoachRing');
    let stored = null;
    try { stored = localStorage.getItem('dropRoom.coached'); } catch {}
    return { step, ringVisible: ring?.visible ?? false, stored };
  }));
}
