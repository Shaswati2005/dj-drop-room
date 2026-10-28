import * as Tone from 'tone';
import { Deck, HOT_CUES, LOOP_BARS, TEMPO_RANGE } from './deck.js';
import type { DeckId } from './deck.js';
import { DropFx } from './drop.js';
import { Master } from './master.js';
import { Channel, clamp, crossfadeGains, MasterFx } from './mixer.js';
import type { Band } from './mixer.js';
import { CONCRETE, TRACKS, WARM_START } from './tracks/catalog.js';
import { STEMS } from './track-model.js';
import type { Section, Stem } from './track-model.js';

/** What the 8 pads of a deck do (PLAN-DJ-UPGRADE §3.2). */
export const PAD_MODES = ['stems', 'cues', 'loop'] as const;
export type PadMode = (typeof PAD_MODES)[number];
/** Mixer knobs, top to bottom of a channel strip. */
export const KNOBS = ['trim', 'high', 'mid', 'low', 'filter'] as const;
export type KnobControl = (typeof KNOBS)[number];
/** 33⅓ rpm in radians per second: one jog turn = 1.8 s of track. */
export const JOG_SPIN = ((100 / 3) * Math.PI * 2) / 60;

export interface DeckView {
  trackId: string;
  trackName: string;
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
  soloed: number;
  padMode: PadMode;
  hotCues: number[];
  loopBars: number;
  roll: number;
  /** knob values -1..1 in KNOBS order; kills for high, mid, low */
  knobs: number[];
  kills: boolean[];
  fader: number;
  /** post-fader channel level, 0..1 */
  level: number;
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
  /** -1 = all A, +1 = all B */
  crossfader: number;
  /** side an A/B end button is fading towards, '' when idle */
  fadingTo: DeckId | '';
  echo: boolean;
  space: boolean;
  /** DROP: riser start and landing (audio times, as heard; 0 = none yet) and
   * how many drops have landed */
  dropFrom: number;
  dropAt: number;
  drops: number;
  /** a DROP is rising toward its downbeat */
  dropping: boolean;
  /** audio time being heard, for visuals keyed to dropFrom/dropAt */
  heard: number;
  A: DeckView;
  B: DeckView;
}

const deckView = (): DeckView => ({
  trackId: '',
  trackName: '',
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
  soloed: -1,
  padMode: 'stems',
  hotCues: new Array(HOT_CUES).fill(-1),
  loopBars: 0,
  roll: -1,
  knobs: [0, 0, 0, 0, 0],
  kills: [false, false, false],
  fader: 1,
  level: 0,
});

const LOOK_AHEAD = 0.12;
const KILL_BANDS: readonly Band[] = ['high', 'mid', 'low'];

/**
 * The facade every system talks to (PLAN §6.3). Two decks play pre-rendered
 * tracks through mixer channels and the crossfader into the master bus. A
 * scheduler on the context's own ticker (a worker timer, so it keeps time even
 * when frames are slow) applies armed changes just before their bar line.
 */
export class Engine {
  readonly master: Master;
  readonly fx: MasterFx;
  readonly dropFx: DropFx;
  readonly decks: Record<DeckId, Deck>;
  readonly channels: Record<DeckId, Channel>;
  readonly padModes: Record<DeckId, PadMode> = { A: 'stems', B: 'stems' };
  readonly state: EngineState = {
    running: false,
    master: 'A',
    bpm: WARM_START.bpm,
    bar: 0,
    beat: 1,
    step: 0,
    latencyMs: 0,
    level: 0,
    crossfader: 0,
    fadingTo: '',
    echo: false,
    space: false,
    dropFrom: 0,
    dropAt: 0,
    drops: 0,
    dropping: false,
    heard: 0,
    A: deckView(),
    B: deckView(),
  };
  /** audio time of the last stem press (tests) */
  lastPressTime = -1;
  private crossfader = 0;
  private fade: { from: number; to: number; start: number; seconds: number } | null = null;
  private preloaded: Promise<void> | null = null;
  private dropFrom = 0;
  private dropAt = 0;
  private dropsScheduled = 0;
  private readonly tick = () => {
    const now = this.context.currentTime;
    const heard = this.audibleTime();
    this.decks.A.tick(now, LOOK_AHEAD, heard);
    this.decks.B.tick(now, LOOK_AHEAD, heard);
    if (this.fade != null) {
      const t = Math.min(1, (now - this.fade.start) / this.fade.seconds);
      this.applyCrossfader(this.fade.from + (this.fade.to - this.fade.from) * t);
      if (t >= 1) this.fade = null;
    }
  };

  constructor(readonly context: Tone.BaseContext) {
    this.master = new Master(context);
    this.fx = new MasterFx(context, this.master.input);
    this.dropFx = new DropFx(context, this.master.input);
    this.decks = { A: new Deck(context, 'A'), B: new Deck(context, 'B') };
    this.channels = { A: new Channel(context), B: new Channel(context) };
    for (const id of ['A', 'B'] as const) {
      this.decks[id].output.connect(this.channels[id].input);
      this.channels[id].output.fan(this.master.input, this.fx.input);
    }
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

  /** The deck others follow: the one playing; when both play, the one the
   * crossfader favours (A at the centre). */
  masterDeck(): Deck {
    const { A, B } = this.decks;
    if (A.isRunning && B.isRunning) return this.crossfader > 0.05 ? B : A;
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
   * decoding works on a suspended context, so this needs no user gesture.
   * Warm Start plays on A; Concrete waits on B for the first mix. */
  preload(): Promise<void> {
    this.preloaded ??= Promise.all([this.loadTrack('A', WARM_START.id), this.loadTrack('B', CONCRETE.id)]).then(() => {});
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

  // ---- transport ---------------------------------------------------------

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
    this.decks[id].setRate(1 + clamp(fader, -1, 1) * TEMPO_RANGE, this.context.currentTime);
  }

  /** Jog wheel turned by `radians` (clockwise positive) over `dt` seconds:
   * playing → pitch bend to nudge into phase; paused → move the playhead as a
   * record would (one turn = 1.8 s). Call with 0 on release. */
  jog(id: DeckId, radians: number, dt: number): void {
    const deck = this.decks[id];
    if (deck.isRunning) {
      const turnsPerSecond = dt > 0 ? radians / dt / (Math.PI * 2) : 0;
      deck.setBend(clamp(turnsPerSecond * 0.15, -0.2, 0.2), this.context.currentTime);
    } else {
      deck.scrub(radians / JOG_SPIN);
    }
  }

  // ---- pads ----------------------------------------------------------------

  setPadMode(id: DeckId, mode: PadMode): void {
    this.decks[id].endRoll(this.context.currentTime);
    this.padModes[id] = mode;
  }

  /** A performance pad pressed (down) or released. Slots 0-3 are the top row.
   * STEMS: toggle / solo a stem. CUES: hot cue / delete it. LOOP: 1-8 bar
   * loops / beat rolls held under the finger. */
  pad(id: DeckId, slot: number, down: boolean): void {
    const deck = this.decks[id];
    const now = this.context.currentTime;
    const top = slot < 4;
    const i = slot % 4;
    switch (this.padModes[id]) {
      case 'stems':
        if (!down) return;
        this.lastPressTime = now;
        if (top) deck.toggleStem(STEMS[i]);
        else deck.solo(STEMS[i]);
        return;
      case 'cues':
        if (!down) return;
        if (top) deck.hotCue(i, now);
        else deck.deleteHotCue(i);
        return;
      case 'loop':
        if (top && down) deck.toggleLoop(LOOP_BARS[i], now);
        else if (!top && down) deck.startRoll(i, now);
        else if (!top && deck.roll === i) deck.endRoll(now);
    }
  }

  toggleStem(deck: DeckId, stem: Stem): void {
    this.lastPressTime = this.context.currentTime;
    this.decks[deck].toggleStem(stem);
  }

  // ---- mixer ---------------------------------------------------------------

  /** A mixer knob turned to v (-1..1). */
  setKnob(id: DeckId, knob: KnobControl, v: number): void {
    const channel = this.channels[id];
    if (knob === 'trim') channel.setTrim(v);
    else if (knob === 'filter') channel.setFilter(v);
    else channel.setEq(knob, v);
  }

  knob(id: DeckId, knob: KnobControl): number {
    const channel = this.channels[id];
    return knob === 'trim' ? channel.trim : knob === 'filter' ? channel.filter : channel.eq[knob];
  }

  /** A knob tapped: EQ bands kill/restore (isolator); TRIM and FILTER snap
   * back to the centre. */
  tapKnob(id: DeckId, knob: KnobControl): void {
    const channel = this.channels[id];
    if (knob === 'trim') channel.setTrim(0);
    else if (knob === 'filter') channel.setFilter(0);
    else channel.toggleKill(knob);
  }

  setFader(id: DeckId, v: number): void {
    this.channels[id].setFader(v);
  }

  /** Crossfader moved by hand: cancels an A/B auto-fade. */
  setCrossfader(x: number): void {
    this.fade = null;
    this.applyCrossfader(x);
  }

  private applyCrossfader(x: number): void {
    this.crossfader = clamp(x, -1, 1);
    const [a, b] = crossfadeGains(this.crossfader);
    this.channels.A.setCrossfade(a);
    this.channels.B.setCrossfade(b);
  }

  /** A/B end button: glide the crossfader all the way over in 4 bars of the
   * master tempo; pressing the same end again stops the glide. */
  fadeTo(side: DeckId): void {
    const to = side === 'A' ? -1 : 1;
    if (this.fade?.to === to) {
      this.fade = null;
      return;
    }
    const bpm = this.masterDeck().bpm || WARM_START.bpm;
    this.fade = { from: this.crossfader, to, start: this.context.currentTime, seconds: (4 * 240) / bpm };
  }

  toggleEcho(): void {
    this.fx.toggleEcho(this.masterDeck().bpm || WARM_START.bpm);
  }

  toggleSpace(): void {
    this.fx.toggleSpace();
  }

  /** DROP (PLAN §3.5) on the master deck: a riser now; drums and bass gap on
   * the last beat; on the downbeat the deck lands on the start of its next
   * drop section (or re-drops the one it is in) with every stem on. The
   * downbeat is the next bar, or the one after when under 2 beats are left. */
  drop(): void {
    const deck = this.masterDeck();
    const now = this.context.currentTime;
    if (!deck.isRunning || deck.track == null || now < this.dropAt) return;
    const beat = 60 / deck.bpm;
    let at = deck.nextBarTime(now);
    if (at - now < 2 * beat) at = deck.nextBarTime(at + 0.001);
    const land = deck.dropBar(at) * deck.barSeconds;
    for (const d of [this.decks.A, this.decks.B]) if (d.isRunning) d.gap(at - beat, at);
    deck.jump(land, at, now);
    deck.allStemsOn(at, this.audibleTime());
    this.dropFx.riser(now, at);
    this.dropFx.impact(at, 8 * beat);
    this.dropFrom = now;
    this.dropAt = at;
    this.dropsScheduled++;
  }

  /** Session paused (headset off, system menu): freeze the audio clock, so
   * every deck, fade and drop resumes exactly where it was. */
  suspend(): void {
    if (this.state.running) void (this.context.rawContext as AudioContext).suspend();
  }

  resume(): void {
    if (this.state.running) void (this.context.rawContext as AudioContext).resume();
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
    s.crossfader = this.crossfader;
    s.fadingTo = this.fade == null ? '' : this.fade.to < 0 ? 'A' : 'B';
    s.echo = this.fx.echo;
    s.space = this.fx.space;
    s.heard = heard;
    s.dropFrom = this.dropFrom;
    s.dropAt = this.dropAt;
    s.dropping = heard < this.dropAt;
    s.drops = this.dropsScheduled - (s.dropping ? 1 : 0);
    if (master.track != null) {
      const beats = master.position(heard) / (master.barSeconds / 4);
      s.bar = Math.floor(beats / 4);
      s.beat = (Math.floor(beats) % 4) + 1;
      s.step = Math.floor(beats * 4) % 16;
    }
    for (const id of ['A', 'B'] as const) {
      const deck = this.decks[id];
      const channel = this.channels[id];
      const view = s[id];
      view.trackId = deck.track?.id ?? '';
      view.trackName = deck.track?.name ?? '';
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
      view.soloed = deck.soloed();
      view.padMode = this.padModes[id];
      for (let i = 0; i < HOT_CUES; i++) view.hotCues[i] = deck.hotCues[i];
      view.loopBars = deck.loopBars;
      view.roll = deck.roll;
      for (let i = 0; i < KNOBS.length; i++) view.knobs[i] = this.knob(id, KNOBS[i]);
      for (let i = 0; i < KILL_BANDS.length; i++) view.kills[i] = channel.kills[KILL_BANDS[i]];
      view.fader = channel.fader;
      view.level = channel.level;
    }
    return s;
  }

  dispose(): void {
    this.context.off('tick', this.tick);
    for (const id of ['A', 'B'] as const) {
      this.decks[id].dispose();
      this.channels[id].dispose();
    }
    this.fx.dispose();
    this.dropFx.dispose();
    this.master.dispose();
  }
}
