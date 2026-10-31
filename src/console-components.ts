import { createComponent, Types } from '@iwsdk/core';

export const Decks = { A: 'A', B: 'B' } as const;
export const ButtonActions = {
  play: 'play',
  cue: 'cue',
  sync: 'sync',
  start: 'start',
  mode: 'mode',
  echo: 'echo',
  space: 'space',
  drop: 'drop',
  fade: 'fade',
  load: 'load',
  rec: 'rec',
  share: 'share',
  club: 'club',
  help: 'help',
  volDown: 'volDown',
  volUp: 'volUp',
  dimDown: 'dimDown',
  dimUp: 'dimUp',
  flash: 'flash',
  finish: 'finish',
} as const;
export const KnobControls = { trim: 'trim', high: 'high', mid: 'mid', low: 'low', filter: 'filter' } as const;
export const FaderControls = { channel: 'channel', tempo: 'tempo', crossfader: 'crossfader' } as const;

/** One of a deck's 8 performance pads (slots 0-3 top row). What it does and
 * how it lights depend on the deck's pad mode; the mirror system sets the look. */
export const PerfPad = createComponent('PerfPad', {
  deck: { type: Types.Enum, enum: Decks, default: Decks.A },
  slot: { type: Types.Int8, default: 0, min: 0, max: 7 },
  color: { type: Types.Color, default: [1, 1, 1, 1] },
  lit: { type: Types.Float32, default: 0, help: 'Glow 0..1 (mirrored from the engine)' },
  armed: { type: Types.Boolean, default: false, help: 'A change waits for the next bar' },
});

/** A mixer knob: pinch and twist to turn, poke to kill the band (EQ) or
 * snap back to the centre (TRIM, FILTER). */
export const Knob = createComponent('Knob', {
  deck: { type: Types.Enum, enum: Decks, default: Decks.A },
  control: { type: Types.Enum, enum: KnobControls, default: KnobControls.trim },
  value: { type: Types.Float32, default: 0, help: '-1..1 (mirrored from the engine)' },
  killed: { type: Types.Boolean, default: false },
});

/** A fader cap that slides along its slot with a pinch. `from`/`to` are its
 * local positions (x for the crossfader, z otherwise) at the low and high end. */
export const Fader = createComponent('Fader', {
  deck: { type: Types.Enum, enum: Decks, default: Decks.A },
  control: { type: Types.Enum, enum: FaderControls, default: FaderControls.channel },
  from: { type: Types.Float32, default: 0 },
  to: { type: Types.Float32, default: 0 },
  value: { type: Types.Float32, default: 0, help: 'channel 0..1, tempo and crossfader -1..1' },
});

/** A poke button with a single action, e.g. PLAY for a deck or Start;
 * `index` picks the pad mode for mode buttons and the crate slot for load buttons. */
export const PushButton = createComponent('PushButton', {
  action: { type: Types.Enum, enum: ButtonActions, default: ButtonActions.play },
  deck: { type: Types.Enum, enum: Decks, default: Decks.A },
  index: { type: Types.Int8, default: 0 },
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

/** The light rig: hidden until the first DROP, then hung above the console. */
export const LightRig = createComponent('LightRig', {
  height: { type: Types.Float32, default: 0.95, help: 'Ring height above the console (m)' },
  beyond: { type: Types.Float32, default: 0.5, help: 'Ring centre past the console, away from the player (m)' },
  maxDim: { type: Types.Float32, default: 0.7, help: 'Room dimming at the peak of a riser, 0..1' },
  settleDim: { type: Types.Float32, default: 0.35, help: 'Room dimming after a drop has landed' },
});

/** The club-mode warehouse (hidden until the CLUB button): haze and how dark the room is. */
export const ClubRoom = createComponent('ClubRoom', {
  haze: { type: Types.Float32, default: 0.09, min: 0, max: 0.3, help: 'Fog density (per metre) while in the club' },
  ambient: { type: Types.Float32, default: 0.3, min: 0, max: 1, help: 'Environment light while in the club (1 = as in the room)' },
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
  crossfader: { type: Types.Float32, default: 0, help: '-1 = all A, +1 = all B' },
  levelA: { type: Types.Float32, default: 0, help: 'Channel meter 0..1' },
  levelB: { type: Types.Float32, default: 0 },
  latencyMs: { type: Types.Float32, default: 0 },
  level: { type: Types.Float32, default: 0 },
  drops: { type: Types.Int32, default: 0, help: 'DROPs landed so far' },
  trackA: { type: Types.String, default: '', help: 'Track id on deck A' },
  trackB: { type: Types.String, default: '' },
  recording: { type: Types.Boolean, default: false, help: 'REC is recording' },
  takes: { type: Types.Int32, default: 0, help: 'Finished recordings' },
  recBytes: { type: Types.Int32, default: 0, help: 'Size of the last recording (bytes)' },
  refusals: { type: Types.Int32, default: 0, help: 'Crate loads refused because the deck was playing' },
  shares: { type: Types.Int32, default: 0, help: 'SHARE pokes' },
  moves: { type: Types.Int32, default: 0, help: 'Moves in the set log' },
  club: { type: Types.Boolean, default: false, help: 'Club mode (opaque warehouse around the booth) is on' },
});
