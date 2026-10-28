import * as Tone from 'tone';

/**
 * The sounds around a DROP (PLAN §3.5): a white-noise riser whose band opens
 * up to the drop, then on the downbeat a sub impact and a noise down-sweep.
 * The noise runs continuously behind closed gains, so nothing has to start
 * on time at the moment of the drop.
 */
export class DropFx {
  private readonly noise: Tone.Noise;
  private readonly riserFilter: Tone.Filter;
  private readonly riserGain: Tone.Gain;
  private readonly sweepFilter: Tone.Filter;
  private readonly sweepGain: Tone.Gain;
  private readonly boom: Tone.MembraneSynth;
  private started = false;

  constructor(context: Tone.BaseContext, destination: Tone.InputNode) {
    this.noise = new Tone.Noise({ context, type: 'white' });
    this.riserFilter = new Tone.Filter({ context, type: 'bandpass', frequency: 300, Q: 1.4 });
    this.riserGain = new Tone.Gain({ context, gain: 0 });
    this.sweepFilter = new Tone.Filter({ context, type: 'lowpass', frequency: 9000, Q: 0.8 });
    this.sweepGain = new Tone.Gain({ context, gain: 0 });
    this.noise.fan(this.riserFilter, this.sweepFilter);
    this.riserFilter.chain(this.riserGain, destination);
    this.sweepFilter.chain(this.sweepGain, destination);
    this.boom = new Tone.MembraneSynth({
      context,
      pitchDecay: 0.08,
      octaves: 4,
      envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.4 },
      volume: -4,
    }).connect(destination);
  }

  /** Riser from `from` to the drop at `to` (audio times). */
  riser(from: number, to: number): void {
    if (!this.started) {
      this.noise.start();
      this.started = true;
    }
    const f = this.riserFilter.frequency;
    f.cancelScheduledValues(from);
    f.setValueAtTime(300, from);
    f.exponentialRampToValueAtTime(9000, to);
    const g = this.riserGain.gain;
    g.cancelScheduledValues(from);
    g.setValueAtTime(0, from);
    g.linearRampToValueAtTime(0.3, to - 0.01);
    g.setValueAtTime(0, to);
  }

  /** Impact and down-sweep on the drop at `at`, the sweep lasting `seconds`. */
  impact(at: number, seconds: number): void {
    this.boom.triggerAttackRelease('A0', 0.8, at);
    const f = this.sweepFilter.frequency;
    f.cancelScheduledValues(at);
    f.setValueAtTime(9000, at);
    f.exponentialRampToValueAtTime(200, at + seconds);
    const g = this.sweepGain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(0.22, at);
    g.exponentialRampToValueAtTime(0.001, at + seconds);
    g.setValueAtTime(0, at + seconds + 0.01);
  }

  dispose(): void {
    this.noise.dispose();
    this.riserFilter.dispose();
    this.riserGain.dispose();
    this.sweepFilter.dispose();
    this.sweepGain.dispose();
    this.boom.dispose();
  }
}
