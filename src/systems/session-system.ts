import { createSystem, VisibilityState } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';

/** Clean pause/resume (the brief's "easy to get into and out of"): when the
 * XR session is hidden or blurred (headset off, system menu open) the music
 * freezes, and it picks up on the same beat when the player is back. */
export class SessionSystem extends createSystem({}) {
  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const engine = liveEngine();
        // leaving XR pauses too; the engine ignores both before the set starts
        if (state === VisibilityState.Visible) engine.resume();
        else engine.suspend();
      }),
    );
  }
}
