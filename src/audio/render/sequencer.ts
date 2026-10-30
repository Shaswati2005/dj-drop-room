import * as Tone from 'tone';
import { DeckKit } from '../synths/deck-kit.js';
import { generatorFor } from '../tracks/catalog.js';
import { midiToHz, sectionAt } from '../track-model.js';
import type { Stem, TrackDef } from '../track-model.js';

/**
 * Plays a generated track bar by bar on a Tone transport. Used only to
 * render tracks into stem files (build time) and for offline sound checks;
 * the live decks play those files like a real DJ deck plays a track.
 */
export class Sequencer {
  readonly output: Tone.Gain;
  private readonly kit: DeckKit;
  private readonly transport: Tone.BaseContext['transport'];
  private trackBar = 0;

  constructor(
    context: Tone.BaseContext,
    private readonly track: TrackDef,
    startBar = 0,
    /** schedule only this stem (stem renders); all stems when omitted */
    private readonly only?: Stem,
  ) {
    this.kit = new DeckKit(context, track.genre);
    this.output = new Tone.Gain({ context });
    for (const gain of [this.kit.drums, this.kit.bass, this.kit.chords, this.kit.melody]) gain.connect(this.output);
    this.trackBar = startBar;
    this.transport = context.transport;
    this.transport.bpm.value = track.bpm;
    this.transport.scheduleRepeat((time) => this.onBar(time), '1m', 0);
  }

  start(): void {
    this.transport.start(0);
  }

  private onBar(time: number): void {
    const ctx = sectionAt(this.track, this.trackBar++);
    const pattern = generatorFor(this.track)(this.track, ctx);
    const sixteenth = 60 / this.track.bpm / 4;
    const swing = this.track.swing * sixteenth;
    const at = (step: number) => time + step * sixteenth + (step % 2 === 1 ? swing : 0);
    const wants = (stem: Stem) => this.only == null || this.only === stem;

    if (wants('drums')) {
      for (const e of pattern.drums) this.kit.drum(e.voice!, at(e.step), e.length * sixteenth * 0.9, e.velocity);
    }
    if (wants('bass')) {
      for (const e of pattern.bass) this.kit.bassNote(midiToHz(e.notes![0]), at(e.step), e.length * sixteenth * 0.9, e.velocity);
    }
    if (wants('chords')) {
      for (const e of pattern.chords) this.kit.chord(e.notes!.map(midiToHz), at(e.step), e.length * sixteenth * 0.9, e.velocity);
    }
    if (wants('melody')) {
      for (const e of pattern.melody) this.kit.lead(midiToHz(e.notes![0]), at(e.step), e.length * sixteenth * 0.9, e.velocity);
    }
  }

  dispose(): void {
    this.transport.stop();
    this.transport.cancel();
    this.kit.dispose();
    this.output.dispose();
  }
}

