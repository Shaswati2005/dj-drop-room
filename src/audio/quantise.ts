/** Pure quantisation rules (PLAN §3.5, §3.6). Beats are 1-based (1..4). */

/** Stem toggles, Play and loads land on the next bar. */
export function nextBar(bar: number): number {
  return bar + 1;
}

/** DROP: pressed on beat 1–2 lands on the next downbeat, on beat 3–4 one bar
 * later, so the riser always gets at least two beats. */
export function dropTargetBar(bar: number, beat: number): number {
  return beat <= 2 ? bar + 1 : bar + 2;
}

/** Bar/beat/step at a transport tick position. */
export function positionAtTicks(
  ticks: number,
  ppq: number,
  out: { bar: number; beat: number; step: number },
): void {
  const beats = ticks / ppq;
  out.bar = Math.floor(beats / 4);
  out.beat = (Math.floor(beats) % 4) + 1;
  out.step = Math.floor(beats * 4) % 16;
}

/** Beat FX (PLAN §3.9, §3.6): ECHO and SPACE start on the next 1/8 note of the
 * master deck while a pad is held, ramp their send up over `FX_RAMP_BEATS`,
 * and on release shut the send so the tail rings out on its own. */
export const FX_PEAK = 0.6;
export const FX_RAMP_BEATS = 4;
/** Echo feedback (each repeat is this much quieter) and the dotted-1/8 delay in beats. */
export const ECHO_FEEDBACK = 0.45;
export const ECHO_BEATS = 0.75;
/** Send level falls to 0 this fast on release (the tail itself is not cut). */
export const FX_RELEASE = 0.06;

/** The 1/8-note line after `now`, given the time of the next bar line and the
 * length of one 1/8 note. A press that lands within `guard` seconds before a
 * line waits for the following one so the start is never in the past. */
export function nextEighthAt(now: number, nextBarAt: number, eighth: number, guard = 0.02): number {
  let at = nextBarAt;
  while (at - eighth > now + guard) at -= eighth;
  return at;
}

/** Dotted 1/8 delay time in seconds at `bpm`. */
export function echoDelaySeconds(bpm: number): number {
  return (ECHO_BEATS * 60) / bpm;
}

/** Seconds until an echo's repeats fall `floorDb` below the first: the tail
 * after release. 0.45 feedback at 124 BPM is about 2 bars. */
export function echoTailSeconds(bpm: number, feedback = ECHO_FEEDBACK, floorDb = -60): number {
  const repeats = floorDb / (20 * Math.log10(feedback));
  return repeats * echoDelaySeconds(bpm);
}

/** The send level of a held FX at time `t`: 0 before `startAt`, rising
 * linearly over `ramp` seconds to FX_PEAK, then (after `releaseAt`) back to 0
 * over FX_RELEASE. `releaseAt` < 0 means still held. Mirrors what the engine
 * schedules on the audio params, for tests. */
export function fxSendAt(t: number, startAt: number, ramp: number, releaseAt = -1): number {
  const rise = (time: number) => Math.min(1, Math.max(0, (time - startAt) / ramp)) * FX_PEAK;
  if (releaseAt < 0 || t < releaseAt) return rise(t);
  const from = rise(releaseAt);
  return Math.max(0, from * (1 - (t - releaseAt) / FX_RELEASE));
}
