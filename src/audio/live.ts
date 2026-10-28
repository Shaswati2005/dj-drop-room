import { createLiveContext } from './context.js';
import { Engine } from './engine.js';

let engine: Engine | null = null;

/** The app's single live engine, created on first use. */
export function liveEngine(): Engine {
  engine ??= new Engine(createLiveContext());
  return engine;
}

/** Resume audio from inside a user gesture (click, key, XR select). Browsers
 * only allow the context to start from one. */
export function unlockAudio(): void {
  const raw = liveEngine().context.rawContext as AudioContext;
  if (raw.state !== 'running') void raw.resume();
}
