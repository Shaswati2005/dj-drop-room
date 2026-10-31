import * as Tone from 'tone';
import { LevelMeter } from './mixer.js';

/** Master bus: compressor → limiter → destination, with a meter for the show
 * systems (PLAN §3.7). Also owns the UI click, which skips the bus so it is
 * never compressed under the music. */
export class Master {
  readonly input: Tone.Gain;
  /** the volume setting and the end-of-set fade act here, ahead of the compressor */
  private readonly bus: Tone.Gain;
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Limiter;
  private readonly meter: LevelMeter;
  private readonly clickSynth: Tone.Synth;
  private readonly clickGain: Tone.Gain;
  private readonly applauseNoise: Tone.NoiseSynth;
  private readonly applauseGain: Tone.Gain;
  private lastClick = 0;
  /** volume setting 0..1 */
  volume = 1;

  constructor(private readonly context: Tone.BaseContext) {
    this.input = new Tone.Gain({ context, gain: 0.7 });
    this.bus = new Tone.Gain({ context, gain: 1 });
    this.compressor = new Tone.Compressor({ context, threshold: -18, ratio: 3, attack: 0.01, release: 0.15 });
    // -2 dB leaves room for Tone's limiter overshoot under the -1 dBFS ceiling
    this.limiter = new Tone.Limiter({ context, threshold: -2 });
    this.meter = new LevelMeter(context);
    this.input.chain(this.bus, this.compressor, this.limiter);
    this.limiter.toDestination();
    this.limiter.connect(this.meter.input);

    this.clickGain = new Tone.Gain({ context, gain: 0.12 }).toDestination();
    this.clickSynth = new Tone.Synth({
      context,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
    }).connect(this.clickGain);

    // applause after Finish Set: band-passed noise with a fast tremolo for claps, straight to the speakers
    this.applauseGain = new Tone.Gain({ context, gain: 0.35 }).toDestination();
    const claps = new Tone.Tremolo({ context, frequency: 11, depth: 0.85 }).connect(this.applauseGain).start();
    const band = new Tone.Filter({ context, type: 'bandpass', frequency: 2400, Q: 0.7 }).connect(claps);
    this.applauseNoise = new Tone.NoiseSynth({
      context,
      noise: { type: 'pink' },
      envelope: { attack: 0.4, decay: 3, sustain: 0, release: 0.8 },
    }).connect(band);
  }

  /** The last node before the speakers (what the recorder listens to). */
  get output(): Tone.ToneAudioNode {
    return this.limiter;
  }

  /** Volume 0..1 (squared: a perceptual taper). */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.bus.gain.rampTo(this.volume * this.volume, 0.05);
  }

  /** Fade the whole bus to silence (end of set). */
  fadeOut(seconds: number): void {
    this.bus.gain.rampTo(0, seconds);
  }

  /** Undo fadeOut: back to the volume setting. */
  restore(): void {
    this.bus.gain.cancelScheduledValues(this.context.currentTime);
    this.bus.gain.rampTo(this.volume * this.volume, 0.1);
  }

  applause(): void {
    this.applauseNoise.triggerAttackRelease(3.5, this.context.currentTime + 0.05);
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
    for (const node of [this.input, this.bus, this.applauseNoise, this.applauseGain, this.compressor, this.limiter, this.clickSynth, this.clickGain]) {
      node.dispose();
    }
    this.meter.dispose();
  }
}
