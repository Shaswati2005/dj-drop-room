import { Color, createSystem, Mesh, MeshStandardMaterial, Pressed } from '@iwsdk/core';
import type { Entity, Object3D } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ButtonActions, PerfPad, PushButton } from '../console-components.js';

const PRESS_DEPTH = 0.007; // m, PLAN §2.2
const AMBER = new Color('#FFB020');

interface PadVisual {
  cap: Object3D;
  material: MeshStandardMaterial;
  color: Color;
  restY: number;
  wasActive: boolean;
  flash: number;
}

/** Hover-free pad feedback: lit when on, pulsing at beat rate while armed,
 * a flash when the change is heard, and a 7 mm press. */
export class PadFeedbackSystem extends createSystem({
  pads: { required: [PerfPad] },
  buttons: { required: [PushButton] },
}) {
  private visuals = new Map<number, PadVisual>();

  init(): void {
    const untrack = (entity: Entity) => this.visuals.delete(entity.index);
    this.cleanupFuncs.push(
      this.queries.pads.subscribe('disqualify', untrack),
      this.queries.buttons.subscribe('disqualify', untrack),
    );
  }

  /** Scene content is attached after entities qualify, so each pad's cap is
   * looked up on the first frame it exists. */
  private visual(entity: Entity): PadVisual | undefined {
    const known = this.visuals.get(entity.index);
    if (known != null) return known;
    const cap = entity.object3D?.getObjectByName('Cap') as Mesh | undefined;
    if (cap == null) return undefined;
    // each pad gets its own material so lighting one never lights the rest
    const material = (cap.material as MeshStandardMaterial).clone();
    cap.material = material;
    const v: PadVisual = {
      cap,
      material,
      color: material.emissive.clone(),
      restY: cap.position.y,
      wasActive: true,
      flash: 0,
    };
    this.visuals.set(entity.index, v);
    return v;
  }

  update(delta: number): void {
    const state = liveEngine().state;
    // on for the first half of every beat
    const beatOn = state.step % 4 < 2;
    const ease = 1 - Math.exp(-30 * delta);

    for (const entity of this.queries.pads.entities) {
      const v = this.visual(entity);
      if (v == null) continue;
      // colour and glow come from the deck's pad mode (mirror system)
      const c = entity.getVectorView(PerfPad, 'color');
      v.color.setRGB(c[0], c[1], c[2]);
      const lit = entity.getValue(PerfPad, 'lit') ?? 0;
      const active = lit > 0.5;
      if (active !== v.wasActive) v.flash = 1;
      v.wasActive = active;
      this.apply(entity, v, lit, entity.getValue(PerfPad, 'armed') === true, beatOn, ease, delta);
      v.material.emissive.copy(v.color);
    }
    for (const entity of this.queries.buttons.entities) {
      const v = this.visual(entity);
      if (v == null) continue;
      const lit = entity.getValue(PushButton, 'lit') === true;
      const armed = entity.getValue(PushButton, 'armed') === true;
      if (entity.getValue(PushButton, 'action') === ButtonActions.start) {
        // the start pad breathes until the music starts, then goes away
        entity.object3D!.visible = lit;
        v.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(performance.now() / 300);
        continue;
      }
      if (lit !== v.wasActive) v.flash = 1;
      v.wasActive = lit;
      v.material.emissive.copy(armed ? AMBER : v.color);
      // REC pulses red while recording
      const rec = lit && entity.getValue(PushButton, 'action') === ButtonActions.rec;
      this.apply(entity, v, rec ? 0.55 + 0.45 * Math.sin(performance.now() / 180) : lit ? 1 : 0.08, armed, beatOn, ease, delta);
    }
  }

  private apply(
    entity: Entity,
    v: PadVisual,
    level: number,
    armed: boolean,
    beatOn: boolean,
    ease: number,
    delta: number,
  ): void {
    v.flash = Math.max(0, v.flash - delta * 5);
    const pulse = armed ? (beatOn ? 0.9 : 0.25) : level;
    v.material.emissiveIntensity = pulse + v.flash * 1.5;
    const goal = v.restY - (entity.hasComponent(Pressed) ? PRESS_DEPTH : 0);
    v.cap.position.y += (goal - v.cap.position.y) * ease;
  }
}
