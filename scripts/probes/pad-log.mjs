// browser-run helper (debug): install, or read, a log of every engine.pad call
export default async function run({ page, frame }) {
  const app = frame ?? page;
  return JSON.stringify(await app.evaluate(() => {
    const e = window.__dropRoom.engine();
    if (!window.__padLog) {
      window.__padLog = [];
      const pad = e.pad.bind(e);
      e.pad = (deck, slot, down) => { window.__padLog.push(`${deck}${slot}${down ? 'v' : '^'}@${e.context.currentTime.toFixed(2)}`); return pad(deck, slot, down); };
      return 'installed';
    }
    return window.__padLog.join(' ');
  }));
}
