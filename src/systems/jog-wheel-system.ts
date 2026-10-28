import { createSystem } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { JogWheel, MusicState } from '../console-components.js';

/** 33⅓ rpm, the speed a record turns at, in radians per second. */
const SPIN = ((100 / 3) * Math.PI * 2) / 60;

/** Spins each jog wheel's platter like a record while its deck plays. The
 * angle follows the deck's playhead, so the platter runs faster with the
 * tempo fader, holds still when paused and winds back on CUE. */
export class JogWheelSystem extends createSystem({
  wheels: { required: [JogWheel] },
  music: { required: [MusicState] },
}) {
  private platters!: Map<number, Object3D | null>;

  init(): void {
    this.platters = new Map();
  }

  // scene content attaches after the entity qualifies, so look the platter up lazily
  private platter(entity: { index: number; object3D?: Object3D | null }): Object3D | null {
    let platter = this.platters.get(entity.index) ?? null;
    if (platter == null) {
      platter = entity.object3D?.getObjectByName('Platter') ?? null;
      if (platter != null) this.platters.set(entity.index, platter);
    }
    return platter;
  }

  update(): void {
    let music = null;
    for (const entity of this.queries.music.entities) music = entity;
    if (music == null) return;
    for (const entity of this.queries.wheels.entities) {
      const platter = this.platter(entity);
      if (platter == null) continue;
      const deckB = entity.getValue(JogWheel, 'deck') === 'B';
      const position = music.getValue(MusicState, deckB ? 'positionB' : 'positionA') ?? 0;
      // track seconds already run faster at a higher tempo
      platter.rotation.y = -(position * SPIN) % (Math.PI * 2);
    }
  }
}
