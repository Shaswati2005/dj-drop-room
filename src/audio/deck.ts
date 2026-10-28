import * as Tone from 'tone';
import { sectionAt, STEMS, trackBars } from './track-model.js';
import type { Section, Stem, TrackDef } from './track-model.js';

export type DeckId = 'A' | 'B';

/** Tempo fader range, ±8 % like the usual DJ-player default. */
export const TEMPO_RANGE = 0.08;

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

/**
 * One DJ deck playing a pre-rendered track: four stem files started together,
 * a playhead, a cue point, a tempo fader and SYNC. Stem toggles still land on
 * the deck's next bar line (PLAN §3.6); the deck's own beat grid is exact
 * because every track starts on a downbeat at 0 s.
 */
export class Deck {
  readonly output: Tone.Gain;
  track: TrackDef | null = null;
  status: 'empty' | 'loading' | 'ready' = 'empty';
  /** where PLAY starts from and CUE returns to (track seconds, on a beat) */
  cuePoint = 0;
  /** playback rate set by the tempo fader or SYNC */
  rate = 1;
  /** audio time of the last bar a stem toggle was applied on (tests) */
  lastCommitTime = -1;

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
  /** the last section loops so a deck never falls silent (auto-loop outro) */
  private loopStart = 0;
  private loopEnd = 0;
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
    return this.loopEnd;
  }

  get isRunning(): boolean {
    return this.isPlaying;
  }

  async load(track: TrackDef): Promise<void> {
    if (this.isPlaying) this.pause(this.context.currentTime);
    this.status = 'loading';
    this.track = track;
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
    this.loopEnd = bars * this.barSeconds;
    this.loopStart = (bars - last.bars) * this.barSeconds;
    this.cuePoint = 0;
    this.anchorPos = 0;
    this.status = 'ready';
  }

  /** Playhead in track seconds at an audio time. */
  position(time: number): number {
    if (!this.isPlaying) return this.anchorPos;
    const pos = this.anchorPos + Math.max(0, time - this.anchorTime) * this.rate;
    if (pos < this.loopEnd) return pos;
    const span = this.loopEnd - this.loopStart;
    return this.loopStart + ((pos - this.loopStart) % span);
  }

  section(time: number): Section | '' {
    if (this.track == null) return '';
    return sectionAt(this.track, Math.floor(this.position(time) / this.barSeconds)).section;
  }

  phraseBar(time: number): number {
    if (this.track == null) return 0;
    return sectionAt(this.track, Math.floor(this.position(time) / this.barSeconds)).phraseBar;
  }

  /** Audio time of this deck's next bar line after `time`. */
  nextBarTime(time: number): number {
    const pos = this.position(time);
    const next = (Math.floor(pos / this.barSeconds + 1e-6) + 1) * this.barSeconds;
    return time + (Math.min(next, this.loopEnd) - pos) / this.rate;
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
    if (this.isPlaying) {
      this.anchorPos = this.position(now);
      this.anchorTime = now;
      for (const source of this.sources) source?.playbackRate.setValueAtTime(rate, now);
    }
    this.rate = rate;
  }

  /** SYNC: match the master's tempo and, if both play, its position in the bar. */
  syncTo(master: Deck, now: number): void {
    if (master.track == null || this.track == null) return;
    this.setRate(master.bpm / this.track.bpm, now);
    if (!this.isPlaying || !master.isPlaying) return;
    const at = now + 0.03;
    const mine = (this.position(at) / this.barSeconds) % 1;
    const theirs = (master.position(at) / master.barSeconds) % 1;
    let delta = theirs - mine;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    if (Math.abs(delta) > 0.001) this.seek(Math.max(0, this.position(at) + delta * this.barSeconds), at);
  }

  /** Arm a stem toggle for the next bar; pressing again before then cancels. */
  toggleStem(stem: Stem): void {
    const i = STEMS.indexOf(stem);
    this.stemArmed[i] = !this.stemArmed[i];
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
    this.buffers.forEach((buffer, i) => {
      const source = new Tone.ToneBufferSource({
        context: this.context,
        url: buffer,
        loop: true,
        loopStart: this.loopStart,
        loopEnd: this.loopEnd,
        playbackRate: this.rate,
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
