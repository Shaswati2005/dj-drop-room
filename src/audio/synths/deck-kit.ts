import * as Tone from 'tone';
import type { DrumVoice } from '../track-model.js';

/** The instruments one deck plays through (PLAN §3.3). Created once per deck
 * with an explicit context and reused for every track; never per note. */
export class DeckKit {
  readonly drums: Tone.Gain;
  readonly bass: Tone.Gain;
  readonly chords: Tone.Gain;
  readonly melody: Tone.Gain;

  private readonly voices: Record<DrumVoice, Tone.MembraneSynth | Tone.NoiseSynth>;
  private readonly bassSynth: Tone.MonoSynth;
  private readonly chordSynth: Tone.PolySynth;
  private readonly leadSynth: Tone.MonoSynth;
  private readonly nodes: Tone.ToneAudioNode[] = [];

  constructor(context: Tone.BaseContext) {
    const keep = <T extends Tone.ToneAudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    this.drums = keep(new Tone.Gain({ context }));
    this.bass = keep(new Tone.Gain({ context }));
    this.chords = keep(new Tone.Gain({ context }));
    this.melody = keep(new Tone.Gain({ context }));

    const kick = keep(
      new Tone.MembraneSynth({
        context,
        pitchDecay: 0.045,
        octaves: 5,
        envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.05 },
        volume: -2,
      }),
    );
    kick.connect(this.drums);

    const noise = (decay: number, filter: Partial<Tone.FilterOptions>, volume: number) => {
      const synth = keep(
        new Tone.NoiseSynth({
          context,
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay, sustain: 0, release: 0.02 },
          volume,
        }),
      );
      const shape = keep(new Tone.Filter({ context, ...filter }));
      synth.chain(shape, this.drums);
      return synth;
    };
    this.voices = {
      kick,
      clap: noise(0.18, { type: 'bandpass', frequency: 1500, Q: 1 }, -10),
      snare: noise(0.12, { type: 'bandpass', frequency: 1800, Q: 1 }, -12),
      hat: noise(0.03, { type: 'highpass', frequency: 7000 }, -16),
      openHat: noise(0.25, { type: 'highpass', frequency: 7000 }, -20),
    };

    this.bassSynth = keep(
      new Tone.MonoSynth({
        context,
        oscillator: { type: 'sawtooth' },
        filter: { type: 'lowpass', Q: 2, rolloff: -24 },
        filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.1, baseFrequency: 110, octaves: 2.5 },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.08 },
        volume: -8,
      }),
    );
    this.bassSynth.connect(this.bass);

    this.chordSynth = keep(
      new Tone.PolySynth({
        context,
        voice: Tone.Synth,
        maxPolyphony: 6,
        options: {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.005, decay: 0.25, sustain: 0.15, release: 0.15 },
        },
        volume: -9,
      }),
    );
    const chordTone = keep(new Tone.Filter({ context, type: 'lowpass', frequency: 2200 }));
    this.chordSynth.chain(chordTone, this.chords);

    this.leadSynth = keep(
      new Tone.MonoSynth({
        context,
        oscillator: { type: 'square' },
        portamento: 0.03,
        filter: { type: 'lowpass', Q: 1 },
        filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2, baseFrequency: 700, octaves: 2 },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
        volume: -12,
      }),
    );
    this.leadSynth.connect(this.melody);
  }

  drum(voice: DrumVoice, time: number, duration: number, velocity: number): void {
    const synth = this.voices[voice];
    if (synth instanceof Tone.MembraneSynth) synth.triggerAttackRelease('C1', duration, time, velocity);
    else synth.triggerAttackRelease(duration, time, velocity);
  }

  bassNote(hz: number, time: number, duration: number, velocity: number): void {
    this.bassSynth.triggerAttackRelease(hz, duration, time, velocity);
  }

  chord(hz: number[], time: number, duration: number, velocity: number): void {
    this.chordSynth.triggerAttackRelease(hz, duration, time, velocity);
  }

  lead(hz: number, time: number, duration: number, velocity: number): void {
    this.leadSynth.triggerAttackRelease(hz, duration, time, velocity);
  }

  /** Release anything still sounding (deck stop). */
  silence(time: number): void {
    this.chordSynth.releaseAll(time);
    this.bassSynth.triggerRelease(time);
    this.leadSynth.triggerRelease(time);
  }

  dispose(): void {
    for (const node of this.nodes) node.dispose();
  }
}
