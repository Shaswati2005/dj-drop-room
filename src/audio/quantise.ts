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
