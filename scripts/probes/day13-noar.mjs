// browser-run helper: AR -> Club fallback. Makes immersive-ar fail like a browser without it
// (isSessionSupported false, requestSession rejects), tries to enter XR through IWSDK, and
// reports whether the page is still usable: start works, console visible, pad press reaches
// the engine, club toggle works, no uncaught errors.
export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.waitForFunction(() => window.__dropRoom != null, null, { timeout: 40000 });
  const errors = [];
  const onErr = (e) => errors.push(String(e.message ?? e));
  page.on('pageerror', onErr);
  const info = await app.evaluate(async () => {
    const d = window.__dropRoom;
    const xr = navigator.xr;
    const patched = { clubAtLoad: d.club().on, supportedBefore: await xr.isSessionSupported('immersive-ar') };
    window.__origReq = xr.requestSession.bind(xr);
    window.__origSup = xr.isSessionSupported.bind(xr);
    xr.requestSession = async () => {
      throw new DOMException('immersive-ar is not supported', 'NotSupportedError');
    };
    xr.isSessionSupported = async () => false;
    let launchError = null;
    try {
      const r = d.world.launchXR ? await d.world.launchXR() : 'no launchXR';
      patched.launch = String(r);
    } catch (e) {
      launchError = String(e);
    }
    patched.launchError = launchError;
    patched.presenting = d.world.renderer.xr.isPresenting;
    return patched;
  });
  await app.locator('#start-music').click();
  await app.waitForFunction(() => window.__dropRoom.state().A.playing, null, { timeout: 15000 });
  const usable = await app.evaluate(async () => {
    const d = window.__dropRoom;
    const en = d.engine();
    en.toggleStem('A', 'bass');
    await new Promise((r) => setTimeout(r, 2500));
    d.setClub(true);
    await new Promise((r) => setTimeout(r, 1500));
    const club = d.club();
    const calls = d.drawCalls();
    d.setClub(false);
    const xr = navigator.xr;
    xr.requestSession = window.__origReq;
    xr.isSessionSupported = window.__origSup;
    return { playing: d.state().A.playing, bassOff: d.state().A.stems[1] === 0, clubOn: club.on, calls: calls.calls, presenting: d.world.renderer.xr.isPresenting, consoleVisible: d.world.scene.getObjectByName('Console')?.visible ?? null };
  });
  page.off('pageerror', onErr);
  return JSON.stringify({ info, usable, pageErrors: errors });
}
