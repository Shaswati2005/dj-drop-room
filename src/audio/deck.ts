import * as Tone from 'tone';
import { DeckKit } from './synths/deck-kit.js';
import { generatorFor } from './tracks/catalog.js';
import { midiToHz, sectionAt, STEMS } from './track-model.js';
import type { Generator, Section, Stem, TrackDef } from './track-model.js';

export type DeckId = 'A' | 'B';

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

/**
 * One deck: four stems, per-bar scheduling and bar-quantised toggles
 * (PLAN §3.4, §3.6). Every change is applied inside the bar callback, which
 * is what makes "every change lands on the next bar" true by construction.
 */
export class Deck {
  readonly output: Tone.Gain;
  track: TrackDef | null = null;
  trackBar = 0;
  /** audio time of the last bar a stem toggle was applied on (tests) */
  lastCommitTime = -1;

  readonly stems: Timed<boolean>[] = STEMS.map(() => new Timed(true));
  readonly playing = new Timed(false);
  readonly section = new Timed<Section | ''>('');
  readonly phraseBar = new Timed(0);

  private readonly kit: DeckKit;
  private readonly stemGains: Tone.Gain[];
  private generator: Generator | null = null;
  private stemOn = [true, true, true, true];
  private stemArmed = [false, false, false, false];
  private isPlaying = false;
  private playArmed = false;

  constructor(
    context: Tone.BaseContext,
    readonly id: DeckId,
  ) {
    this.kit = new DeckKit(context);
    this.output = new Tone.Gain({ context });
    this.stemGains = [this.kit.drums, this.kit.bass, this.kit.chords, this.kit.melody];
    for (const gain of this.stemGains) gain.connect(this.output);
  }

  load(track: TrackDef): void {
    this.track = track;
    this.generator = generatorFor(track);
    this.trackBar = 0;
  }

  /** Start immediately from a bar of the track (session start, offline renders). */
  cue(bar = 0): void {
    this.trackBar = bar;
    this.isPlaying = true;
    this.playing.set(true, -Infinity, 0);
  }

  /** Set a stem at once, without quantisation (tests and offline solo renders). */
  setStemNow(index: number, on: boolean): void {
    this.stemOn[index] = on;
    this.stemGains[index].gain.value = on ? 1 : 0;
    this.stems[index].set(on, -Infinity, 0);
  }

  /** Arm a stem toggle for the next bar; pressing again before then cancels. */
  toggleStem(stem: Stem): void {
    const i = STEMS.indexOf(stem);
    this.stemArmed[i] = !this.stemArmed[i];
  }

  togglePlay(): void {
    this.playArmed = !this.playArmed;
  }

  armed(index: number): boolean {
    return this.stemArmed[index];
  }

  get playIsArmed(): boolean {
    return this.playArmed;
  }

  /** Called by the clock at the start of every bar, `time` ahead of now. */
  onBar(time: number, bpm: number, now: number): void {
    if (this.playArmed) {
      this.playArmed = false;
      this.isPlaying = !this.isPlaying;
      if (this.isPlaying) this.trackBar = 0;
      else this.kit.silence(time);
      this.playing.set(this.isPlaying, time, now);
    }
    for (let i = 0; i < 4; i++) {
      if (!this.stemArmed[i]) continue;
      this.stemArmed[i] = false;
      this.stemOn[i] = !this.stemOn[i];
      this.stemGains[i].gain.rampTo(this.stemOn[i] ? 1 : 0, 0.02, time);
      this.stems[i].set(this.stemOn[i], time, now);
      this.lastCommitTime = time;
    }
    if (!this.isPlaying || this.track == null || this.generator == null) return;

    const ctx = sectionAt(this.track, this.trackBar);
    this.section.set(ctx.section, time, now);
    this.phraseBar.set(ctx.phraseBar, time, now);
    const pattern = this.generator(this.track, ctx);
    const sixteenth = 60 / bpm / 4;
    const swing = this.track.swing * sixteenth;
    const at = (step: number) => time + step * sixteenth + (step % 2 === 1 ? swing : 0);

    for (const e of pattern.drums) this.kit.drum(e.voice!, at(e.step), e.length * sixteenth * 0.9, e.velocity);
    for (const e of pattern.bass) this.kit.bassNote(midiToHz(e.notes![0]), at(e.step), e.length * sixteenth * 0.9, e.velocity);
    for (const e of pattern.chords) {
      this.kit.chord(e.notes!.map(midiToHz), at(e.step), e.length * sixteenth * 0.9, e.velocity);
    }
    for (const e of pattern.melody) this.kit.lead(midiToHz(e.notes![0]), at(e.step), e.length * sixteenth * 0.9, e.velocity);
    this.trackBar++;
  }

  dispose(): void {
    this.kit.dispose();
    this.output.dispose();
  }
}

