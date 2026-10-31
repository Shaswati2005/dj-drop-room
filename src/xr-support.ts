/** The slice of `navigator.xr` the fallback needs (kept small so tests can fake it). */
export interface XrProbe {
  isSessionSupported(mode: string): Promise<boolean>;
}

/**
 * Can this browser start a mixed-reality (immersive-ar) session? False when
 * WebXR is missing, AR is unsupported (a desktop browser, a phone without AR)
 * or the check itself fails. The app then shows the club room on the flat page
 * instead of a console floating in a void (PLAN 0.6: MR with a Club fallback).
 */
export async function arSupported(xr: XrProbe | undefined | null): Promise<boolean> {
  if (xr == null || typeof xr.isSessionSupported !== 'function') return false;
  try {
    return (await xr.isSessionSupported('immersive-ar')) === true;
  } catch {
    return false;
  }
}
