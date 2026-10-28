import { createSystem, Vector3, VisibilityState, XRMesh, XRPlane } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot } from '../console-components.js';

const TILT = (15 * Math.PI) / 180; // far edge raised toward the player, PLAN §2.1
/** Lift so the tilted console's near edge rests on a surface instead of
 * sinking into it (sin 15° × half the 32 cm depth, plus a little). */
const ON_SURFACE_LIFT = 0.045;
/** A surface counts as the player's table when its top is this far below the
 * head (m): lower is out of comfortable reach for a seated player. */
const TABLE_BELOW = [0.25, 0.75];
/** ...and the forward ray crosses it this far from the head (m). */
const TABLE_REACH = [0.25, 0.8];

/** Where the console sits: on a detected table, or floating in front. */
export type Placement = 'table' | 'head';

/** The surface the console stands on, for things that share it (the crowd). */
export const consoleSurface = { placement: 'head' as Placement, y: 0 };

/**
 * Puts the console in front of the seated player when XR starts (PLAN §5.1):
 * first `forward` ahead of the head and `below` under it, facing them; then,
 * until the music starts, onto the real table when scene understanding finds
 * one within reach (a horizontal plane, or a mesh labelled "table"), so the
 * table becomes the booth. Rooms without detection keep the floating console.
 */
export class ConsolePlacementSystem extends createSystem({
  consoles: { required: [ConsoleRoot] },
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  /** where the console was last put, for tests and the status line */
  placement: Placement = 'head';
  private head = new Vector3();
  private forward = new Vector3();
  private point = new Vector3();
  private corner = new Vector3();
  private pending = false;
  private bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: 0 };

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) this.pending = true;
      }),
    );
  }

  update(): void {
    if (this.pending) {
      this.pending = false;
      this.placement = 'head';
      this.player.head.getWorldPosition(this.head);
      this.player.head.getWorldDirection(this.forward);
      // Object3D.getWorldDirection returns +Z; a camera looks down -Z
      this.forward.negate();
      this.forward.y = 0;
      if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
      this.forward.normalize();
      for (const entity of this.queries.consoles.entities) {
        const ahead = entity.getValue(ConsoleRoot, 'forward') ?? 0.44;
        const below = entity.getValue(ConsoleRoot, 'below') ?? 0.45;
        this.point.set(this.head.x + this.forward.x * ahead, this.head.y - below, this.head.z + this.forward.z * ahead);
        this.put(entity);
      }
    }
    // a table found before the set starts takes over; never move mid-set
    if (this.placement === 'table' || liveEngine().state.running) return;
    if (!this.findTable()) return;
    this.placement = 'table';
    for (const entity of this.queries.consoles.entities) this.put(entity);
  }

  private put(entity: Entity): void {
    const object = entity.object3D;
    if (object == null) return;
    object.position.copy(this.point);
    consoleSurface.placement = this.placement;
    consoleSurface.y = this.point.y - (this.placement === 'table' ? ON_SURFACE_LIFT : 0);
    object.rotation.set(TILT, Math.atan2(-this.forward.x, -this.forward.z), 0, 'YXZ');
  }

  /** Looks for a horizontal surface in reach ahead of the head pose taken at
   * session start; on success leaves the console's spot in `point`. */
  private findTable(): boolean {
    let best = Infinity;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as globalThis.XRPlane | undefined;
      if (plane == null || plane.orientation !== 'horizontal' || entity.object3D == null) continue;
      // the polygon lies in the plane's own x/z; its world bounds
      const b = this.bounds;
      b.minX = b.minZ = Infinity;
      b.maxX = b.maxZ = -Infinity;
      b.top = -Infinity;
      for (const p of plane.polygon) {
        entity.object3D.localToWorld(this.corner.set(p.x, p.y, p.z));
        b.minX = Math.min(b.minX, this.corner.x);
        b.maxX = Math.max(b.maxX, this.corner.x);
        b.minZ = Math.min(b.minZ, this.corner.z);
        b.maxZ = Math.max(b.maxZ, this.corner.z);
        b.top = Math.max(b.top, this.corner.y);
      }
      best = this.consider(best);
    }
    for (const entity of this.queries.meshes.entities) {
      if (entity.getValue(XRMesh, 'semanticLabel') !== 'table' || entity.object3D == null) continue;
      // min/max are the mesh's local box; its world bounds from the 8 corners
      const min = entity.getVectorView(XRMesh, 'min');
      const max = entity.getVectorView(XRMesh, 'max');
      const b = this.bounds;
      b.minX = b.minZ = Infinity;
      b.maxX = b.maxZ = -Infinity;
      b.top = -Infinity;
      for (let i = 0; i < 8; i++) {
        this.corner.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
        entity.object3D.localToWorld(this.corner);
        b.minX = Math.min(b.minX, this.corner.x);
        b.maxX = Math.max(b.maxX, this.corner.x);
        b.minZ = Math.min(b.minZ, this.corner.z);
        b.maxZ = Math.max(b.maxZ, this.corner.z);
        b.top = Math.max(b.top, this.corner.y);
      }
      best = this.consider(best);
    }
    return best < Infinity;
  }

  /** If `bounds` is a reachable table nearer than `best`, aim the console at
   * it: the default distance when that spot is on the table, else the first
   * point on it along the forward ray (8 cm in from its near edge). */
  private consider(best: number): number {
    const b = this.bounds;
    const drop = this.head.y - b.top;
    if (drop < TABLE_BELOW[0] || drop > TABLE_BELOW[1]) return best;
    const inside = (d: number) => {
      const x = this.head.x + this.forward.x * d;
      const z = this.head.z + this.forward.z * d;
      return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
    };
    let at = -1;
    if (inside(0.44)) at = 0.44;
    else
      for (let d = TABLE_REACH[0]; d <= TABLE_REACH[1]; d += 0.01)
        if (inside(d)) {
          at = Math.min(TABLE_REACH[1], d + 0.08);
          break;
        }
    if (at < 0 || drop >= best) return best;
    this.point.set(this.head.x + this.forward.x * at, b.top + ON_SURFACE_LIFT, this.head.z + this.forward.z * at);
    return drop;
  }
}
