import type { Object3D, Vector3, WebGLRenderer } from '@iwsdk/core';

/** World position of a tracked hand's index fingertip into `out`, read from
 * the current XR frame; false when that hand is not tracked (or a controller
 * is in use). `player` is the XR origin the reference space is relative to. */
export function readFingertip(renderer: WebGLRenderer, player: Object3D, handedness: XRHandedness, out: Vector3): boolean {
  const xr = renderer.xr;
  const frame = xr.getFrame();
  const space = xr.getReferenceSpace();
  if (frame == null || space == null) return false;
  for (const source of frame.session.inputSources) {
    if (source.handedness !== handedness || source.hand == null) continue;
    const joint = source.hand.get('index-finger-tip');
    const pose = joint == null ? undefined : frame.getJointPose?.(joint, space);
    if (pose == null) return false;
    const { x, y, z } = pose.transform.position;
    player.localToWorld(out.set(x, y, z));
    return true;
  }
  return false;
}
