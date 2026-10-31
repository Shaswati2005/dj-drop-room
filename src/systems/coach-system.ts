import { CanvasTexture, createSystem, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, TorusGeometry, Vector3 } from '@iwsdk/core';
import type { Entity, Object3D } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import type { EngineState } from '../audio/engine.js';
import { game } from '../game/game-state.js';
import { Knob, PerfPad, PushButton } from '../console-components.js';

interface Step {
  /** the control the ring goes round (entity name) */
  target: string;
  /** a few words, no reading required beyond that (PLAN §5.1) */
  label: string;
  done: (s: EngineState) => boolean;
}

/** The first five minutes (PLAN §5.1, adapted to the decks): start, take the
 * bass out and back, bring in deck B, mix to it, drop. */
const STEPS: Step[] = [
  { target: 'Start Pad', label: 'TAP TO START', done: (s) => s.running },
  { target: 'Pad A Bass', label: 'TAP: BASS OUT', done: (s) => s.A.stems[1] === 0 },
  { target: 'Pad A Bass', label: 'TAP: BASS BACK', done: (s) => s.A.stems[1] === 1 },
  { target: 'Play B', label: 'START DECK B', done: (s) => s.B.playing },
  { target: 'Xf End B', label: 'TAP B: MIX IT IN', done: (s) => s.fadingTo === 'B' || s.crossfader > 0.9 },
  { target: 'Drop', label: 'HIT IT', done: (s) => s.drops > 0 || s.dropping },
];
const STORAGE_KEY = 'dropRoom.coached';
const W = 512;
const H = 96;
/** Seconds each tip stays up when HELP replays the tour. */
const TOUR_SECONDS = 3.5;

/**
 * Coach rings: a pulsing ring round the next control to try, with a short
 * label above it. Steps advance when the engine shows they happened (in any
 * order: a step already done is skipped). A player who finished once is not
 * coached again.
 */
export class CoachSystem extends createSystem({
  buttons: { required: [PushButton] },
  pads: { required: [PerfPad] },
  knobs: { required: [Knob] },
}) {
  /** index of the current step; STEPS.length when coaching is over */
  step = 0;
  private ring!: Mesh;
  private ringMaterial!: MeshBasicMaterial;
  private label!: Mesh;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private target: Object3D | undefined;
  private at!: Vector3;
  private up!: Vector3;
  private turn!: Quaternion;
  private time = 0;
  private tourId = 0;
  private tourStart = -1;
  private tipId = 0;
  private tipUntil = 0;
  private drawnLabel = '';
  private targetName = '';
  /** what is shown now, for tests: '' when nothing */
  shown = '';

  init(): void {
    this.at = new Vector3();
    this.up = new Vector3();
    this.turn = new Quaternion();
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') this.step = STEPS.length;
    } catch {
      // storage blocked: coach every time
    }
    this.ringMaterial = new MeshBasicMaterial({ color: '#29D7FF', transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
    this.ring = new Mesh(new TorusGeometry(0.03, 0.0025, 8, 48), this.ringMaterial);
    this.ring.name = 'CoachRing';
    this.ring.renderOrder = 998;
    this.ring.visible = false;
    this.world.createTransformEntity(this.ring, { persistent: true });
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.label = new Mesh(new PlaneGeometry(0.15, 0.028), new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, toneMapped: false }));
    this.label.name = 'CoachLabel';
    this.label.renderOrder = 998;
    this.label.visible = false;
    this.world.createTransformEntity(this.label, { persistent: true });
  }

  /** Skip coaching (and remember it), e.g. from settings. */
  finish(): void {
    this.step = STEPS.length;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // storage blocked: nothing to remember
    }
  }

  update(delta: number): void {
    this.time += delta;
    const s = liveEngine().state;
    // first-five-minutes coaching advances as the engine shows each step happened
    if (this.step < STEPS.length) {
      while (this.step < STEPS.length && STEPS[this.step].done(s)) this.step++;
      if (this.step >= STEPS.length) this.finish();
    }
    // HELP replays the tips one after another (not the Start pad: it is gone by then)
    if (game.tour.id !== this.tourId) {
      this.tourId = game.tour.id;
      this.tourStart = this.time;
    }
    // the second-wave and idle tips
    if (game.tip.id !== this.tipId) {
      this.tipId = game.tip.id;
      this.tipUntil = this.time + game.tip.seconds;
    }
    let name = '';
    let label = '';
    if (this.tourStart >= 0) {
      const i = 1 + Math.floor((this.time - this.tourStart) / TOUR_SECONDS);
      if (i < STEPS.length) {
        name = STEPS[i].target;
        label = STEPS[i].label;
      } else this.tourStart = -1;
    }
    if (name === '' && this.step >= STEPS.length && this.time < this.tipUntil) {
      name = game.tip.target;
      label = game.tip.label;
    }
    if (name === '' && this.step < STEPS.length) {
      name = STEPS[this.step].target;
      label = STEPS[this.step].label;
    }
    this.shown = label;
    if (name === '' || game.finished) {
      this.ring.visible = this.label.visible = false;
      return;
    }
    // resolve the control once per tip (retried until its asset is in)
    if (this.targetName !== name || this.target == null) {
      this.target = this.find(name);
      this.targetName = name;
    }
    const target = this.target;
    if (target == null || target.parent == null) {
      this.ring.visible = this.label.visible = false;
      return;
    }
    if (this.drawnLabel !== label) this.draw(label);

    // ring flat on the console round the control, pulsing
    target.getWorldPosition(this.at);
    target.parent.getWorldQuaternion(this.turn);
    this.up.setFromMatrixColumn(target.parent.matrixWorld, 1).normalize();
    this.at.addScaledVector(this.up, 0.012);
    this.place(this.ring, this.at);
    this.ring.quaternion.copy(this.turn);
    this.ring.rotateX(Math.PI / 2);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    this.ring.scale.setScalar(target.name === 'Drop' || target.name === 'Start Pad' ? 1.9 + pulse * 0.2 : 1 + pulse * 0.15);
    this.ringMaterial.opacity = 0.55 + 0.45 * pulse;
    this.ring.visible = true;

    // label above, facing the head
    this.at.addScaledVector(this.up, 0.075);
    this.place(this.label, this.at);
    this.world.camera.getWorldQuaternion(this.label.quaternion);
    this.label.visible = true;
  }

  private find(name: string): Object3D | undefined {
    for (const query of [this.queries.buttons, this.queries.pads, this.queries.knobs])
      for (const entity of query.entities as Set<Entity>) if (entity.object3D?.name === name) return entity.object3D;
    return undefined;
  }

  private place(object: Object3D, world: Vector3): void {
    object.position.copy(world);
    if (object.parent != null) object.parent.worldToLocal(object.position);
  }

  private draw(text: string): void {
    this.drawnLabel = text;
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(41, 215, 255, 0.92)';
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 40);
    ctx.fill();
    ctx.fillStyle = '#04070C';
    ctx.font = 'bold 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, 66, W - 40);
    this.texture.needsUpdate = true;
  }
}
