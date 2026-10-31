import {
  CanvasTexture,
  CircleGeometry,
  Color,
  createSystem,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot } from '../console-components.js';
import { ROOM, STACKS } from '../scene-assets/club.scene-asset.js';
import { club } from '../show/club-state.js';
import { residentEnergy } from '../game/comeback.js';
import { game } from '../game/game-state.js';
import { CrowdEnergy } from '../show/crowd-energy.js';
import { clubSpots, crowdState, dancerState, tableSpots, tierOf, visibleDancers } from '../show/crowd-state.js';
import type { Spot } from '../show/crowd-state.js';
import { createDancerGeometry, createDancerMaterial } from '../show/dancer.js';
import { consoleSurface } from './console-placement-system.js';

/** Dancers the mesh holds; 16 show when cold, up to 24 when on fire. */
const CAPACITY = 24;
/** Mixed reality: a miniature crowd, dancers this fraction of life size, on a floor just past the console. */
const MINI = 0.034;
const FLOOR_BEYOND = 0.4;
const FLOOR_RADIUS = 0.2;
const OUTFITS = ['#E8E1D5', '#2E3440', '#C2410C', '#0F766E', '#6D28D9', '#BE185D', '#CA8A04', '#1D4ED8'];
/** Seconds for the landing-drop jump to die away. */
const JUMP_SECONDS = 0.6;

/** The table floor: a dark disc with a glowing rim, one mesh. */
function danceFloor(): Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#29D7FF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.stroke();
  const rim = new CanvasTexture(canvas);
  rim.colorSpace = SRGBColorSpace;
  const material = new MeshStandardMaterial({ color: '#0B0D12', roughness: 0.35, metalness: 0.2, emissive: '#FFFFFF', emissiveMap: rim, emissiveIntensity: 1.2 });
  // authored at full-size metres inside the scaled root
  const floor = new Mesh(new CircleGeometry(FLOOR_RADIUS / MINI, 48), material);
  floor.name = 'CrowdFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001 / MINI;
  return floor;
}

/**
 * The crowd (PLAN 4.3): 24 stylised dancers in ONE instanced draw call, their
 * motion done in the vertex shader. Their state follows the crowd's energy
 * (the hype): idle (phones, slow sway), bobbing, dancing, hands up and
 * jumping, each dancer a little ahead or behind the others by their own mood.
 * 16 dancers are out when cold, 20 when hot, 24 on fire.
 *
 * Two contexts: in mixed reality a miniature crowd (0.034 scale) dances on a
 * floor just past the console; in club mode they stand life-size all round the
 * booth, clear of the DJ's space, the speaker stacks and the pillars. Nothing
 * is allocated per frame.
 */
export class CrowdSystem extends createSystem({
  console: { required: [ConsoleRoot] },
}) {
  readonly crowd = new CrowdEnergy();
  private root!: Group;
  private dancers!: InstancedMesh;
  private floor!: Mesh;
  private dance!: InstancedBufferAttribute;
  private uniforms = { uBeats: { value: 0 }, uEnergy: { value: 0.2 }, uJump: { value: 0 } };
  private tableLayout!: Spot[];
  private clubLayout!: Spot[];
  private applied: 'none' | 'table' | 'club' = 'none';
  private dummy!: Object3D;
  private at!: Vector3;
  private forward!: Vector3;
  private consoleEntity: Entity | null = null;
  private moods = new Float32Array(CAPACITY);

  init(): void {
    // the resident crowd: arrives at the size of your best set
    this.crowd.resident = residentEnergy(game.best);
    this.crowd.energy = this.crowd.resident;
    this.dummy = new Object3D();
    this.at = new Vector3();
    this.forward = new Vector3();
    this.root = new Group();
    this.root.name = 'Crowd';
    this.root.visible = false;
    this.tableLayout = tableSpots(CAPACITY, (FLOOR_RADIUS / MINI) * 0.9, 0.045 / MINI);
    this.clubLayout = clubSpots(
      CAPACITY,
      {
        stacks: [-1, 1].map((side) => ({ x: side * STACKS.x, z: STACKS.z })),
        stackRadius: 1.5,
        pillars: [-5.8, 5.8].flatMap((x) => [-6, -1.5, 3].map((z) => ({ x, z }))),
        pillarRadius: 1,
        halfWidth: ROOM.width / 2,
        near: ROOM.near,
        far: ROOM.far,
      },
      1,
    );
    this.dancers = new InstancedMesh(createDancerGeometry(), createDancerMaterial(this.uniforms), CAPACITY);
    this.dancers.name = 'Dancers';
    // the shader lifts and swings the figures: never cull on the rest-pose bounds
    this.dancers.frustumCulled = false;
    this.dance = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    this.dancers.geometry.setAttribute('aDance', this.dance);
    const color = new Color();
    for (let i = 0; i < CAPACITY; i++) this.dancers.setColorAt(i, color.set(OUTFITS[i % OUTFITS.length]));
    this.floor = danceFloor();
    this.root.add(this.floor, this.dancers);
    this.world.createTransformEntity(this.root, { persistent: true });
    crowdState.capacity = CAPACITY;
  }

  /** Write the per-dancer matrices and shader attributes for a context. */
  private layout(context: 'table' | 'club'): void {
    const spots = context === 'club' ? this.clubLayout : this.tableLayout;
    const d = this.dummy;
    for (let i = 0; i < CAPACITY; i++) {
      const spot = spots[i % spots.length];
      d.position.set(spot.x, 0, spot.z);
      // face the booth (club) or the console (table: toward +Z of the crowd root)
      d.rotation.set(0, context === 'club' ? Math.atan2(-spot.x, -spot.z) : 0, 0);
      d.scale.setScalar(spot.height);
      d.updateMatrix();
      this.dancers.setMatrixAt(i, d.matrix);
      this.dance.setXYZW(i, spot.phase, spot.mood, (i * 0.37) % 1, ((i * 7) % 10) / 10);
      this.moods[i] = spot.mood;
    }
    this.dancers.instanceMatrix.needsUpdate = true;
    this.dancers.instanceColor!.needsUpdate = true;
    this.dance.needsUpdate = true;
    this.floor.visible = context === 'table';
    this.applied = context;
  }

  update(delta: number): void {
    const engine = liveEngine();
    const s = engine.state;
    const musicEnergy = this.crowd.update(s, delta);
    const energy = crowdState.force ?? musicEnergy;
    crowdState.energy = energy;
    crowdState.tier = tierOf(energy);
    crowdState.earnedTier = crowdState.force == null ? tierOf(this.crowd.earned) : crowdState.tier;
    if (!s.running && crowdState.force == null) {
      this.root.visible = false;
      crowdState.context = 'none';
      crowdState.instances = 0;
      crowdState.drawCalls = 0;
      return;
    }
    if (this.consoleEntity == null) for (const entity of this.queries.console.entities) this.consoleEntity = entity;
    const consoleObject = this.consoleEntity?.object3D;
    if (consoleObject == null) return;

    const inClub = club.on;
    const context = inClub ? 'club' : 'table';
    if (this.applied !== context) this.layout(context);
    this.root.visible = true;

    // table: stand on the console's surface, beyond it, turned to face the DJ.
    // club: the floor under the booth, placed the way the club room is.
    consoleObject.getWorldPosition(this.at);
    this.forward.setFromMatrixColumn(consoleObject.matrixWorld, 2).negate();
    this.forward.y = 0;
    this.forward.normalize();
    if (inClub) {
      this.at.y = 0;
      this.root.scale.setScalar(1);
    } else {
      this.at.addScaledVector(this.forward, FLOOR_BEYOND);
      this.at.y = consoleSurface.placement === 'table' ? consoleSurface.y : this.at.y;
      this.root.scale.setScalar(MINI);
    }
    if (this.root.parent != null) this.root.parent.worldToLocal(this.at);
    this.root.position.copy(this.at);
    this.root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);

    const deck = engine.decks[s.master];
    const beats = deck.track == null ? 0 : deck.position(s.heard) / (deck.barSeconds / 4);
    const sinceDrop = s.drops > 0 ? s.heard - s.dropAt : Infinity;
    const jump = sinceDrop >= 0 && sinceDrop < JUMP_SECONDS ? Math.sin((sinceDrop / JUMP_SECONDS) * Math.PI) : 0;
    this.uniforms.uBeats.value = beats;
    this.uniforms.uEnergy.value = energy;
    this.uniforms.uJump.value = jump;

    const count = visibleDancers(crowdState.tier, CAPACITY);
    this.dancers.count = count;
    const counts = crowdState.counts;
    counts[0] = counts[1] = counts[2] = counts[3] = 0;
    for (let i = 0; i < count; i++) counts[dancerState(energy, this.moods[i])]++;
    crowdState.context = context;
    crowdState.instances = count;
    crowdState.jump = jump;
    crowdState.drawCalls = inClub ? 1 : 2;
  }
}
