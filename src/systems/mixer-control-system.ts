import { createSystem, Grabbed, Pressed, Vector3 } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import type { KnobControl } from '../audio/engine.js';
import type { DeckId } from '../audio/deck.js';
import { Fader, Knob } from '../console-components.js';
import { readFingertip } from './fingertip.js';

/** Knob travel each side of centre: 135°, a DJ mixer's 270° sweep. */
export const KNOB_RANGE = (135 * Math.PI) / 180;
/** Finger slide (m) that turns a knob from the centre to either end. */
const SLIDE_RANGE = 0.025;
/** Below this slide (m) a press counts as a tap. */
const TAP_SLOP = 0.006;
/** The finger has left once it is this far (m) above the knob's base. */
const LIFTED = 0.035;
/** Only finger movement within this height (m) of the press's lowest point
 * turns the knob: drift as the finger lifts away must not turn a tap into a
 * small turn. */
const SLIDE_HEIGHT = 0.008;

interface Turn {
  /** which hand presses the knob */
  hand: XRHandedness;
  start: Vector3;
  startValue: number;
  moved: boolean;
  /** lowest fingertip height above the knob's base so far in this press */
  lowest: number;
  /** still touching the knob (Pressed); a turn outlives brief contact loss */
  touching: boolean;
}

/**
 * Two-way binding between the console's knobs/faders and the mixer.
 * Faders: while pinched (Grabbed, moved by a constrained grab handle) their
 * position sets the value. Knobs sit 32 mm apart, too close for a pinch to
 * pick one, so a knob is pressed with a fingertip and turned by sliding the
 * finger right (up) or left (down); a press that does not slide is a tap,
 * which kills the band (EQ) or snaps TRIM/FILTER to the centre. Otherwise the
 * engine value poses the control, so SYNC moves the tempo fader and the A/B
 * buttons glide the crossfader. Clockwise (seen from above) is up.
 */
export class MixerControlSystem extends createSystem({
  knobs: { required: [Knob] },
  pressedKnobs: { required: [Knob, Pressed] },
  faders: { required: [Fader] },
}) {
  private turns!: Map<number, Turn>;
  private finger!: Vector3;
  private axis!: Vector3;
  private knobAt!: Vector3;

  init(): void {
    this.turns = new Map();
    this.finger = new Vector3();
    this.axis = new Vector3();
    this.knobAt = new Vector3();
    const engine = liveEngine();
    this.cleanupFuncs.push(
      this.queries.pressedKnobs.subscribe('qualify', (entity) => {
        // a finger sliding off and back onto the knob mid-turn is the same turn
        const turn = this.turns.get(entity.index);
        if (turn != null) {
          turn.touching = true;
          return;
        }
        const hand = this.nearestHand(entity) ?? 'none';
        const start = hand === 'none' ? new Vector3() : this.finger.clone();
        this.turns.set(entity.index, { hand, start, startValue: entity.getValue(Knob, 'value') ?? 0, moved: false, lowest: Infinity, touching: true });
      }),
      this.queries.pressedKnobs.subscribe('disqualify', (entity) => {
        const turn = this.turns.get(entity.index);
        if (turn == null) return;
        turn.touching = false;
        // with a tracked hand, tap or turn is decided when the finger lifts (update)
        if (turn.hand === 'none') this.endTurn(entity, turn);
      }),
    );
  }

  /** A press ends: one that never slid was a tap, which kills the band (EQ)
   * or snaps TRIM/FILTER to the centre. */
  private endTurn(entity: Entity, turn: Turn): void {
    this.turns.delete(entity.index);
    const engine = liveEngine();
    if (turn.moved || !engine.state.running) return;
    engine.tapKnob(entity.getValue(Knob, 'deck') as DeckId, entity.getValue(Knob, 'control') as KnobControl);
    engine.click(false);
  }

  private fingertip(handedness: XRHandedness): boolean {
    return readFingertip(this.world.renderer, this.player, handedness, this.finger);
  }

  /** The hand whose index fingertip is closest to the knob (within 8 cm),
   * leaving its tip in this.finger. */
  private nearestHand(entity: Entity): XRHandedness | null {
    if (entity.object3D == null) return null;
    entity.object3D.getWorldPosition(this.knobAt);
    let best: XRHandedness | null = null;
    let bestDistance = 0.08;
    for (const hand of ['left', 'right'] as const) {
      if (!this.fingertip(hand)) continue;
      const d = this.finger.distanceTo(this.knobAt);
      if (d < bestDistance) {
        bestDistance = d;
        best = hand;
      }
    }
    if (best != null) this.fingertip(best);
    return best;
  }

  update(): void {
    const engine = liveEngine();
    for (const entity of this.queries.knobs.entities) {
      const turn = this.turns.get(entity.index);
      const object = entity.object3D;
      if (turn == null || turn.hand === 'none' || object?.parent == null) continue;
      if (!this.fingertip(turn.hand)) {
        this.endTurn(entity, turn);
        continue;
      }
      // slide along the console's left-right axis; the press ends once the
      // finger is off the knob and lifted clear of it
      const console = object.parent.matrixWorld;
      object.getWorldPosition(this.knobAt);
      this.axis.setFromMatrixColumn(console, 1).normalize();
      const lift = this.knobAt.sub(this.finger).negate().dot(this.axis);
      if (!turn.touching && lift > LIFTED) {
        this.endTurn(entity, turn);
        continue;
      }
      turn.lowest = Math.min(turn.lowest, lift);
      if (lift > turn.lowest + SLIDE_HEIGHT) continue;
      this.axis.setFromMatrixColumn(console, 0).normalize();
      const slide = this.knobAt.copy(this.finger).sub(turn.start).dot(this.axis);
      if (!turn.moved && Math.abs(slide) < TAP_SLOP) continue;
      turn.moved = true;
      const v = Math.max(-1, Math.min(1, turn.startValue + slide / SLIDE_RANGE));
      const deck = entity.getValue(Knob, 'deck') as DeckId;
      const control = entity.getValue(Knob, 'control') as KnobControl;
      if (Math.abs(v - engine.knob(deck, control)) > 0.002) engine.setKnob(deck, control, v);
    }
    for (const entity of this.queries.knobs.entities) {
      entity.object3D?.rotation.set(0, -(entity.getValue(Knob, 'value') ?? 0) * KNOB_RANGE, 0);
    }
    for (const entity of this.queries.faders.entities) {
      const object = entity.object3D;
      if (object == null) continue;
      const control = entity.getValue(Fader, 'control');
      const from = entity.getValue(Fader, 'from') ?? 0;
      const to = entity.getValue(Fader, 'to') ?? 1;
      const axis = control === 'crossfader' ? 'x' : 'z';
      const unipolar = control === 'channel';
      if (entity.hasComponent(Grabbed)) {
        const t = Math.max(0, Math.min(1, (object.position[axis] - from) / (to - from)));
        const v = unipolar ? t : t * 2 - 1;
        if (Math.abs(v - (entity.getValue(Fader, 'value') ?? 0)) < 0.002) continue;
        const deck = entity.getValue(Fader, 'deck') as DeckId;
        if (control === 'crossfader') engine.setCrossfader(v);
        else if (control === 'tempo') engine.setTempo(deck, v);
        else engine.setFader(deck, v);
      } else {
        const v = entity.getValue(Fader, 'value') ?? 0;
        const t = unipolar ? v : (v + 1) / 2;
        object.position[axis] = from + t * (to - from);
      }
    }
  }
}
