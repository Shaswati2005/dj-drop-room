import { createSystem, Pressed } from '@iwsdk/core';
import { liveEngine, unlockAudio } from '../audio/live.js';
import type { DeckId } from '../audio/deck.js';
import type { Stem } from '../audio/track-model.js';
import { ButtonActions, PushButton, StemPad } from '../console-components.js';

/** Fingertip pokes → engine commands. Each press clicks at once; the musical
 * change itself waits for the next bar inside the engine. */
export class ConsoleInputSystem extends createSystem({
  stemPresses: { required: [StemPad, Pressed] },
  buttonPresses: { required: [PushButton, Pressed] },
}) {
  init(): void {
    this.cleanupFuncs.push(
      this.queries.stemPresses.subscribe('qualify', (entity) => {
        const engine = liveEngine();
        if (!engine.state.running) return;
        engine.toggleStem(entity.getValue(StemPad, 'deck') as DeckId, entity.getValue(StemPad, 'stem') as Stem);
        engine.click();
      }),
      this.queries.buttonPresses.subscribe('qualify', (entity) => {
        const engine = liveEngine();
        const action = entity.getValue(PushButton, 'action');
        if (action === ButtonActions.start) {
          unlockAudio();
          void engine.start().then(() => engine.click());
          return;
        }
        if (!engine.state.running) return;
        const deck = entity.getValue(PushButton, 'deck') as DeckId;
        if (action === ButtonActions.cue) engine.cue(deck);
        else if (action === ButtonActions.sync) engine.sync(deck);
        else engine.togglePlay(deck);
        engine.click(false);
      }),
    );
  }
}
