import * as Tone from 'tone';
import { Deck, TEMPO_RANGE } from './deck.js';
import type { DeckId } from './deck.js';
import { Master } from './master.js';
import { TRACKS, WARM_START } from './tracks/catalog.js';
import { STEMS } from './track-model.js';
import type { Section, Stem } from './track-model.js';

export interface DeckView {
  trackId: string;
  status: Deck['status'];
  playing: boolean;
  /** a quantised start is waiting for its bar line */
  playArmed: boolean;
  bpm: number;
  /** tempo fader, -1..1 of ±8 % */
  tempo: number;
  /** playhead and cue point, track seconds */
  position: number;
  cuePoint: number;
  duration: number;
  section: Section | '';
  phraseBar: number;
  /** 1 = on, 0 = off, as heard */
  stems: number[];
  /** a toggle is waiting for the next bar or has not been heard yet */
  armed: boolean[];
}

export interface EngineState {
  running: boolean;
  /** the master deck: the one the other deck syncs and quantises to */
  master: DeckId;
  bpm: number;
  bar: number;
  beat: number;
  step: number;
  latencyMs: number;
  level: number;
  A: DeckView;
  B: DeckView;
}

const deckView = (): DeckView => ({
  trackId: '',
  status: 'empty',
  playing: false,
  playArmed: false,
  bpm: 0,
  tempo: 0,
  position: 0,
  cuePoint: 0,
  duration: 0,
  section: '',
  phraseBar: 0,
  stems: [1, 1, 1, 1],
  armed: [false, false, false, false],
});

const LOOK_AHEAD = 0.12;

/**
 * The facade every system talks to (PLAN §6.3). Two decks play pre-rendered
 * tracks into the master bus. A scheduler on the context's own ticker (a
 * worker timer, so it keeps time even when frames are slow) applies armed
 * changes just before the bar line they belong to.
 */
export class Engine {
  readonly master: Master;
  readonly decks: Record<DeckId, Deck>;
  readonly state: EngineState = {
    running: false,
    master: 'A',
    bpm: WARM_START.bpm,
    bar: 0,
    beat: 1,
    step: 0,
    latencyMs: 0,
    level: 0,
    A: deckView(),
    B: deckView(),
  };
  /** audio time of the last stem press (tests) */
  lastPressTime = -1;
  private preloaded: Promise<void> | null = null;
  private readonly tick = () => {
    const now = this.context.currentTime;
    const heard = this.audibleTime();
    this.decks.A.tick(now, LOOK_AHEAD, heard);
    this.decks.B.tick(now, LOOK_AHEAD, heard);
  };

  constructor(readonly context: Tone.BaseContext) {
    this.master = new Master(context);
    this.decks = { A: new Deck(context, 'A'), B: new Deck(context, 'B') };
    this.decks.A.output.connect(this.master.input);
    this.decks.B.output.connect(this.master.input);
    context.on('tick', this.tick);
  }

  /** Seconds between scheduling a sound and hearing it. */
  get latency(): number {
    const raw = this.context.rawContext as AudioContext;
    return (raw.baseLatency ?? 0) + (raw.outputLatency ?? 0);
  }

  /** The audio time being heard right now; visuals key off this (PLAN §3.7). */
  audibleTime(): number {
    return this.context.currentTime - this.latency;
  }

  /** The deck others follow: the one playing (A when both do, until the
   * crossfader decides it). */
  masterDeck(): Deck {
    const { A, B } = this.decks;
    return !A.isRunning && B.isRunning ? B : A;
  }

  other(deck: DeckId): Deck {
    return this.decks[deck === 'A' ? 'B' : 'A'];
  }

  async loadTrack(deck: DeckId, trackId: string): Promise<void> {
    const track = TRACKS[trackId];
    if (track == null) throw new Error(`Unknown track ${trackId}`);
    await this.decks[deck].load(track);
  }

  /** Fetch and decode the opening tracks before the player asks for music;
   * decoding works on a suspended context, so this needs no user gesture. */
  preload(): Promise<void> {
    this.preloaded ??= Promise.all([this.loadTrack('A', WARM_START.id), this.loadTrack('B', WARM_START.id)]).then(() => {});
    return this.preloaded;
  }

  /** Session start: Warm Start plays on deck A from its first bar (PLAN §5.1).
   * Must follow a user gesture so the context may resume. */
  async start(): Promise<void> {
    if (this.state.running) return;
    this.state.running = true;
    await Promise.all([this.context.resume(), this.preload()]);
    const now = this.context.currentTime;
    this.decks.A.play(now + 0.05, this.audibleTime());
  }

  /** PLAY/PAUSE. Pause is instant; play starts on the other deck's next bar
   * line when it is playing (quantised start), otherwise at once. */
  togglePlay(id: DeckId): void {
    const deck = this.decks[id];
    const now = this.context.currentTime;
    if (deck.isRunning) {
      deck.pause(now + 0.005, this.audibleTime());
      return;
    }
    const other = this.other(id);
    let at = now + 0.03;
    if (other.isRunning) {
      at = other.nextBarTime(now);
      if (at - now < 0.03) at = other.nextBarTime(at + 0.001);
    }
    deck.play(at, this.audibleTime());
  }

  cue(id: DeckId): void {
    this.decks[id].cue(this.context.currentTime + 0.005);
  }

  /** Match the other deck's tempo and bar position. */
  sync(id: DeckId): void {
    const other = this.other(id);
    if (other.track != null) this.decks[id].syncTo(other, this.context.currentTime);
  }

  /** Tempo fader, -1..1 → ±8 %. */
  setTempo(id: DeckId, fader: number): void {
    const clamped = Math.max(-1, Math.min(1, fader));
    this.decks[id].setRate(1 + clamped * TEMPO_RANGE, this.context.currentTime);
  }

  toggleStem(deck: DeckId, stem: Stem): void {
    this.lastPressTime = this.context.currentTime;
    this.decks[deck].toggleStem(stem);
  }

  click(high = true): void {
    if (this.state.running) this.master.click(high);
  }

  /** Refresh `state` for the current frame. Allocation-free. */
  update(): EngineState {
    const s = this.state;
    const heard = this.audibleTime();
    const master = this.masterDeck();
    s.master = master.id;
    s.bpm = master.bpm || WARM_START.bpm;
    s.latencyMs = this.latency * 1000;
    s.level = this.master.level;
    if (master.track != null) {
      const beats = master.position(heard) / (master.barSeconds / 4);
      s.bar = Math.floor(beats / 4);
      s.beat = (Math.floor(beats) % 4) + 1;
      s.step = Math.floor(beats * 4) % 16;
    }
    for (const id of ['A', 'B'] as const) {
      const deck = this.decks[id];
      const view = s[id];
      view.trackId = deck.track?.id ?? '';
      view.status = deck.status;
      view.playing = deck.playing.get(heard);
      view.playArmed = deck.playing.pending(heard);
      view.bpm = deck.bpm;
      view.tempo = (deck.rate - 1) / TEMPO_RANGE;
      view.position = deck.position(heard);
      view.cuePoint = deck.cuePoint;
      view.duration = deck.duration;
      view.section = deck.section(heard);
      view.phraseBar = deck.phraseBar(heard);
      for (let i = 0; i < STEMS.length; i++) {
        view.stems[i] = deck.stems[i].get(heard) ? 1 : 0;
        view.armed[i] = deck.armed(i) || deck.stems[i].pending(heard);
      }
    }
    return s;
  }

  dispose(): void {
    this.context.off('tick', this.tick);
    this.decks.A.dispose();
    this.decks.B.dispose();
    this.master.dispose();
  }
}
