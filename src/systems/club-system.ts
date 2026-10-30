import { Color, createSystem, FogExp2, Matrix4, Mesh, MeshBasicMaterial, Object3D, Vector3 } from '@iwsdk/core';
import type { DataTexture, Entity, Fog, InstancedMesh } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ClubRoom, ConsoleRoot } from '../console-components.js';
import { CEILING_BARS, CEILING_SEGMENTS, DRIVERS, LED_COLS, LED_ROWS, POOLS } from '../scene-assets/club.scene-asset.js';
import { RIG_HEADS } from '../scene-assets/light-rig.scene-asset.js';
import { club } from '../show/club-state.js';
import { newShowFrame, readShow } from '../show/show-clock.js';
import type { ShowFrame } from '../show/show-clock.js';

/** The console's base is this far above the table top it rests on (matches ConsolePlacementSystem). */
const ON_SURFACE_LIFT = 0.045;
const FOG_COLOR = '#0B0C12';

/** hsl channel: h, s, l in 0..1, n = 0 (red), 8 (green) or 4 (blue); returns 0..1 */
function channel(n: number, h: number, a: number, l: number): number {
  const k = (n + h * 12) % 12;
  return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
}

/**
 * Club mode (PLAN-DJ-UPGRADE 3.4). The `club-room` asset is a hidden
 * warehouse around the booth; while `club.on` it is centred on the console
 * with its floor at world y = 0 (the real floor in a local-floor session),
 * the booth table is stretched up to the console's base, the room fills with
 * haze (scene fog) and the lights drop (environment intensity), and the
 * show drives: an LED wall (64 x 24 pixels, bars per deck), ceiling pixel
 * bars rippling outward on the beat, blinders and sub drivers (kick), and a
 * light pool on the floor under each moving head. The moving heads, truss
 * and pixel bars are the same light rig as in mixed reality, scaled up by
 * LightShowSystem. Everything is written into pre-built buffers: nothing is
 * allocated per frame.
 */
export class ClubSystem extends createSystem({
  rooms: { required: [ClubRoom] },
  console: { required: [ConsoleRoot] },
}) {
  private roomEntity: Entity | null = null;
  private consoleEntity: Entity | null = null;
  private root: Object3D | null = null;
  private table!: Object3D;
  private ledData!: Uint8ClampedArray | Uint8Array;
  private ledTexture!: DataTexture;
  private ceiling!: InstancedMesh;
  private blinders!: MeshBasicMaterial;
  private pools!: InstancedMesh;
  private drivers!: InstancedMesh;
  private driverBase!: Float32Array;
  private rig: Object3D | null = null;
  private tilts: Object3D[] = [];
  private beams: Mesh[] = [];
  private show!: ShowFrame;
  private time = 0;
  private applied = false;
  private fog!: FogExp2;
  private previousFog: Fog | FogExp2 | null = null;
  private tint = new Color();
  private previousEnvironment = 1;
  private at!: Vector3;
  private forward!: Vector3;
  private point!: Vector3;
  private dummy!: Object3D;
  private m1!: Matrix4;
  private m2!: Matrix4;

  init(): void {
    this.show = newShowFrame();
    this.at = new Vector3();
    this.forward = new Vector3();
    this.point = new Vector3();
    this.dummy = new Object3D();
    this.m1 = new Matrix4();
    this.m2 = new Matrix4();
    this.fog = new FogExp2(FOG_COLOR, 0.07);
    this.cleanupFuncs.push(
      this.queries.rooms.subscribe('qualify', (entity) => {
        this.roomEntity = entity;
      }),
      this.queries.console.subscribe('qualify', (entity) => {
        this.consoleEntity = entity;
      }),
      // leave no haze or dimmed environment behind if the system goes away
      () => this.apply(false),
    );
  }

  private attach(entity: Entity): boolean {
    const root = entity.object3D;
    const wall = root?.getObjectByName('LedWall') as Mesh | undefined;
    if (root == null || wall == null) return false;
    const led = (wall.material as MeshBasicMaterial).map as DataTexture;
    this.ledTexture = led;
    this.ledData = led.image.data as Uint8Array;
    this.table = root.getObjectByName('BoothTable')!;
    this.ceiling = root.getObjectByName('CeilingLeds') as InstancedMesh;
    const blinders = root.getObjectByName('Blinders') as Mesh;
    this.blinders = (blinders.material as MeshBasicMaterial).clone();
    blinders.material = this.blinders;
    this.pools = root.getObjectByName('FloorPools') as InstancedMesh;
    this.drivers = root.getObjectByName('SpeakerDrivers') as InstancedMesh;
    this.driverBase = new Float32Array(this.drivers.instanceMatrix.array as Float32Array);
    root.visible = false;
    this.root = root;
    return true;
  }

  /** Haze and a dark environment in, or the room as it was. */
  private apply(on: boolean): void {
    if (on === this.applied) return;
    this.applied = on;
    const scene = this.world.scene;
    if (on) {
      this.previousFog = scene.fog;
      this.previousEnvironment = scene.environmentIntensity;
      this.fog.density = this.roomEntity?.getValue(ClubRoom, 'haze') ?? 0.07;
      scene.fog = this.fog;
      scene.environmentIntensity = this.previousEnvironment * (this.roomEntity?.getValue(ClubRoom, 'ambient') ?? 0.3);
    } else {
      scene.fog = this.previousFog;
      scene.environmentIntensity = this.previousEnvironment;
    }
  }

  update(delta: number): void {
    this.time += delta;
    if (this.roomEntity == null) for (const entity of this.queries.rooms.entities) this.roomEntity = entity;
    if (this.consoleEntity == null) for (const entity of this.queries.console.entities) this.consoleEntity = entity;
    if (this.roomEntity == null) return;
    if (this.root == null && !this.attach(this.roomEntity)) return;
    const root = this.root!;
    const on = club.on && this.consoleEntity?.object3D != null;
    this.apply(on);
    root.visible = on;
    club.ledLuma = on ? club.ledLuma : 0;
    if (!on) return;

    // centre on the console, floor at world y = 0, facing the way the console faces
    const consoleObject = this.consoleEntity!.object3D!;
    consoleObject.getWorldPosition(this.at);
    this.forward.setFromMatrixColumn(consoleObject.matrixWorld, 2).negate();
    this.forward.y = 0;
    this.forward.normalize();
    this.table.scale.y = Math.max(0.3, this.at.y - ON_SURFACE_LIFT);
    this.point.set(this.at.x, 0, this.at.z);
    if (root.parent != null) root.parent.worldToLocal(this.point);
    root.position.copy(this.point);
    root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    root.updateMatrixWorld(true);

    readShow(this.show, this.time);
    const show = this.show;
    const state = liveEngine().state;
    this.paintWall(show, state.A.level, state.B.level);
    this.paintCeiling(show);
    this.flashBlinders(show);
    this.pumpDrivers(show);
    this.placePools();
  }

  /** The LED wall: a mirrored spectrum, deck A's side cyan, deck B's magenta. */
  private paintWall(show: ShowFrame, levelA: number, levelB: number): void {
    const data = this.ledData;
    const cap = club.reducedFlash ? 0.12 : 0.35;
    const white = show.flash * cap;
    let luma = 0;
    for (let x = 0; x < LED_COLS; x++) {
      const left = x < LED_COLS / 2;
      const c = Math.abs(x - (LED_COLS - 1) / 2) / (LED_COLS / 2); // 0 centre, 1 edge
      const level = Math.min(1, Math.sqrt(left ? levelA : levelB) * 1.15 + 0.1 + 0.04 * Math.sin(this.time * 2 + x));
      const wobble = 0.5 + 0.5 * Math.sin(x * 1.7 + show.beats * 3.3 + Math.sin(x * 0.31) * 2);
      const height = Math.min(1, level * (0.25 + 0.75 * (1 - c)) * (0.55 + 0.45 * wobble) + show.pulse * 0.18 * (1 - c) * show.energy) * LED_ROWS;
      const hue = ((left ? 0.52 : 0.9) + show.hue * 0.3) % 1;
      for (let r = 0; r < LED_ROWS; r++) {
        const lit = r < height;
        const t = r / LED_ROWS;
        const h = (hue + t * 0.12) % 1;
        const l = lit ? 0.34 + 0.26 * t : 0.035 + 0.05 * show.pulse * show.energy;
        const s = lit ? 0.9 : 0.6;
        const a = s * Math.min(l, 1 - l);
        // texture row 0 is the bottom of the wall
        const i = (r * LED_COLS + x) * 4;
        const rr = channel(0, h, a, l) + white;
        const gg = channel(8, h, a, l) + white;
        const bb = channel(4, h, a, l) + white;
        data[i] = Math.min(255, rr * 255);
        data[i + 1] = Math.min(255, gg * 255);
        data[i + 2] = Math.min(255, bb * 255);
        luma += data[i] + data[i + 1] + data[i + 2];
      }
    }
    club.ledLuma = luma;
    this.ledTexture.needsUpdate = true;
  }

  /** Ceiling bars: a ring of light travels outward from the centre each beat. */
  private paintCeiling(show: ShowFrame): void {
    const mesh = this.ceiling;
    const colour = this.tint;
    const front = show.phase * 1.6;
    for (let b = 0; b < CEILING_BARS; b++) {
      for (let k = 0; k < CEILING_SEGMENTS; k++) {
        const x = Math.abs((k - (CEILING_SEGMENTS - 1) / 2) / (CEILING_SEGMENTS / 2));
        const d = (x + (b % 2) * 0.12 - front) * 4.5;
        const v = Math.exp(-d * d) * (0.35 + 0.65 * show.energy) + 0.05 + show.level * 0.25;
        colour.setHSL((show.hue + x * 0.2 + b * 0.05) % 1, 0.9, 0.5).multiplyScalar(v * 1.5);
        mesh.setColorAt(b * CEILING_SEGMENTS + k, colour);
      }
    }
    mesh.instanceColor!.needsUpdate = true;
  }

  /** Warm blinders: a faint glow on the beat and one soft swell per drop (never a strobe). */
  private flashBlinders(show: ShowFrame): void {
    const swell = club.reducedFlash ? 0.25 : 0.85;
    const v = 0.1 + 0.05 * show.pulse * show.energy + show.flash * swell;
    this.blinders.color.setRGB(v, v * 0.88, v * 0.65);
  }

  /** Sub drivers push out on every beat. */
  private pumpDrivers(show: ShowFrame): void {
    const push = show.pulse * (0.3 + 0.7 * show.energy);
    this.m2.makeScale(1 + 0.05 * push, 1 + 0.05 * push, 1 + 0.7 * push);
    for (let i = 0; i < DRIVERS; i++) {
      this.m1.fromArray(this.driverBase, i * 16).multiply(this.m2);
      this.drivers.setMatrixAt(i, this.m1);
    }
    this.drivers.instanceMatrix.needsUpdate = true;
  }

  /** A pool of coloured light on the floor where each moving head points. */
  private placePools(): void {
    if (this.rig == null) {
      this.rig = this.world.scene.getObjectByName('LightRig') ?? null;
      if (this.rig == null) return;
      for (let i = 0; i < RIG_HEADS; i++) {
        this.tilts.push(this.rig.getObjectByName(`Tilt${i}`)!);
        this.beams.push(this.rig.getObjectByName(`Beam${i}`) as Mesh);
      }
    }
    this.rig.updateMatrixWorld(true);
    const root = this.root!;
    for (let i = 0; i < POOLS; i++) {
      const e = this.tilts[i].matrixWorld.elements;
      const len = Math.hypot(e[4], e[5], e[6]);
      const dy = -e[5] / len;
      const colour = (this.beams[i].material as MeshBasicMaterial).color;
      if (dy > -0.05) {
        this.dummy.scale.setScalar(0);
      } else {
        const t = e[13] / -dy;
        this.point.set(e[12] + (-e[4] / len) * t, 0, e[14] + (-e[6] / len) * t);
        root.worldToLocal(this.point);
        this.dummy.position.set(this.point.x, 0.02, this.point.z);
        this.dummy.scale.setScalar(1.5 + t * 0.12);
      }
      this.dummy.updateMatrix();
      this.pools.setMatrixAt(i, this.dummy.matrix);
      this.pools.setColorAt(i, colour);
    }
    this.pools.instanceMatrix.needsUpdate = true;
    this.pools.instanceColor!.needsUpdate = true;
  }
}
