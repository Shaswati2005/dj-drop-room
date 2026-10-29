import { Color, createSystem } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { KNOBS, PAD_MODES } from '../audio/engine.js';
import type { DeckView, EngineState, KnobControl } from '../audio/engine.js';
import { ButtonActions, Fader, Knob, MusicState, PerfPad, PushButton } from '../console-components.js';

/** Pad colours per mode (stem colours; hot cues A-D in the usual DJ-software colours). */
const STEM_COLORS = ['#FF7A2E', '#2E8BFF', '#A65CFF', '#2EFFB0'].map((c) => new Color(c));
const CUE_COLORS = ['#FF3B3B', '#FF9A1F', '#FFE11F', '#3DFF6E'].map((c) => new Color(c));
const LOOP_COLOR = new Color('#3DFF6E');
const ROLL_COLOR = new Color('#29D7FF');
const DELETE_COLOR = new Color('#FFFFFF');

/** Copies the engine's "as heard" state into ECS every frame (PLAN §6.4), so
 * `ecs find` proves what the audio engine believes without listening, and the
 * feedback systems light the console from it. */
export class MusicStateMirrorSystem extends createSystem({
  state: { required: [MusicState] },
  pads: { required: [PerfPad] },
  buttons: { required: [PushButton] },
  knobs: { required: [Knob] },
  faders: { required: [Fader] },
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
      entity.setValue(MusicState, 'drops', s.drops);
      entity.setValue(MusicState, 'bpmA', s.A.bpm);
      entity.setValue(MusicState, 'bpmB', s.B.bpm);
      entity.setValue(MusicState, 'positionA', s.A.position);
      entity.setValue(MusicState, 'positionB', s.B.position);
      entity.setValue(MusicState, 'crossfader', s.crossfader);
      entity.setValue(MusicState, 'levelA', s.A.level);
      entity.setValue(MusicState, 'levelB', s.B.level);
      const a = entity.getVectorView(MusicState, 'stemsA');
      const b = entity.getVectorView(MusicState, 'stemsB');
      for (let i = 0; i < 4; i++) {
        a[i] = s.A.stems[i];
        b[i] = s.B.stems[i];
      }
    }
    for (const entity of this.queries.pads.entities) {
      const view = entity.getValue(PerfPad, 'deck') === 'B' ? s.B : s.A;
      this.mirrorPad(entity, view, entity.getValue(PerfPad, 'slot') ?? 0);
    }
    for (const entity of this.queries.buttons.entities) this.mirrorButton(entity, s);
    for (const entity of this.queries.knobs.entities) {
      const view = entity.getValue(Knob, 'deck') === 'B' ? s.B : s.A;
      const control = entity.getValue(Knob, 'control') as KnobControl;
      entity.setValue(Knob, 'value', view.knobs[KNOBS.indexOf(control)]);
      const kill = control === 'high' ? 0 : control === 'mid' ? 1 : control === 'low' ? 2 : -1;
      entity.setValue(Knob, 'killed', kill >= 0 && view.kills[kill]);
    }
    for (const entity of this.queries.faders.entities) {
      const view = entity.getValue(Fader, 'deck') === 'B' ? s.B : s.A;
      const control = entity.getValue(Fader, 'control');
      entity.setValue(Fader, 'value', control === 'crossfader' ? s.crossfader : control === 'tempo' ? view.tempo : view.fader);
    }
  }

  private mirrorPad(entity: Entity, view: DeckView, slot: number): void {
    const color = entity.getVectorView(PerfPad, 'color');
    const top = slot < 4;
    const i = slot % 4;
    let c = STEM_COLORS[i];
    let lit = 0.06;
    let armed = false;
    if (view.padMode === 'stems') {
      if (top) {
        lit = view.stems[i] === 1 ? 1 : 0.06;
        armed = view.armed[i];
      } else {
        lit = view.soloed === i ? 1 : 0.15;
      }
    } else if (view.padMode === 'cues') {
      const set = view.hotCues[i] >= 0;
      c = top ? CUE_COLORS[i] : DELETE_COLOR;
      lit = top ? (set ? 1 : 0.06) : set ? 0.25 : 0.02;
    } else {
      c = top ? LOOP_COLOR : ROLL_COLOR;
      lit = top ? (view.loopBars === [1, 2, 4, 8][i] ? 1 : 0.15) : view.roll === i ? 1 : 0.15;
    }
    color[0] = c.r;
    color[1] = c.g;
    color[2] = c.b;
    entity.setValue(PerfPad, 'lit', lit);
    entity.setValue(PerfPad, 'armed', armed);
  }

  private mirrorButton(entity: Entity, s: EngineState): void {
    const action = entity.getValue(PushButton, 'action');
    const view = entity.getValue(PushButton, 'deck') === 'B' ? s.B : s.A;
    const other = view === s.A ? s.B : s.A;
    let lit = false;
    switch (action) {
      case ButtonActions.start:
        lit = !s.running;
        break;
      // like a DJ media player: PLAY lit while playing, CUE lit while parked, SYNC lit when tempos match
      case ButtonActions.cue:
        lit = !view.playing;
        break;
      case ButtonActions.sync:
        lit = other.playing && Math.abs(view.bpm - other.bpm) < 0.01;
        break;
      case ButtonActions.mode:
        lit = view.padMode === PAD_MODES[entity.getValue(PushButton, 'index') ?? 0];
        break;
      case ButtonActions.echo:
        lit = s.echo;
        break;
      case ButtonActions.space:
        lit = s.space;
        break;
      case ButtonActions.fade:
        lit = s.fadingTo === (view === s.A ? 'A' : 'B') || (view === s.A ? s.crossfader <= -0.99 : s.crossfader >= 0.99);
        break;
      case ButtonActions.drop:
        // charged while the riser builds, and for a bar after it lands
        lit = s.dropping || (s.drops > 0 && s.heard - s.dropAt < 240 / s.bpm);
        break;
      default:
        lit = view.playing;
    }
    entity.setValue(PushButton, 'lit', lit);
    entity.setValue(PushButton, 'armed', (action === ButtonActions.play && view.playArmed) || (action === ButtonActions.drop && s.dropping));
  }
}
