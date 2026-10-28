// browser-run helper (debug): stems, armed stems, drop flags, coach step
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const s = window.__dropRoom.state();
    const d = window.__dropRoom.engine().decks.A;
    let coach = -1;
    for (const sys of window.__dropRoom.world.systems.values()) if (sys.constructor.name === 'CoachSystem') coach = sys.step;
    return { stemsA: s.A.stems.join(''), armed: d.stemArmed?.map(Number).join(''), dropping: s.dropping, drops: s.drops, coach };
  }));
}
