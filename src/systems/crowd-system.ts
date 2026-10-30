import {
  CapsuleGeometry,
  CircleGeometry,
  Color,
  createSystem,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot } from '../console-components.js';
import { club } from '../show/club-state.js';
import { CrowdEnergy } from '../show/crowd-energy.js';
import { consoleSurface } from './console-placement-system.js';

const DANCERS = 24;
/** Dance floor centre beyond the console's centre (m), and its radius. */
const FLOOR_BEYOND = 0.4;
const FLOOR_RADIUS = 0.2;
const OUTFITS = ['#E8E1D5', '#2E3440', '#C2410C', '#0F766E', '#6D28D9', '#BE185D', '#CA8A04', '#1D4ED8'];
const SKIN = ['#F2D3B8', '#D9A47E', '#A86F4C', '#6B4430', '#E8C4A0'];

/**
 * The placeholder crowd (PLAN §8 Day 8): 24 small dancers on a dance floor
 * just past the console, under the light rig, facing the DJ. They appear
 * when the music starts, bob on the beat as hard as the crowd's energy, put
 * their hands up when it is high and jump when a drop lands. Drawn as four
 * instanced meshes, so the whole crowd costs a handful of draw calls.
 */
export class CrowdSystem extends createSystem({
  console: { required: [ConsoleRoot] },
}) {
  readonly crowd = new CrowdEnergy();
  private root!: Group;
  private bodies!: InstancedMesh;
  private heads!: InstancedMesh;
  private armsL!: InstancedMesh;
  private armsR!: InstancedMesh;
  private spots!: { x: number; z: number; phase: number; height: number }[];
  private dummy!: Object3D;
  private at!: Vector3;
  private forward!: Vector3;
  private consoleEntity: Entity | null = null;

  init(): void {
    this.dummy = new Object3D();
    this.at = new Vector3();
    this.forward = new Vector3();
    this.root = new Group();
    this.root.name = 'Crowd';
    this.root.visible = false;
    const cloth = new MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.8 });
    const skin = new MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.6 });
    this.bodies = new InstancedMesh(new CapsuleGeometry(0.011, 0.034, 4, 10), cloth, DANCERS);
    this.heads = new InstancedMesh(new SphereGeometry(0.0095, 12, 8), skin, DANCERS);
    const arm = new CapsuleGeometry(0.0035, 0.026, 3, 6);
    // pivot at the shoulder: the arm hangs down from its origin
    arm.translate(0, -0.016, 0);
    this.armsL = new InstancedMesh(arm, cloth, DANCERS);
    this.armsR = new InstancedMesh(arm, cloth, DANCERS);
    const color = new Color();
    // deterministic scatter in a half-disc facing the console, no overlaps
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.spots = [];
    while (this.spots.length < DANCERS) {
      const x = (random() * 2 - 1) * FLOOR_RADIUS * 0.9;
      const z = (random() * 2 - 1) * FLOOR_RADIUS * 0.9;
      if (x * x + z * z > (FLOOR_RADIUS * 0.9) ** 2) continue;
      if (this.spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 0.045 ** 2)) continue;
      const i = this.spots.length;
      this.spots.push({ x, z, phase: random() * 0.25, height: 0.92 + random() * 0.16 });
      this.bodies.setColorAt(i, color.set(OUTFITS[i % OUTFITS.length]));
      this.armsL.setColorAt(i, color);
      this.armsR.setColorAt(i, color);
      this.heads.setColorAt(i, color.set(SKIN[i % SKIN.length]));
    }
    const floor = new Mesh(new CircleGeometry(FLOOR_RADIUS, 48), new MeshStandardMaterial({ color: '#0B0D12', roughness: 0.35, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.001;
    const rim = new Mesh(new RingGeometry(FLOOR_RADIUS - 0.004, FLOOR_RADIUS, 64), new MeshStandardMaterial({ color: '#111111', emissive: '#29D7FF', emissiveIntensity: 1.2 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.002;
    this.root.add(floor, rim, this.bodies, this.heads, this.armsL, this.armsR);
    this.world.createTransformEntity(this.root, { persistent: true });
  }

  update(delta: number): void {
    const engine = liveEngine();
    const s = engine.state;
    const energy = this.crowd.update(s, delta);
    // the miniature table crowd gives way to the club (a proper crowd comes on Day 11)
    if (!s.running || club.on) {
      this.root.visible = false;
      return;
    }
    if (this.consoleEntity == null) for (const entity of this.queries.console.entities) this.consoleEntity = entity;
    const consoleObject = this.consoleEntity?.object3D;
    if (consoleObject == null) return;
    this.root.visible = true;

    // stand on the console's surface, beyond it, turned to face the DJ
    consoleObject.getWorldPosition(this.at);
    this.forward.setFromMatrixColumn(consoleObject.matrixWorld, 2).negate();
    this.forward.y = 0;
    this.forward.normalize();
    this.at.addScaledVector(this.forward, FLOOR_BEYOND);
    this.at.y = consoleSurface.placement === 'table' ? consoleSurface.y : this.at.y;
    if (this.root.parent != null) this.root.parent.worldToLocal(this.at);
    this.root.position.copy(this.at);
    this.root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);

    const deck = engine.decks[s.master];
    const beats = deck.track == null ? 0 : deck.position(s.heard) / (deck.barSeconds / 4);
    const sinceDrop = s.drops > 0 ? s.heard - s.dropAt : Infinity;
    const jump = sinceDrop >= 0 && sinceDrop < 0.6 ? Math.sin((sinceDrop / 0.6) * Math.PI) * 0.03 : 0;
    const handsUp = Math.max(0, Math.min(1, (energy - 0.6) / 0.25));
    const d = this.dummy;
    for (let i = 0; i < this.spots.length; i++) {
      const spot = this.spots[i];
      const phase = beats + spot.phase;
      const bob = Math.abs(Math.sin(phase * Math.PI)) * (0.002 + energy * 0.012) + jump;
      const sway = Math.sin(phase * Math.PI * 0.5) * (0.05 + energy * 0.15);
      const scale = spot.height;
      const y = 0.028 * scale + bob;
      d.position.set(spot.x, y, spot.z);
      d.rotation.set(0, sway, Math.sin(phase * Math.PI) * 0.06 * energy);
      d.scale.setScalar(scale);
      d.updateMatrix();
      this.bodies.setMatrixAt(i, d.matrix);
      d.position.set(spot.x, y + 0.03 * scale, spot.z);
      d.updateMatrix();
      this.heads.setMatrixAt(i, d.matrix);
      // arms: down by the sides at low energy, up and pumping when hyped
      const pump = handsUp * (2.6 + Math.sin(phase * Math.PI * 2) * 0.25);
      this.arm(this.armsL, i, -1, spot.x, y, spot.z, scale, sway, pump);
      this.arm(this.armsR, i, 1, spot.x, y, spot.z, scale, sway, pump);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.armsL.instanceMatrix.needsUpdate = true;
    this.armsR.instanceMatrix.needsUpdate = true;
  }

  /** One arm from the shoulder: `side` -1 left, 1 right; `pump` raises it. */
  private arm(mesh: InstancedMesh, i: number, side: number, x: number, y: number, z: number, scale: number, sway: number, pump: number): void {
    const d = this.dummy;
    d.position.set(x + side * 0.013 * scale * Math.cos(sway), y + 0.016 * scale, z - side * 0.013 * scale * Math.sin(sway));
    d.rotation.set(0, sway, side * (0.15 + pump));
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
}
