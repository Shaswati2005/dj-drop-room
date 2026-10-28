import { AudioContext as ThreeAudioContext } from '@iwsdk/core';
import * as Tone from 'tone';

/**
 * The one live audio context. Tone wraps Three's shared AudioContext so the
 * app never runs two contexts (IWSDK's AudioSystem uses Three's). It is also
 * made Tone's global so library code that reaches for it finds the same one;
 * the engine itself only uses the instance it is given (PLAN §3.7).
 */
export function createLiveContext(): Tone.Context {
  const context = new Tone.Context(ThreeAudioContext.getContext());
  context.lookAhead = 0.1;
  Tone.setContext(context);
  return context;
}

/** A fresh offline context for rendering `seconds` of stereo audio. */
export function createOfflineContext(seconds: number, sampleRate = 44100): Tone.OfflineContext {
  return new Tone.OfflineContext(2, seconds, sampleRate);
}
