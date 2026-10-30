import { RIG_HEADS } from '../scene-assets/light-rig.scene-asset.js';

/**
 * What the light show is doing, written by LightShowSystem; read by the club
 * (floor pools), by tests (`__dropRoom.lights()`) and for the draw-call budget.
 */
export const lights = {
  /** hype tier 0..3 from the crowd energy */
  tier: 0,
  /** moving heads lit by the tier: 4, 4, 6, 8 */
  beamsOn: 0,
  /** riser dimming: 1 = full, 0.4 at the top of the riser, ~0.08 on the gap beat before the drop */
  dim: 1,
  /** the drop burst this frame, 0..1, after the reduced-flash cap */
  burst: 0,
  /** sweep speed multiplier: 1, or up to 3 during the two bars after a drop */
  sweep: 1,
  /** brightest value the beams were driven to since the last reset (after the strobe guard) */
  peak: 0,
  /** biggest burst since the last reset */
  burstPeak: 0,
  /** sharp rises the strobe guard let through since the last reset */
  sharpRises: 0,
  /** frames in which a sharp rise came faster than 3 per second (must stay 0) */
  violations: 0,
  /** current beam colour per head (r, g, b), read by the club's floor pools */
  colors: new Float32Array(RIG_HEADS * 3),
};

export function resetLightPeaks(): void {
  lights.peak = 0;
  lights.burstPeak = 0;
  lights.sharpRises = 0;
  lights.violations = 0;
}
