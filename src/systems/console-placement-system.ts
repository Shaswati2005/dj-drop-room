import { createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { ConsoleRoot } from '../console-components.js';

const TILT = (15 * Math.PI) / 180; // far edge raised toward the player, PLAN §2.1

/** When an XR session starts, put the console in front of the seated player:
 * `forward` ahead of the head and `below` under it, facing them (PLAN §5.1). */
export class ConsolePlacementSystem extends createSystem({
  consoles: { required: [ConsoleRoot] },
}) {
  private head = new Vector3();
  private forward = new Vector3();
  private pending = false;

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) this.pending = true;
      }),
    );
  }

  update(): void {
    if (!this.pending) return;
    this.pending = false;
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldDirection(this.forward);
    // Object3D.getWorldDirection returns +Z; a camera looks down -Z
    this.forward.negate();
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    for (const entity of this.queries.consoles.entities) {
      const object = entity.object3D!;
      const ahead = entity.getValue(ConsoleRoot, 'forward') ?? 0.44;
      const below = entity.getValue(ConsoleRoot, 'below') ?? 0.45;
      object.position.set(
        this.head.x + this.forward.x * ahead,
        this.head.y - below,
        this.head.z + this.forward.z * ahead,
      );
      object.rotation.set(TILT, Math.atan2(-this.forward.x, -this.forward.z), 0, 'YXZ');
    }
  }
}
