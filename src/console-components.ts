import { createComponent, Types } from '@iwsdk/core';

export const Decks = { A: 'A', B: 'B' } as const;
export const StemNames = { drums: 'drums', bass: 'bass', chords: 'chords', melody: 'melody' } as const;
export const ButtonActions = { play: 'play', cue: 'cue', sync: 'sync', start: 'start' } as const;

/** A poke pad that toggles one stem of one deck on the next bar. */
export const StemPad = createComponent('StemPad', {
  deck: { type: Types.Enum, enum: Decks, default: Decks.A },
  stem: { type: Types.Enum, enum: StemNames, default: StemNames.drums },
  active: { type: Types.Boolean, default: true, help: 'Stem is heard (mirrored from the engine)' },
  armed: { type: Types.Boolean, default: false, help: 'A toggle waits for the next bar' },
});

/** A poke button with a single action, e.g. PLAY for a deck or Start. */
export const PushButton = createComponent('PushButton', {
  action: { type: Types.Enum, enum: ButtonActions, default: ButtonActions.play },
  deck: { type: Types.Enum, enum: Decks, default: Decks.A },
  lit: { type: Types.Boolean, default: false },
  armed: { type: Types.Boolean, default: false },
});

/** A jog wheel; its platter spins with the deck it belongs to. */
export const JogWheel = createComponent('JogWheel', {
  deck: { type: Types.Enum, enum: Decks, default: Decks.A },
});

/** The console root; placed in front of the player when XR starts. */
export const ConsoleRoot = createComponent('ConsoleRoot', {
  forward: { type: Types.Float32, default: 0.44, help: 'Distance in front of the head (m)' },
  below: { type: Types.Float32, default: 0.45, help: 'Distance below the head (m)' },
});

/** Singleton mirror of what the audio engine believes, for tests and the show. */
export const MusicState = createComponent('MusicState', {
  audioRunning: { type: Types.Boolean, default: false },
  bpm: { type: Types.Float32, default: 124 },
  bar: { type: Types.Int32, default: 0 },
  beat: { type: Types.Int32, default: 1 },
  phraseBar: { type: Types.Int32, default: 0 },
  sectionA: { type: Types.String, default: '' },
  sectionB: { type: Types.String, default: '' },
  playingA: { type: Types.Boolean, default: false },
  playingB: { type: Types.Boolean, default: false },
  stemsA: { type: Types.Vec4, default: [1, 1, 1, 1], help: 'drums, bass, chords, melody (1 = heard)' },
  stemsB: { type: Types.Vec4, default: [1, 1, 1, 1] },
  bpmA: { type: Types.Float32, default: 0 },
  bpmB: { type: Types.Float32, default: 0 },
  positionA: { type: Types.Float32, default: 0, help: 'Playhead, track seconds' },
  positionB: { type: Types.Float32, default: 0 },
  latencyMs: { type: Types.Float32, default: 0 },
  level: { type: Types.Float32, default: 0 },
});
