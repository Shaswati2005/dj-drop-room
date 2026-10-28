import { BackSide, Color, InstancedMesh, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor, createSystem, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import type { Entity, Object3D } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot, LightRig } from '../console-components.js';
import { PIXEL_BARS, PIXEL_OFF, PIXELS, pixelIndex, RIG_HEADS } from '../scene-assets/light-rig.scene-asset.js';

/** Seconds for the rig to fade in once the first riser starts. */
const REVEAL = 1.2;
/** Seconds the room takes to settle back after a drop lands. */
const SETTLE = 3;

interface Fixture {
  pan: Object3D;
  tilt: Object3D;
  beam: MeshBasicMaterial;
}

/**
 * The show that answers the DROP (PLAN §1 "the lights go down in your room"):
 * a dark translucent dome around the player dims the real room through
 * passthrough as the riser builds (to `maxDim`) and settles after the drop
 * (`settleDim`); the light rig fades in on the first riser, its moving heads
 * sweep in time and flash on every drop, and the pixel bars bounce with the
 * master level and chase the beat. Before the first DROP none of this shows.
 */
export class LightShowSystem extends createSystem({
  rigs: { required: [LightRig] },
  console: { required: [ConsoleRoot] },
}) {
  private dome!: Mesh;
  private domeMaterial!: MeshBasicMaterial;
  private fixtures!: Fixture[];
  private pixels: InstancedMesh | null = null;
  private pixelOff!: Color;
  private rigObject: Object3D | null = null;
  private rigEntity: Entity | null = null;
  private consoleEntity: Entity | null = null;
  private color!: Color;
  private at!: Vector3;
  private forward!: Vector3;
  private revealedAt = -1;
  private time = 0;

  init(): void {
    this.fixtures = [];
    this.pixelOff = new Color(PIXEL_OFF);
    this.color = new Color();
    this.at = new Vector3();
    this.forward = new Vector3();
    // a black veil over the real room: drawn first of all (opaque pass, low
    // render order, no depth test) so it darkens only what lies behind our
    // content, however near the room is; alpha blends like a normal
    // transparent material so passthrough shows through at 1 - opacity
    this.domeMaterial = new MeshBasicMaterial({
      color: '#000000',
      opacity: 0,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.dome = new Mesh(new SphereGeometry(0.5, 24, 12), this.domeMaterial);
    this.dome.name = 'RoomDimmer';
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.dome.visible = false;
    this.world.createTransformEntity(this.dome, { persistent: true });
    this.cleanupFuncs.push(
      this.queries.rigs.subscribe('qualify', (entity) => {
        this.rigEntity = entity;
      }),
      this.queries.console.subscribe('qualify', (entity) => {
        this.consoleEntity = entity;
      }),
    );
  }

  /** Collect the rig's animated parts once its asset has loaded. */
  private attach(entity: Entity): boolean {
    const rig = entity.object3D;
    if (rig?.getObjectByName('Beam0') == null) return false;
    for (let i = 0; i < RIG_HEADS; i++) {
      const beam = rig.getObjectByName(`Beam${i}`) as Mesh;
      // each beam gets its own colour
      const material = (beam.material as MeshBasicMaterial).clone();
      beam.material = material;
      this.fixtures.push({ pan: rig.getObjectByName(`Pan${i}`)!, tilt: rig.getObjectByName(`Tilt${i}`)!, beam: material });
    }
    this.pixels = rig.getObjectByName('Pixels') as InstancedMesh;
    this.rigObject = rig;
    rig.visible = false;
    return true;
  }

  update(delta: number): void {
    this.time += delta;
    // entities authored in the scene can predate this system's subscriptions
    if (this.rigEntity == null) for (const entity of this.queries.rigs.entities) this.rigEntity = entity;
    if (this.consoleEntity == null) for (const entity of this.queries.console.entities) this.consoleEntity = entity;
    const rigEntity = this.rigEntity;
    if (rigEntity == null) return;
    if (this.rigObject == null && !this.attach(rigEntity)) return;
    const rig = this.rigObject!;
    const engine = liveEngine();
    const s = engine.state;
    const started = s.dropping || s.drops > 0;

    // the room dimmer, centred on the head
    const maxDim = rigEntity.getValue(LightRig, 'maxDim') ?? 0.7;
    const settleDim = rigEntity.getValue(LightRig, 'settleDim') ?? 0.35;
    let dim = 0;
    if (s.dropping) {
      const t = Math.min(1, Math.max(0, (s.heard - s.dropFrom) / Math.max(0.01, s.dropAt - s.dropFrom)));
      // from wherever the room is now down to the peak
      dim = Math.max(s.drops > 0 ? settleDim : 0, maxDim * t * t);
    } else if (s.drops > 0) {
      const t = Math.min(1, (s.heard - s.dropAt) / SETTLE);
      dim = maxDim + (settleDim - maxDim) * t;
    }
    this.domeMaterial.opacity = dim;
    this.dome.visible = dim > 0.001;
    this.world.camera.getWorldPosition(this.at);
    this.dome.position.copy(this.at);

    if (!started) {
      rig.visible = false;
      return;
    }
    if (this.revealedAt < 0) this.revealedAt = this.time;
    const reveal = Math.min(1, (this.time - this.revealedAt) / REVEAL);
    rig.visible = true;
    this.placeRig(rigEntity, rig);

    // beat phase of the master deck, as heard
    const deck = engine.decks[s.master];
    const beats = deck.track == null ? this.time * 2 : deck.position(s.heard) / (deck.barSeconds / 4);
    const phase = beats - Math.floor(beats);
    const pulse = Math.exp(-phase * 5);
    const sinceDrop = s.drops > 0 ? s.heard - s.dropAt : Infinity;
    const flash = sinceDrop >= 0 && sinceDrop < 0.5 ? 1 - sinceDrop / 0.5 : 0;
    const view = s[s.master];
    const energy = view.section === 'drop' ? 1 : view.section === 'build' ? 0.7 : 0.45;
    // a new palette every phrase (8 bars)
    const hue = (Math.floor(beats / 32) * 0.17) % 1;

    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      const swing = beats * 0.25 * Math.PI;
      f.pan.rotation.y = Math.sin(swing + i * 0.8) * 0.9;
      f.tilt.rotation.x = 0.55 + Math.sin(swing * 0.5 + i) * 0.35 + (s.dropping ? -0.3 : 0);
      const intensity = reveal * (flash + (1 - flash) * energy * (0.35 + 0.65 * pulse));
      this.color.setHSL((hue + (i % 2) * 0.5) % 1, flash > 0 ? 0.1 : 0.85, 0.5).multiplyScalar(intensity * 1.1);
      f.beam.color.copy(this.color);
    }

    const lit = Math.min(PIXELS, Math.round(Math.sqrt(view.level) * PIXELS * 1.3 * reveal + flash * PIXELS));
    const chase = Math.floor(beats) % PIXEL_BARS;
    const pixels = this.pixels!;
    for (let j = 0; j < PIXEL_BARS; j++) {
      // the beat's bar burns brighter; colours past 1 bloom like LEDs
      this.color.setHSL((hue + j / PIXEL_BARS) % 1, 0.9, 0.55).multiplyScalar((j === chase ? 1.6 : 1) * reveal);
      for (let k = 0; k < PIXELS; k++) pixels.setColorAt(pixelIndex(j, k), PIXELS - 1 - k < lit ? this.color : this.pixelOff);
    }
    pixels.instanceColor!.needsUpdate = true;
  }

  /** Hang the ring above the console, a little beyond it, level with the floor. */
  private placeRig(entity: Entity, rig: Object3D): void {
    const consoleObject = this.consoleEntity?.object3D;
    if (consoleObject == null) return;
    consoleObject.getWorldPosition(this.at);
    // the console's forward (away from the player) projected flat
    this.forward.setFromMatrixColumn(consoleObject.matrixWorld, 2).negate();
    this.forward.y = 0;
    this.forward.normalize();
    this.at.addScaledVector(this.forward, entity.getValue(LightRig, 'beyond') ?? 0.5);
    this.at.y += entity.getValue(LightRig, 'height') ?? 0.95;
    const parent = rig.parent;
    if (parent != null) parent.worldToLocal(this.at);
    rig.position.copy(this.at);
    rig.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
  }
}
