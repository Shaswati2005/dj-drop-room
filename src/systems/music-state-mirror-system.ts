import { createSystem } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { STEMS } from '../audio/track-model.js';
import type { Stem } from '../audio/track-model.js';
import { ButtonActions, MusicState, PushButton, StemPad } from '../console-components.js';

/** Copies the engine's "as heard" state into ECS every frame (PLAN §6.4), so
 * `ecs find` proves what the audio engine believes without listening. */
export class MusicStateMirrorSystem extends createSystem({
  state: { required: [MusicState] },
  pads: { required: [StemPad] },
  buttons: { required: [PushButton] },
}) {
  update(): void {
    const s = liveEngine().update();
    for (const entity of this.queries.state.entities) {
      entity.setValue(MusicState, 'audioRunning', s.running);
      entity.setValue(MusicState, 'bpm', s.bpm);
      entity.setValue(MusicState, 'bar', s.bar);
      entity.setValue(MusicState, 'beat', s.beat);
      entity.setValue(MusicState, 'phraseBar', s.A.phraseBar);
      entity.setValue(MusicState, 'sectionA', s.A.section);
      entity.setValue(MusicState, 'sectionB', s.B.section);
      entity.setValue(MusicState, 'playingA', s.A.playing);
      entity.setValue(MusicState, 'playingB', s.B.playing);
      entity.setValue(MusicState, 'latencyMs', s.latencyMs);
      entity.setValue(MusicState, 'level', s.level);
      const a = entity.getVectorView(MusicState, 'stemsA');
      const b = entity.getVectorView(MusicState, 'stemsB');
      for (let i = 0; i < 4; i++) {
        a[i] = s.A.stems[i];
        b[i] = s.B.stems[i];
      }
    }
    for (const entity of this.queries.pads.entities) {
      const view = entity.getValue(StemPad, 'deck') === 'B' ? s.B : s.A;
      const i = STEMS.indexOf(entity.getValue(StemPad, 'stem') as Stem);
      entity.setValue(StemPad, 'active', view.stems[i] === 1);
      entity.setValue(StemPad, 'armed', view.armed[i]);
    }
    for (const entity of this.queries.buttons.entities) {
      if (entity.getValue(PushButton, 'action') === ButtonActions.start) {
        entity.setValue(PushButton, 'lit', !s.running);
        continue;
      }
      const view = entity.getValue(PushButton, 'deck') === 'B' ? s.B : s.A;
      entity.setValue(PushButton, 'lit', view.playing);
      entity.setValue(PushButton, 'armed', view.playArmed);
    }
  }
}
