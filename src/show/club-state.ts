/**
 * Club mode (PLAN-DJ-UPGRADE §3.4): a full-VR warehouse around the booth that
 * hides passthrough. Mixed reality stays the default; the CLUB button on the
 * console (or `__dropRoom.setClub`) flips this.
 */
export const club = {
  on: false,
  /** how many times it has been switched, for tests */
  changes: 0,
  /**
   * Reduced-flash mode (PLAN §5.2). There is no settings panel yet (Day 12);
   * until then this flag is the single switch. When true, the drop flash on
   * the LED wall and blinders is cut to a faint glow. Even when false, flashes
   * are one smooth fade per drop, never a strobe.
   */
  reducedFlash: false,
  /** sum of the LED wall's pixel values this frame (0 while the club is off): proves the wall reacts */
  ledLuma: 0,
};

export function setClub(on: boolean): void {
  if (club.on === on) return;
  club.on = on;
  club.changes++;
}

/** The light rig, enlarged to hang over the booth: height above the floor (m) and scale. */
export const CLUB_RIG = { height: 3.4, scale: 3.2 };
