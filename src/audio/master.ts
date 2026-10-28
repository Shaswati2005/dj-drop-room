import * as Tone from 'tone';
import { LevelMeter } from './mixer.js';

/** Master bus: compressor → limiter → destination, with a meter for the show
 * systems (PLAN §3.7). Also owns the UI click, which skips the bus so it is
 * never compressed under the music. */
export class Master {
  readonly input: Tone.Gain;
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Limiter;
  private readonly meter: LevelMeter;
  private readonly clickSynth: Tone.Synth;
  private readonly clickGain: Tone.Gain;
  private lastClick = 0;

  constructor(private readonly context: Tone.BaseContext) {
    this.input = new Tone.Gain({ context, gain: 0.7 });
    this.compressor = new Tone.Compressor({ context, threshold: -18, ratio: 3, attack: 0.01, release: 0.15 });
    // -2 dB leaves room for Tone's limiter overshoot under the -1 dBFS ceiling
    this.limiter = new Tone.Limiter({ context, threshold: -2 });
    this.meter = new LevelMeter(context);
    this.input.chain(this.compressor, this.limiter);
    this.limiter.toDestination();
    this.limiter.connect(this.meter.input);

    this.clickGain = new Tone.Gain({ context, gain: 0.12 }).toDestination();
    this.clickSynth = new Tone.Synth({
      context,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
    }).connect(this.clickGain);
  }

  /** Output level, 0..1. */
  get level(): number {
    return this.meter.level;
  }

  /** Immediate press feedback; not quantised. */
  click(high = true): void {
    const t = Math.max(this.context.currentTime + 0.005, this.lastClick + 0.01);
    this.lastClick = t;
    this.clickSynth.triggerAttackRelease(high ? 2200 : 1400, 0.03, t);
  }

  dispose(): void {
    for (const node of [this.input, this.compressor, this.limiter, this.clickSynth, this.clickGain]) {
      node.dispose();
    }
    this.meter.dispose();
  }
}
