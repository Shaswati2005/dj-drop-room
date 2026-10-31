import { BackSide, Color, CustomBlending, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, OneFactor, OneMinusSrcAlphaFactor, SphereGeometry, SrcAlphaFactor, Vector3, createSystem } from '@iwsdk/core';
import type { Entity, Object3D } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot, LightRig } from '../console-components.js';
import { game } from '../game/game-state.js';
import { CLUB_RIG, club } from '../show/club-state.js';
import { crowdState } from '../show/crowd-state.js';
import { FlashGuard } from '../show/flash-guard.js';
import { lights } from '../show/light-state.js';
import { newShowFrame, readShow } from '../show/show-clock.js';
import type { ShowFrame } from '../show/show-clock.js';
import { PIXEL_BARS, PIXEL_OFF, PIXELS, pixelIndex, RIG_HEADS } from '../scene-assets/light-rig.scene-asset.js';

/** Seconds for the rig to fade in once the first riser starts. */
const REVEAL = 1.2;
/** Seconds the room takes to settle back after a drop lands. */
const SETTLE = 3;
/** Heads lit at each hype tier (PLAN 4.4: beams 4 to 6 to 8), and the order they join in. */
const BEAMS_BY_TIER = [4, 4, 6, 8];
const BEAM_ORDER = [0, 4, 2, 6, 1, 5, 3, 7];
/** The riser dims the beams by this much by the top; the last beat before the drop goes (almost) dark. */
const RISER_DIM = 0.6;
const GAP_LEVEL = 0.08;
/** Bars of fast sweeping after a drop lands, and how much faster. */
const FAST_BARS = 2;
const FAST_SWEEP = 3;
/** Reduced-flash mode (PLAN 5.2): no beat pulse, bursts at a quarter, one sharp rise a second. */
const REDUCED_BURST = 0.25;
const REDUCED_PULSE = 0.6;

/**
 * The show that answers the DROP (PLAN 1 "the lights go down in your room"):
 * a dark translucent dome around the player dims the real room through
 * passthrough as the riser builds (to `maxDim`) and settles after the drop
 * (`settleDim`); the light rig fades in on the first riser. Its moving heads
 * sweep with the phrase (wider every bar of the 8), light up by crowd-energy
 * tier (4, 6, then 8 beams), dim 60 % over the riser, go dark on the gap beat,
 * then burst on the drop and sweep fast for two bars. The pixel bars bounce
 * with the master level and chase the beat. Everything bright goes through a
 * strobe guard (at most 3 sharp rises a second; 1 and no beat pulse in
 * reduced-flash mode). The rig is 8 draw calls; per frame the moving parts
 * are copied into instance matrices, with no allocation.
 */
export class LightShowSystem extends createSystem({
  rigs: { required: [LightRig] },
  console: { required: [ConsoleRoot] },
}) {
  private dome!: Mesh;
  private domeMaterial!: MeshBasicMaterial;
  private pans: Object3D[] = [];
  private tilts: Object3D[] = [];
  private yokes: InstancedMesh | null = null;
  private heads!: InstancedMesh;
  private lenses!: InstancedMesh;
  private beams!: InstancedMesh;
  private pixels: InstancedMesh | null = null;
  private pixelOff!: Color;
  private rigObject: Object3D | null = null;
  private rigEntity: Entity | null = null;
  private consoleEntity: Entity | null = null;
  private color!: Color;
  private at!: Vector3;
  private forward!: Vector3;
  private invRig!: Matrix4;
  private local!: Matrix4;
  private gains = new Float32Array(RIG_HEADS);
  private guard = new FlashGuard(3);
  private revealedAt = -1;
  private time = 0;
  private sweepPhase = 0;
  private sweepSpeed = 1;
  private show!: ShowFrame;
  /** times of the last four sharp rises, newest first */
  private recentSharp = new Float64Array(4).fill(-Infinity);

  init(): void {
    this.show = newShowFrame();
    this.pixelOff = new Color(PIXEL_OFF);
    this.color = new Color();
    this.at = new Vector3();
    this.forward = new Vector3();
    this.invRig = new Matrix4();
    this.local = new Matrix4();
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
    const beams = rig?.getObjectByName('Beams');
    if (rig == null || beams == null) return false;
    for (let i = 0; i < RIG_HEADS; i++) {
      this.pans.push(rig.getObjectByName(`Pan${i}`)!);
      this.tilts.push(rig.getObjectByName(`Tilt${i}`)!);
    }
    this.yokes = rig.getObjectByName('Yokes') as InstancedMesh;
    this.heads = rig.getObjectByName('Heads') as InstancedMesh;
    this.lenses = rig.getObjectByName('Lenses') as InstancedMesh;
    this.beams = beams as InstancedMesh;
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
    // in the club the rig is always up: an idle show until the first drop
    const inClub = club.on;
    const started = s.dropping || s.drops > 0 || inClub;

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
    // the room dimmer setting is a constant veil in mixed reality
    dim = Math.max(dim, game.settings.dim * 0.75);
    // the club's walls already hide the room: no veil
    if (inClub) dim = 0;
    this.domeMaterial.opacity = dim;
    this.dome.visible = dim > 0.001;
    this.world.camera.getWorldPosition(this.at);
    this.dome.position.copy(this.at);

    if (!started) {
      rig.visible = false;
      return;
    }
    if (!inClub && rig.scale.x !== 1) rig.scale.setScalar(1);
    if (this.revealedAt < 0) this.revealedAt = this.time;
    const reveal = inClub ? 1 : Math.min(1, (this.time - this.revealedAt) / REVEAL);
    rig.visible = true;
    if (inClub) this.placeRigInClub(rig);
    else this.placeRig(rigEntity, rig);

    const { beats, pulse, flash, energy, hue } = readShow(this.show, this.time);
    const view = s[s.master];
    const reduced = club.reducedFlash;
    const beatSeconds = 60 / s.bpm;

    // hype tier: how many heads are up
    const tier = crowdState.earnedTier;
    const wanted = BEAMS_BY_TIER[tier] ?? 4;
    lights.tier = tier;
    lights.beamsOn = wanted;

    // riser: beams and wash dim by 60 % as it builds, and the last beat goes dark
    let dimFactor = 1;
    if (s.dropping) {
      const t = Math.min(1, Math.max(0, (s.heard - s.dropFrom) / Math.max(0.01, s.dropAt - s.dropFrom)));
      dimFactor = 1 - RISER_DIM * t;
      const untilDrop = s.dropAt - s.heard;
      if (untilDrop < beatSeconds) dimFactor = Math.min(dimFactor, GAP_LEVEL + (1 - GAP_LEVEL) * Math.max(0, untilDrop / beatSeconds) * 0.5);
    }
    lights.dim = dimFactor;

    // the burst on the landing, capped in reduced-flash mode
    const burst = flash * (reduced ? REDUCED_BURST : 1);
    lights.burst = burst;
    if (burst > lights.burstPeak) lights.burstPeak = burst;

    // two bars of fast sweeping after the drop, easing back
    const sinceDrop = s.drops > 0 ? s.heard - s.dropAt : Infinity;
    const fast = sinceDrop >= 0 && sinceDrop < FAST_BARS * 4 * beatSeconds ? 1 - sinceDrop / (FAST_BARS * 4 * beatSeconds) : 0;
    const targetSweep = 1 + (FAST_SWEEP - 1) * fast;
    this.sweepSpeed += (targetSweep - this.sweepSpeed) * Math.min(1, delta * 4);
    lights.sweep = this.sweepSpeed;
    this.sweepPhase += delta * (s.bpm / 60) * this.sweepSpeed;
    // the sweep opens up through the 8-bar phrase
    const reach = 0.5 + 0.45 * ((view.phraseBar - 1) / 7);

    // one brightness for the whole rig, through the strobe guard
    const pulseEff = reduced ? REDUCED_PULSE : pulse;
    const raw = reveal * dimFactor * (burst + (1 - burst) * energy * (0.35 + 0.65 * pulseEff));
    const guard = this.guard;
    guard.limit = reduced ? 1 : 3;
    const before = guard.sharp;
    const master = guard.step(Math.min(1, raw), this.time);
    if (guard.sharp > before) {
      this.noteSharp(this.time);
      lights.sharpRises++;
    }
    if (master > lights.peak) lights.peak = master;

    rig.updateMatrixWorld(true);
    for (let k = 0; k < RIG_HEADS; k++) {
      const i = BEAM_ORDER[k];
      // heads join and leave with the tier: ease the gain rather than pop
      const target = k < wanted ? 1 : 0;
      this.gains[i] += (target - this.gains[i]) * Math.min(1, delta * 3);
      const swing = this.sweepPhase * 0.25 * Math.PI;
      this.pans[i].rotation.y = Math.sin(swing + i * 0.8) * reach * 1.7;
      this.tilts[i].rotation.x = 0.55 + Math.sin(swing * 0.5 + i) * 0.35 + (s.dropping ? -0.3 : 0);
      this.color.setHSL((hue + (i % 2) * 0.5) % 1, burst > 0.05 ? 0.1 : 0.85, 0.5).multiplyScalar(master * this.gains[i] * 1.1);
      this.beams.setColorAt(i, this.color);
      lights.colors[i * 3] = this.color.r;
      lights.colors[i * 3 + 1] = this.color.g;
      lights.colors[i * 3 + 2] = this.color.b;
    }
    this.beams.instanceColor!.needsUpdate = true;
    this.syncInstances(rig);

    const lit = Math.min(PIXELS, Math.round(Math.sqrt(view.level) * PIXELS * 1.3 * reveal * dimFactor + burst * PIXELS));
    const chase = Math.floor(beats) % PIXEL_BARS;
    const pixels = this.pixels!;
    for (let j = 0; j < PIXEL_BARS; j++) {
      // the beat's bar burns brighter; colours past 1 bloom like LEDs
      this.color.setHSL((hue + j / PIXEL_BARS) % 1, 0.9, 0.55).multiplyScalar((j === chase && !reduced ? 1.6 : 1) * reveal);
      for (let k = 0; k < PIXELS; k++) pixels.setColorAt(pixelIndex(j, k), PIXELS - 1 - k < lit ? this.color : this.pixelOff);
    }
    pixels.instanceColor!.needsUpdate = true;
  }

  /** Count sharp rises over any one second; more than the limit would be a violation (must never happen). */
  private noteSharp(t: number): void {
    const recent = this.recentSharp;
    for (let k = recent.length - 1; k > 0; k--) recent[k] = recent[k - 1];
    recent[0] = t;
    const limit = club.reducedFlash ? 1 : 3;
    if (t - recent[limit] < 1) lights.violations++;
  }

  /** Copy the posed pan / tilt groups into the instanced yokes, heads, lenses and beams. */
  private syncInstances(rig: Object3D): void {
    this.invRig.copy(rig.matrixWorld).invert();
    for (let i = 0; i < RIG_HEADS; i++) {
      this.local.multiplyMatrices(this.invRig, this.pans[i].matrixWorld);
      this.yokes!.setMatrixAt(i, this.local);
      this.local.multiplyMatrices(this.invRig, this.tilts[i].matrixWorld);
      this.heads.setMatrixAt(i, this.local);
      this.lenses.setMatrixAt(i, this.local);
      this.beams.setMatrixAt(i, this.local);
    }
    this.yokes!.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.lenses.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  /** In the club: the same rig, scaled up and hung over the booth, truss at CLUB_RIG.height above the floor. */
  private placeRigInClub(rig: Object3D): void {
    const consoleObject = this.consoleEntity?.object3D;
    if (consoleObject == null) return;
    consoleObject.getWorldPosition(this.at);
    this.forward.setFromMatrixColumn(consoleObject.matrixWorld, 2).negate();
    this.forward.y = 0;
    this.forward.normalize();
    this.at.y = CLUB_RIG.height;
    rig.parent?.worldToLocal(this.at);
    rig.position.copy(this.at);
    rig.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    rig.scale.setScalar(CLUB_RIG.scale);
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
