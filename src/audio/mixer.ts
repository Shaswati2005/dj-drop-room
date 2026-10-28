import * as Tone from 'tone';

export type Band = 'low' | 'mid' | 'high';
export const BANDS: readonly Band[] = ['low', 'mid', 'high'];

/** EQ knob -1..1 → dB: full cut is -26 dB like a DJM, boost tops out at +6. */
const eqDb = (v: number) => (v < 0 ? v * 26 : v * 6);
const KILL_DB = -80;

/**
 * One mixer channel (PLAN-DJ-UPGRADE §3.3): TRIM → 3-band EQ with isolator
 * kills → one-knob FILTER (left = low-pass, right = high-pass, centre off) →
 * channel fader → crossfader gain. Meters the signal after the fader, as a
 * DJ mixer's channel meter does.
 */
export class Channel {
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;
  trim = 0;
  eq: Record<Band, number> = { low: 0, mid: 0, high: 0 };
  kills: Record<Band, boolean> = { low: false, mid: false, high: false };
  filter = 0;
  fader = 1;
  private readonly trimGain: Tone.Gain;
  private readonly eq3: Tone.EQ3;
  private readonly lowpass: Tone.Filter;
  private readonly highpass: Tone.Filter;
  private readonly faderGain: Tone.Gain;
  private readonly meter: LevelMeter;

  constructor(private readonly context: Tone.BaseContext) {
    this.input = new Tone.Gain({ context });
    this.trimGain = new Tone.Gain({ context });
    this.eq3 = new Tone.EQ3({ context, lowFrequency: 250, highFrequency: 2500 });
    this.lowpass = new Tone.Filter({ context, type: 'lowpass', frequency: 20000, Q: 1.2, rolloff: -24 });
    this.highpass = new Tone.Filter({ context, type: 'highpass', frequency: 10, Q: 1.2, rolloff: -24 });
    this.faderGain = new Tone.Gain({ context });
    this.output = new Tone.Gain({ context });
    this.meter = new LevelMeter(context);
    this.input.chain(this.trimGain, this.eq3, this.lowpass, this.highpass, this.faderGain, this.output);
    this.faderGain.connect(this.meter.input);
  }

  /** Post-fader level, 0..1. */
  get level(): number {
    return this.meter.level;
  }

  /** TRIM -1..1 → -12..+6 dB. */
  setTrim(v: number): void {
    this.trim = clamp(v, -1, 1);
    this.trimGain.gain.rampTo(Tone.dbToGain(this.trim < 0 ? this.trim * 12 : this.trim * 6), 0.03);
  }

  setEq(band: Band, v: number): void {
    this.eq[band] = clamp(v, -1, 1);
    this.applyBand(band);
  }

  /** Isolator kill: the band drops out entirely until tapped again. */
  toggleKill(band: Band): void {
    this.kills[band] = !this.kills[band];
    this.applyBand(band);
  }

  /** FILTER -1..1: left sweeps a low-pass down to 150 Hz, right a high-pass up
   * to 6 kHz; a small dead zone at the centre leaves the sound untouched. */
  setFilter(v: number): void {
    this.filter = clamp(v, -1, 1);
    const amount = Math.max(0, Math.abs(this.filter) - 0.04) / 0.96;
    const lp = this.filter < 0 ? 20000 * Math.pow(150 / 20000, amount) : 20000;
    const hp = this.filter > 0 ? 10 * Math.pow(6000 / 10, amount) : 10;
    this.lowpass.frequency.rampTo(lp, 0.03);
    this.highpass.frequency.rampTo(hp, 0.03);
  }

  setFader(v: number): void {
    this.fader = clamp(v, 0, 1);
    // squared taper: the top of the fader is where the loudness changes
    this.faderGain.gain.rampTo(this.fader * this.fader, 0.02);
  }

  setCrossfade(gain: number): void {
    this.output.gain.rampTo(gain, 0.02);
  }

  private applyBand(band: Band): void {
    const param = this.eq3[band];
    param.rampTo(this.kills[band] ? KILL_DB : eqDb(this.eq[band]), 0.03);
  }

  dispose(): void {
    for (const node of [this.input, this.trimGain, this.eq3, this.lowpass, this.highpass, this.faderGain, this.output]) node.dispose();
    this.meter.dispose();
  }
}

/** Beat FX on the master: ECHO (a 3/4-beat delay) and SPACE (reverb), fed by
 * a send from every channel. Turning one off lets its tail ring out. */
export class MasterFx {
  readonly input: Tone.Gain;
  echo = false;
  space = false;
  private readonly echoSend: Tone.Gain;
  private readonly spaceSend: Tone.Gain;
  private readonly delay: Tone.FeedbackDelay;
  private readonly reverb: Tone.Reverb;

  constructor(context: Tone.BaseContext, destination: Tone.InputNode) {
    this.input = new Tone.Gain({ context });
    this.echoSend = new Tone.Gain({ context, gain: 0 });
    this.spaceSend = new Tone.Gain({ context, gain: 0 });
    this.delay = new Tone.FeedbackDelay({ context, delayTime: 0.36, feedback: 0.45, wet: 1, maxDelay: 2 });
    this.reverb = new Tone.Reverb({ context, decay: 4.5, preDelay: 0.02, wet: 1 });
    const hp = new Tone.Filter({ context, type: 'highpass', frequency: 300 });
    this.input.fan(this.echoSend, this.spaceSend);
    this.echoSend.chain(hp, this.delay, destination);
    this.spaceSend.chain(this.reverb, destination);
  }

  toggleEcho(bpm: number): void {
    this.echo = !this.echo;
    this.delay.delayTime.rampTo((0.75 * 60) / bpm, 0.05);
    this.echoSend.gain.rampTo(this.echo ? 0.55 : 0, 0.05);
  }

  toggleSpace(): void {
    this.space = !this.space;
    this.spaceSend.gain.rampTo(this.space ? 0.6 : 0, 0.08);
  }

  dispose(): void {
    for (const node of [this.input, this.echoSend, this.spaceSend, this.delay, this.reverb]) node.dispose();
  }
}

/** "Dipless" crossfader curve: both channels full in the middle, each fading
 * out over its far half. x = -1 is all A, +1 all B. */
export function crossfadeGains(x: number): [number, number] {
  const c = clamp(x, -1, 1);
  return [Math.cos((Math.max(0, c) * Math.PI) / 2), Math.cos((Math.max(0, -c) * Math.PI) / 2)];
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A level meter that falls back at a fixed rate in audio time (like an LED
 * meter's release), however often it is read. Tone's own smoothing decays per
 * read, so slow frames would leave it hanging. */
export class LevelMeter {
  private readonly meter: Tone.Meter;
  private value = 0;
  private readAt = 0;

  constructor(private readonly context: Tone.BaseContext, private readonly release = 0.15) {
    this.meter = new Tone.Meter({ context, smoothing: 0, normalRange: true });
  }

  get input(): Tone.Meter {
    return this.meter;
  }

  /** 0..1 */
  get level(): number {
    const now = this.context.currentTime;
    const raw = this.meter.getValue();
    const fresh = typeof raw === 'number' ? raw : raw[0];
    this.value = Math.max(fresh, this.value * Math.exp(-Math.max(0, now - this.readAt) / this.release));
    this.readAt = now;
    return this.value;
  }

  dispose(): void {
    this.meter.dispose();
  }
}
