// browser-run helper: the handful of fields the video shot driver checks
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(
    await app.evaluate(() => {
      const d = window.__dropRoom;
      const s = d.state();
      const g = d.game();
      const card = d.world.scene.getObjectByName('SummaryCard');
      const dimmer = d.world.scene.getObjectByName('RoomDimmer');
      const view = (v) => ({ playing: v.playing, trackId: v.trackId, status: v.status, stems: [...v.stems], filter: v.knobs[4] });
      return {
        running: s.running,
        A: view(s.A),
        B: view(s.B),
        crossfader: s.crossfader,
        drops: s.drops,
        dropping: s.dropping,
        moves: s.moves,
        echo: s.echo,
        dim: dimmer?.material?.opacity ?? 0,
        club: d.club().on,
        tier: d.crowd().tier,
        finished: g.finished,
        summary: g.summary,
        requestShown: g.request.shown,
        reducedFlash: g.settings.reducedFlash,
        volume: g.settings.volume,
        dimSetting: g.settings.dim,
        tourId: g.tourId,
        refusals: s.refusals,
        echoWet: s.echoWet,
        cardUp: g.finished && (card?.visible ?? false),
        best: g.best,
      };
    }),
  );
}
