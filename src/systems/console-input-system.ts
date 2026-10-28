import { createSystem, Pressed } from '@iwsdk/core';
import { liveEngine, unlockAudio } from '../audio/live.js';
import { PAD_MODES } from '../audio/engine.js';
import type { DeckId } from '../audio/deck.js';
import { ButtonActions, PerfPad, PushButton } from '../console-components.js';

/** Fingertip pokes → engine commands (knob presses: MixerControlSystem).
 * Each press clicks at once; musical changes themselves wait for their beat
 * or bar inside the engine. */
export class ConsoleInputSystem extends createSystem({
  padPresses: { required: [PerfPad, Pressed] },
  buttonPresses: { required: [PushButton, Pressed] },
}) {
  init(): void {
    const engine = liveEngine();
    this.cleanupFuncs.push(
      this.queries.padPresses.subscribe('qualify', (entity) => {
        if (!engine.state.running) return;
        engine.pad(entity.getValue(PerfPad, 'deck') as DeckId, entity.getValue(PerfPad, 'slot') ?? 0, true);
        engine.click();
      }),
      // releases matter for rolls, which last as long as the finger stays down
      this.queries.padPresses.subscribe('disqualify', (entity) => {
        if (engine.state.running) engine.pad(entity.getValue(PerfPad, 'deck') as DeckId, entity.getValue(PerfPad, 'slot') ?? 0, false);
      }),
      this.queries.buttonPresses.subscribe('qualify', (entity) => {
        const action = entity.getValue(PushButton, 'action');
        if (action === ButtonActions.start) {
          unlockAudio();
          void engine.start().then(() => engine.click());
          return;
        }
        if (!engine.state.running) return;
        const deck = entity.getValue(PushButton, 'deck') as DeckId;
        switch (action) {
          case ButtonActions.cue:
            engine.cue(deck);
            break;
          case ButtonActions.sync:
            engine.sync(deck);
            break;
          case ButtonActions.mode:
            engine.setPadMode(deck, PAD_MODES[entity.getValue(PushButton, 'index') ?? 0]);
            break;
          case ButtonActions.echo:
            engine.toggleEcho();
            break;
          case ButtonActions.space:
            engine.toggleSpace();
            break;
          case ButtonActions.fade:
            engine.fadeTo(deck);
            break;
          case ButtonActions.drop:
            // DROP arrives on Day 7 (PLAN-DJ-UPGRADE §4)
            break;
          default:
            engine.togglePlay(deck);
        }
        engine.click(false);
      }),
    );
  }
}
