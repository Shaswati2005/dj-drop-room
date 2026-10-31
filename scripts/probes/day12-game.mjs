// browser-run helper: the Day 12 game state (settings, best, request, set stats, card) as JSON
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const d = window.__dropRoom;
    const g = d.game();
    const card = d.world.scene.getObjectByName('SummaryCard');
    const toast = d.world.scene.getObjectByName('RequestToast');
    const s = d.state();
    let stored = {};
    try { stored = { settings: localStorage.getItem('dropRoom.settings'), best: localStorage.getItem('dropRoom.best') }; } catch {}
    return { ...g, cardVisible: card?.visible ?? false, toastVisible: toast?.visible ?? false, running: s.running, playingA: s.A.playing, trackA: s.A.trackId, drops: s.drops, level: s.level, volume: d.engine().master.volume, reducedFlash: d.club().reducedFlash, stored };
  }));
}
