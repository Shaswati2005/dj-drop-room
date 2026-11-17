import * as Tone from 'tone';
import { syncFactor } from './camelot.js';
import { sectionAt, STEMS, trackBars } from './track-model.js';
import type { Section, Stem, TrackDef } from './track-model.js';

export type DeckId = 'A' | 'B';

/** Tempo fader range, ±8 %, the usual DJ-player default. */
export const TEMPO_RANGE = 0.08;
/** Loop pad lengths (bars) and roll lengths (beats), PLAN-DJ-UPGRADE §3.2. */
export const LOOP_BARS = [1, 2, 4, 8] as const;
export const ROLL_BEATS = [0.25, 0.5, 1, 2] as const;
export const HOT_CUES = 4;
/** Waveform resolution: one peak per 32nd note. */
export const PEAKS_PER_BAR = 32;

/** A value that changes at a scheduled audio time, so visuals can show the
 * change when it is heard rather than when it was scheduled. */
export class Timed<T> {
  private prev: T;
  private next: T;
  private at = -Infinity;
  constructor(value: T) {
    this.prev = value;
    this.next = value;
  }
  set(value: T, at: number, now: number): void {
    this.prev = this.get(now);
    this.next = value;
    this.at = at;
  }
  get(now: number): T {
    return now >= this.at ? this.next : this.prev;
  }
  /** true while a scheduled change has not been heard yet */
  pending(now: number): boolean {
    return now < this.at;
  }
}

export function stemUrl(trackId: string, stem: Stem): string {
  return `${import.meta.env.BASE_URL}audio/tracks/${trackId}/${stem}.ogg`;
}

interface Region {
  start: number;
  end: number;
}

/**
 * One DJ deck playing a pre-rendered track: four stem files started together,
 * a playhead, cue point, hot cues, loops and rolls, a tempo fader with SYNC
 * and a jog wheel that bends the pitch. Stem toggles land on the deck's next
 * bar line (PLAN §3.6); the beat grid is exact because every track starts on
 * a downbeat at 0 s.
 */
export class Deck {
  readonly output: Tone.Gain;
  track: TrackDef | null = null;
  status: 'empty' | 'loading' | 'ready' = 'empty';
  /** where PLAY starts from and CUE returns to (track seconds, on a beat) */
  cuePoint = 0;
  /** playback rate set by the tempo fader or SYNC */
  rate = 1;
  /** temporary pitch bend from the jog wheel, e.g. 0.05 = 5 % faster */
  bend = 0;
  /** audio time of the last bar a stem toggle was applied on (tests) */
  lastCommitTime = -1;
  /** hot cue positions in track seconds, -1 = empty */
  readonly hotCues: number[] = new Array(HOT_CUES).fill(-1);
  /** active loop length in bars (0 = none) and held roll index (-1 = none) */
  loopBars = 0;
  roll = -1;
  /** waveform loudness per 32nd note, 0..1 */
  peaks: Float32Array = new Float32Array(0);

  readonly stems: Timed<boolean>[] = STEMS.map(() => new Timed(true));
  readonly playing = new Timed(false);

  private readonly stemGains: Tone.Gain[];
  private buffers: Tone.ToneAudioBuffer[] = [];
  private sources: (Tone.ToneBufferSource | null)[] = [null, null, null, null];
  private stemOn = [true, true, true, true];
  private stemArmed = [false, false, false, false];
  private isPlaying = false;
  private anchorTime = 0;
  private anchorPos = 0;
  /** the outro loops so a deck never falls silent; user loops and rolls replace it */
  private outro: Region = { start: 0, end: 0 };
  private userLoop: Region | null = null;
  private rollRegion: Region | null = null;
  private slip = { pos: 0, time: 0 };
  private handledBar = -1;

  constructor(
    private readonly context: Tone.BaseContext,
    readonly id: DeckId,
  ) {
    this.output = new Tone.Gain({ context });
    this.stemGains = STEMS.map(() => new Tone.Gain({ context }).connect(this.output));
  }

  /** Track length of one bar, in track seconds. */
  get barSeconds(): number {
    return this.track == null ? 2 : 240 / this.track.bpm;
  }

  get bpm(): number {
    return this.track == null ? 0 : this.track.bpm * this.rate;
  }

  get duration(): number {
    return this.outro.end;
  }

  get isRunning(): boolean {
    return this.isPlaying;
  }

  /** Track seconds per audio second right now. */
  private get speed(): number {
    return this.rate * (1 + this.bend);
  }

  /** The region the sources loop over. */
  get region(): Region {
    return this.rollRegion ?? this.userLoop ?? this.outro;
  }

  async load(track: TrackDef): Promise<void> {
    if (this.isPlaying) this.pause(this.context.currentTime);
    this.status = 'loading';
    this.track = track;
    // let the old track's decoded stems go now (play() refuses while loading), so the old
    // and the new track (~100 MB each) are never both held: a lower memory peak on Quest
    this.buffers = [];
    const raw = this.context.rawContext as AudioContext;
    const audio = await Promise.all(
      STEMS.map(async (stem) => {
        const response = await fetch(stemUrl(track.id, stem));
        if (!response.ok) throw new Error(`Missing stem ${stemUrl(track.id, stem)}`);
        return raw.decodeAudioData(await response.arrayBuffer());
      }),
    );
    this.buffers = audio.map((buffer) => new Tone.ToneAudioBuffer(buffer));
    const bars = trackBars(track);
    const last = track.form[track.form.length - 1];
    this.outro = { start: (bars - last.bars) * this.barSeconds, end: bars * this.barSeconds };
    this.userLoop = null;
    this.rollRegion = null;
    this.loopBars = 0;
    this.roll = -1;
    this.hotCues.fill(-1);
    this.cuePoint = 0;
    this.anchorPos = 0;
    this.peaks = computePeaks(audio, bars, this.barSeconds);
    this.status = 'ready';
  }

  /** Playhead in track seconds at an audio time. */
  position(time: number): number {
    if (!this.isPlaying) return this.anchorPos;
    return this.wrap(this.anchorPos + Math.max(0, time - this.anchorTime) * this.speed);
  }

  private wrap(pos: number): number {
    const { start, end } = this.region;
    if (pos < end) return pos;
    return start + ((pos - start) % (end - start));
  }

  section(time: number): Section | '' {
    if (this.track == null) return '';
    return sectionAt(this.track, Math.floor(this.position(time) / this.barSeconds)).section;
  }

  phraseBar(time: number): number {
    if (this.track == null) return 0;
    return sectionAt(this.track, Math.floor(this.position(time) / this.barSeconds)).phraseBar;
  }

  /** Audio time of this deck's next grid line (`unit` track seconds) after `time`. */
  private nextLineTime(time: number, unit: number): number {
    const pos = this.position(time);
    const next = (Math.floor(pos / unit + 1e-6) + 1) * unit;
    return time + (Math.min(next, this.region.end) - pos) / this.speed;
  }

  nextBarTime(time: number): number {
    return this.nextLineTime(time, this.barSeconds);
  }

  /** Next 1/8-note line (where ECHO and SPACE start). */
  nextEighthTime(time: number): number {
    return this.nextLineTime(time, this.barSeconds / 8);
  }

  nextBeatTime(time: number): number {
    return this.nextLineTime(time, this.barSeconds / 4);
  }

  play(at: number, now: number): void {
    if (this.isPlaying || this.status !== 'ready') return;
    this.startSources(at, this.anchorPos);
    this.isPlaying = true;
    this.anchorTime = at;
    this.playing.set(true, at, now);
  }

  pause(at: number, now = at): void {
    if (!this.isPlaying) return;
    this.anchorPos = this.position(at);
    this.stopSources(at);
    this.isPlaying = false;
    this.playing.set(false, at, now);
  }

  /** Move the playhead; if playing, the jump is heard at `at`. */
  seek(pos: number, at: number): void {
    if (this.isPlaying) {
      this.stopSources(at);
      this.startSources(at, pos);
      this.anchorTime = at;
    }
    this.anchorPos = pos;
  }

  /** Restart the playhead clock at `now` so a change of speed or region
   * applies from here on. */
  private reanchor(now: number): void {
    if (!this.isPlaying) return;
    this.anchorPos = this.position(now);
    this.anchorTime = now;
  }

  /** DJ-player CUE: playing → back to the cue point and pause; paused → the cue
   * point moves to the playhead, snapped to the nearest beat. */
  cue(now: number): void {
    if (this.isPlaying) {
      this.pause(now);
      this.anchorPos = this.cuePoint;
    } else {
      const beat = this.barSeconds / 4;
      this.cuePoint = Math.round(this.anchorPos / beat) * beat;
      this.anchorPos = this.cuePoint;
    }
  }

  setRate(rate: number, now: number): void {
    this.reanchor(now);
    this.rate = rate;
    this.applySpeed(now);
  }

  /** Jog wheel pitch bend while playing (nudge into phase). */
  setBend(bend: number, now: number): void {
    if (bend === this.bend) return;
    this.reanchor(now);
    this.bend = bend;
    this.applySpeed(now);
  }

  /** Jog wheel while paused: move the playhead by `seconds` of track. */
  scrub(seconds: number): void {
    if (this.isPlaying || this.status !== 'ready') return;
    this.anchorPos = Math.max(0, Math.min(this.outro.end - 0.001, this.anchorPos + seconds));
  }

  private applySpeed(now: number): void {
    for (const source of this.sources) source?.playbackRate.setValueAtTime(this.speed, now);
  }

  /** SYNC: match the master's tempo and, if both play, its position in the bar. */
  syncTo(master: Deck, now: number): void {
    if (master.track == null || this.track == null) return;
    // a double / half-time pair (drum & bass over lo-fi) locks at 2x / 0.5x
    const factor = syncFactor(master.track?.bpm ?? master.bpm, this.track.bpm);
    // a pair that cannot lock (lo-fi against house) goes as far as the tempo fader reaches
    this.setRate(Math.max(1 - TEMPO_RANGE, Math.min(1 + TEMPO_RANGE, (master.bpm * factor) / this.track.bpm)), now);
    if (!this.isPlaying || !master.isPlaying) return;
    const at = now + 0.03;
    const mine = (this.position(at) / this.barSeconds) % 1;
    const theirs = ((master.position(at) / master.barSeconds) * factor) % 1;
    let delta = theirs - mine;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    if (Math.abs(delta) > 0.001) this.seek(Math.max(0, this.position(at) + delta * this.barSeconds), at);
  }

  // ---- loops and rolls -------------------------------------------------

  /** LOOP pad: loop `bars` from the start of the current bar; the same pad
   * again, or a different length while looping, changes or exits it. */
  toggleLoop(bars: number, now: number): void {
    if (this.status !== 'ready') return;
    this.reanchor(now);
    if (this.loopBars === bars) {
      this.userLoop = null;
      this.loopBars = 0;
    } else {
      const start = this.userLoop?.start ?? Math.floor(this.position(now) / this.barSeconds + 1e-6) * this.barSeconds;
      this.userLoop = { start, end: Math.min(start + bars * this.barSeconds, this.outro.end) };
      this.loopBars = bars;
    }
    this.applyRegion();
  }

  /** Roll pad held: loop a short slice from the next grid line while the
   * track keeps time underneath (slip), so release lands back in place. */
  startRoll(index: number, now: number): void {
    if (!this.isPlaying || this.roll >= 0) return;
    const len = (ROLL_BEATS[index] * this.barSeconds) / 4;
    const pos = this.position(now);
    const start = Math.ceil(pos / len - 1e-6) * len;
    if (start + len > this.region.end) return;
    this.reanchor(now);
    this.slip = { pos: this.anchorPos, time: now };
    this.rollRegion = { start, end: start + len };
    this.roll = index;
    this.applyRegion();
  }

  endRoll(now: number): void {
    if (this.roll < 0) return;
    this.roll = -1;
    this.rollRegion = null;
    this.applyRegion();
    if (this.isPlaying) this.seek(this.wrap(this.slip.pos + (now + 0.005 - this.slip.time) * this.speed), now + 0.005);
  }

  private applyRegion(): void {
    const { start, end } = this.region;
    for (const source of this.sources) {
      if (source == null) continue;
      source.loopStart = start;
      source.loopEnd = end;
    }
  }

  // ---- hot cues -----------------------------------------------------------

  /** Hot cue pad: empty → store the playhead on the nearest beat; set → jump
   * there on the next beat (at once when paused). */
  hotCue(index: number, now: number): void {
    if (this.status !== 'ready') return;
    const beat = this.barSeconds / 4;
    if (this.hotCues[index] < 0) {
      this.hotCues[index] = Math.round(this.position(now) / beat) * beat;
      return;
    }
    const target = this.hotCues[index];
    if (!this.isPlaying) {
      this.jump(target, now, now);
      return;
    }
    let at = this.nextBeatTime(now);
    if (at - now < 0.02) at = this.nextBeatTime(at + 0.001);
    this.jump(target, at, now);
  }

  /** Jump the playhead to `pos` at audio time `at`, leaving a user loop the
   * target is outside of. */
  jump(pos: number, at: number, now: number): void {
    if (this.userLoop != null && (pos < this.userLoop.start || pos >= this.userLoop.end)) {
      this.reanchor(now);
      this.userLoop = null;
      this.loopBars = 0;
      this.applyRegion();
    }
    if (!this.isPlaying) {
      this.anchorPos = pos;
      return;
    }
    this.seek(pos, at);
  }

  /** Track bar where a DROP pressed at `time` lands: the start of the next drop
   * section, or of the current one (a re-drop), or the first drop when none is
   * left ahead. */
  dropBar(time: number): number {
    if (this.track == null) return 0;
    const bar = Math.floor(this.position(time) / this.barSeconds);
    let start = 0;
    let first = -1;
    let next = -1;
    for (const part of this.track.form) {
      if (part.section === 'drop') {
        if (first < 0) first = start;
        if (next < 0 && bar < start + part.bars) next = start;
      }
      start += part.bars;
    }
    return next >= 0 ? next : Math.max(0, first);
  }

  /** The DROP's gap: drums and bass drop out from `from` to `to`. */
  gap(from: number, to: number): void {
    for (const i of [0, 1]) {
      if (!this.stemOn[i]) continue;
      const g = this.stemGains[i].gain;
      g.setValueAtTime(1, from - 0.01);
      g.linearRampToValueAtTime(0, from);
      g.setValueAtTime(0, to - 0.004);
      g.linearRampToValueAtTime(1, to);
    }
  }

  /** Every stem on from `at` (the drop lands at full strength). */
  allStemsOn(at: number, now: number): void {
    for (let i = 0; i < 4; i++) {
      this.stemArmed[i] = false;
      if (this.stemOn[i]) continue;
      this.stemOn[i] = true;
      this.stemGains[i].gain.rampTo(1, 0.004, at);
      this.stems[i].set(true, at, now);
    }
  }

  deleteHotCue(index: number): void {
    this.hotCues[index] = -1;
  }

  // ---- stems --------------------------------------------------------------

  /** Arm a stem toggle for the next bar; pressing again before then cancels. */
  toggleStem(stem: Stem): void {
    const i = STEMS.indexOf(stem);
    this.stemArmed[i] = !this.stemArmed[i];
  }

  /** Stems as they will be after the next bar line. */
  private target(i: number): boolean {
    return this.stemOn[i] !== this.stemArmed[i];
  }

  /** The stem soloed at the next bar, or -1. */
  soloed(): number {
    let only = -1;
    for (let i = 0; i < 4; i++) {
      if (!this.target(i)) continue;
      if (only >= 0) return -1;
      only = i;
    }
    return only;
  }

  /** Solo pad: only this stem from the next bar; again → all stems back. */
  solo(stem: Stem): void {
    const k = STEMS.indexOf(stem);
    const restore = this.soloed() === k;
    for (let i = 0; i < 4; i++) this.stemArmed[i] = this.stemOn[i] !== (restore || i === k);
  }

  armed(index: number): boolean {
    return this.stemArmed[index];
  }

  /** Scheduler tick: apply armed stem toggles on the next bar line once it is
   * within `lookAhead` seconds; while paused they apply at once. */
  tick(now: number, lookAhead: number, audibleNow: number): void {
    if (!this.stemArmed.includes(true)) return;
    if (!this.isPlaying) {
      this.commitStems(now, audibleNow);
      return;
    }
    const at = this.nextBarTime(now);
    const key = Math.round(at * 1000);
    if (at - now <= lookAhead && key !== this.handledBar) {
      this.handledBar = key;
      this.commitStems(at, audibleNow);
    }
  }

  private commitStems(at: number, now: number): void {
    for (let i = 0; i < 4; i++) {
      if (!this.stemArmed[i]) continue;
      this.stemArmed[i] = false;
      this.stemOn[i] = !this.stemOn[i];
      this.stemGains[i].gain.rampTo(this.stemOn[i] ? 1 : 0, 0.02, at);
      this.stems[i].set(this.stemOn[i], at, now);
    }
    this.lastCommitTime = at;
  }

  private startSources(at: number, pos: number): void {
    const { start, end } = this.region;
    this.buffers.forEach((buffer, i) => {
      const source = new Tone.ToneBufferSource({
        context: this.context,
        url: buffer,
        loop: true,
        loopStart: start,
        loopEnd: end,
        playbackRate: this.speed,
        fadeIn: 0.004,
        fadeOut: 0.008,
      }).connect(this.stemGains[i]);
      source.onended = () => source.dispose();
      source.start(at, pos);
      this.sources[i] = source;
    });
  }

  private stopSources(at: number): void {
    for (let i = 0; i < this.sources.length; i++) {
      this.sources[i]?.stop(at);
      this.sources[i] = null;
    }
  }

  dispose(): void {
    this.stopSources(this.context.currentTime);
    for (const gain of this.stemGains) gain.dispose();
    this.output.dispose();
  }
}

/** Loudness of the summed stems per 32nd note, normalised to 0..1, for the
 * waveform display. Samples every 8th frame: plenty for a 32nd-note column. */
function computePeaks(audio: AudioBuffer[], bars: number, barSeconds: number): Float32Array {
  const peaks = new Float32Array(bars * PEAKS_PER_BAR);
  const rate = audio[0].sampleRate;
  const span = (barSeconds / PEAKS_PER_BAR) * rate;
  const channels = audio.map((buffer) => buffer.getChannelData(0));
  let max = 1e-6;
  for (let i = 0; i < peaks.length; i++) {
    const from = Math.floor(i * span);
    const to = Math.min(channels[0].length, Math.floor((i + 1) * span));
    let sum = 0;
    let n = 0;
    for (let f = from; f < to; f += 8, n++) {
      let s = 0;
      for (const data of channels) s += data[f];
      sum += s * s;
    }
    peaks[i] = n > 0 ? Math.sqrt(sum / n) : 0;
    if (peaks[i] > max) max = peaks[i];
  }
  for (let i = 0; i < peaks.length; i++) peaks[i] /= max;
  return peaks;
}
