import { createSystem, Grabbed } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { JOG_SPIN } from '../audio/engine.js';
import { liveEngine } from '../audio/live.js';
import type { DeckId } from '../audio/deck.js';
import { JogWheel, MusicState } from '../console-components.js';

interface Wheel {
  platter: Object3D;
  /** wheel yaw last frame while pinched, for the turn delta */
  lastYaw: number;
  held: boolean;
}

/** Jog wheels. The platter spins like a record while its deck plays (its
 * angle follows the playhead, so it holds still when paused and winds back on
 * CUE). Pinch the wheel and twist: playing → pitch bend to nudge into phase,
 * paused → move through the track like turning a record by hand. */
export class JogWheelSystem extends createSystem({
  wheels: { required: [JogWheel] },
  music: { required: [MusicState] },
}) {
  private wheels!: Map<number, Wheel>;

  init(): void {
    this.wheels = new Map();
  }

  // scene content attaches after the entity qualifies, so look the platter up lazily
  private wheel(entity: { index: number; object3D?: Object3D | null }): Wheel | null {
    let wheel = this.wheels.get(entity.index) ?? null;
    if (wheel == null) {
      const platter = entity.object3D?.getObjectByName('Platter');
      if (platter == null) return null;
      entity.object3D!.rotation.order = 'YXZ';
      wheel = { platter, lastYaw: 0, held: false };
      this.wheels.set(entity.index, wheel);
    }
    return wheel;
  }

  update(delta: number): void {
    let music = null;
    for (const entity of this.queries.music.entities) music = entity;
    if (music == null) return;
    const engine = liveEngine();
    for (const entity of this.queries.wheels.entities) {
      const wheel = this.wheel(entity);
      if (wheel == null) continue;
      const root = entity.object3D!;
      const deck = entity.getValue(JogWheel, 'deck') as DeckId;
      const held = entity.hasComponent(Grabbed);
      if (held) {
        let turn = root.rotation.y - wheel.lastYaw;
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        wheel.lastYaw = root.rotation.y;
        // clockwise from above (negative yaw) moves the track forward
        if (wheel.held) engine.jog(deck, -turn, delta);
      } else if (wheel.held) {
        engine.jog(deck, 0, delta);
        root.rotation.set(0, 0, 0);
        wheel.lastYaw = 0;
      }
      wheel.held = held;
      const position = music.getValue(MusicState, deck === 'B' ? 'positionB' : 'positionA') ?? 0;
      // the platter shows the playhead whatever the hand did to the wheel
      wheel.platter.rotation.y = -((position * JOG_SPIN) % (Math.PI * 2)) - root.rotation.y;
    }
  }
}
