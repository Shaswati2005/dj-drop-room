import * as Tone from 'tone';
import { Deck } from './deck.js';
import type { DeckId } from './deck.js';
import { Master } from './master.js';
import { positionAtTicks } from './quantise.js';
import { TRACKS, WARM_START } from './tracks/catalog.js';
import { STEMS } from './track-model.js';
import type { Section, Stem } from './track-model.js';

export interface DeckView {
  trackId: string;
  playing: boolean;
  playArmed: boolean;
  section: Section | '';
  phraseBar: number;
  /** 1 = on, 0 = off, as heard */
  stems: number[];
  /** a toggle is waiting for the next bar or has not been heard yet */
  armed: boolean[];
}

export interface EngineState {
  running: boolean;
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
  playing: false,
  playArmed: false,
  section: '',
  phraseBar: 0,
  stems: [1, 1, 1, 1],
  armed: [false, false, false, false],
});

/**
 * The facade every system talks to (PLAN §6.3). It is constructed with a
 * Tone context, live or offline, and never uses Tone's global context, so the
 * same code plays in the headset and renders in tests.
 */
export class Engine {
  readonly transport: Tone.BaseContext['transport'];
  readonly master: Master;
  readonly decks: Record<DeckId, Deck>;
  readonly state: EngineState = {
    running: false,
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
  private readonly position = { bar: 0, beat: 1, step: 0 };
  private readonly barEvent: number;

  constructor(readonly context: Tone.BaseContext) {
    this.transport = context.transport;
    this.transport.timeSignature = 4;
    this.transport.bpm.value = WARM_START.bpm;
    this.master = new Master(context);
    this.decks = { A: new Deck(context, 'A'), B: new Deck(context, 'B') };
    this.decks.A.output.connect(this.master.input);
    this.decks.B.output.connect(this.master.input);
    this.barEvent = this.transport.scheduleRepeat(
      (time) => {
        const bpm = this.transport.bpm.value;
        const now = this.audibleTime();
        this.decks.A.onBar(time, bpm, now);
        this.decks.B.onBar(time, bpm, now);
      },
      '1m',
      0,
    );
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

  loadTrack(deck: DeckId, trackId: string): void {
    const track = TRACKS[trackId];
    if (track == null) throw new Error(`Unknown track ${trackId}`);
    this.decks[deck].load(track);
  }

  /** Session start: Warm Start plays on deck A from bar 1 (PLAN §5.1). Must
   * follow a user gesture so the context may resume. */
  async start(): Promise<void> {
    if (this.state.running) return;
    await this.context.resume();
    this.state.running = true;
    this.loadTrack('A', WARM_START.id);
    this.loadTrack('B', WARM_START.id);
    this.decks.A.cue(0);
    this.transport.start(this.context.currentTime + 0.1);
  }

  /** Start for an offline render: the transport begins at time 0. */
  startOffline(trackId: string, startBar: number): void {
    this.state.running = true;
    this.loadTrack('A', trackId);
    this.transport.bpm.value = TRACKS[trackId].bpm;
    this.decks.A.cue(startBar);
    this.transport.start(0);
  }

  toggleStem(deck: DeckId, stem: Stem): void {
    this.lastPressTime = this.context.currentTime;
    this.decks[deck].toggleStem(stem);
  }

  togglePlay(deck: DeckId): void {
    this.decks[deck].togglePlay();
  }

  click(high = true): void {
    if (this.state.running) this.master.click(high);
  }

  /** Refresh `state` for the current frame. Allocation-free. */
  update(): EngineState {
    const s = this.state;
    const now = this.audibleTime();
    s.bpm = this.transport.bpm.value;
    s.latencyMs = this.latency * 1000;
    if (s.running && now > 0) {
      positionAtTicks(Math.max(0, this.transport.getTicksAtTime(now)), this.transport.PPQ, this.position);
      s.bar = this.position.bar;
      s.beat = this.position.beat;
      s.step = this.position.step;
      s.level = this.master.level;
    }
    for (const id of ['A', 'B'] as const) {
      const deck = this.decks[id];
      const view = s[id];
      view.trackId = deck.track?.id ?? '';
      view.playing = deck.playing.get(now);
      view.playArmed = deck.playIsArmed || deck.playing.pending(now);
      view.section = deck.section.get(now);
      view.phraseBar = deck.phraseBar.get(now);
      for (let i = 0; i < STEMS.length; i++) {
        view.stems[i] = deck.stems[i].get(now) ? 1 : 0;
        view.armed[i] = deck.armed(i) || deck.stems[i].pending(now);
      }
    }
    return s;
  }

  dispose(): void {
    this.transport.clear(this.barEvent);
    this.transport.stop();
    this.decks.A.dispose();
    this.decks.B.dispose();
    this.master.dispose();
  }
}
