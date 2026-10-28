import { CanvasTexture, createSystem, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import type { DeckId } from '../audio/deck.js';
import { Fader, JogWheel, Knob, PerfPad, PushButton } from '../console-components.js';
import { hintFor } from '../hints.js';
import { readFingertip } from './fingertip.js';

const W = 512;
const H = 128;
/** A fingertip this close (m) sideways to a control's centre hovers it; jogs are big. */
const REACH = 0.02;
const JOG_REACH = 0.055;
/** ...and at most this high (m) above the control's base. */
const ABOVE = 0.08;
/** Hover this long (s) before the label shows, so passing hands don't flash it. */
const DWELL = 0.25;
/** Keep the label this long (s) after the finger leaves. */
const LINGER = 0.4;
/** Label height above the control (m). */
const LIFT = 0.055;

/**
 * Beginner hints: when an index fingertip hovers over a console control, a
 * small label floats above it with the control's name and how to use it. Pad
 * labels follow the deck's pad mode.
 */
export class HintSystem extends createSystem({
  buttons: { required: [PushButton] },
  pads: { required: [PerfPad] },
  knobs: { required: [Knob] },
  faders: { required: [Fader] },
  jogs: { required: [JogWheel] },
}) {
  private label!: Mesh;
  private hoverable!: (typeof this.queries.buttons)[];
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private finger!: Vector3;
  private at!: Vector3;
  private up!: Vector3;
  private headTurn!: Quaternion;
  private hovered: Entity | null = null;
  private hoverTime = 0;
  private shown: Entity | null = null;
  private shownKey = '';
  private sinceLeft = 0;

  init(): void {
    this.hoverable = [this.queries.buttons, this.queries.pads, this.queries.knobs, this.queries.faders, this.queries.jogs];
    this.finger = new Vector3();
    this.at = new Vector3();
    this.up = new Vector3();
    this.headTurn = new Quaternion();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, toneMapped: false });
    this.label = new Mesh(new PlaneGeometry(0.18, 0.045), material);
    this.label.name = 'HintLabel';
    // drawn over the console so the hovering hand never hides it
    this.label.renderOrder = 999;
    this.label.visible = false;
    this.world.createTransformEntity(this.label, { persistent: true });
  }

  update(delta: number): void {
    const near = this.nearest();
    if (near !== this.hovered) {
      this.hovered = near;
      this.hoverTime = 0;
    } else this.hoverTime += delta;

    if (near != null && this.hoverTime >= DWELL) {
      this.shown = near;
      this.sinceLeft = 0;
    } else if (near == null || near !== this.shown) {
      this.sinceLeft += delta;
      if (this.sinceLeft > LINGER) this.shown = null;
    }

    const shown = this.shown;
    if (shown == null || shown.object3D == null || !this.draw(shown)) {
      this.label.visible = false;
      return;
    }
    const object = shown.object3D;
    object.getWorldPosition(this.at);
    // lift along the console's up axis, then face the head
    if (object.parent != null) this.up.setFromMatrixColumn(object.parent.matrixWorld, 1).normalize();
    this.at.addScaledVector(this.up, LIFT);
    const parent = this.label.parent;
    if (parent != null) parent.worldToLocal(this.at);
    this.label.position.copy(this.at);
    this.world.camera.getWorldQuaternion(this.headTurn);
    this.label.quaternion.copy(this.headTurn);
    this.label.visible = true;
  }

  /** The control nearest either fingertip, measured sideways in the
   * console's plane, with the finger hovering above it. */
  private nearest(): Entity | null {
    let best: Entity | null = null;
    let bestDistance = Infinity;
    for (const hand of ['left', 'right'] as const) {
      if (!readFingertip(this.world.renderer, this.player, hand, this.finger)) continue;
      for (const query of this.hoverable) {
        const jog = query === this.queries.jogs;
        for (const entity of query.entities) {
          if (entity.object3D == null || !entity.object3D.visible) continue;
          const parent = entity.object3D.parent;
          if (parent == null) continue;
          entity.object3D.getWorldPosition(this.at);
          this.up.setFromMatrixColumn(parent.matrixWorld, 1).normalize();
          this.at.subVectors(this.finger, this.at);
          const height = this.at.dot(this.up);
          if (height < -0.01 || height > ABOVE) continue;
          const d = this.at.addScaledVector(this.up, -height).length();
          // a jog counts as hovered anywhere over its platter, but loses to the
          // smaller controls around it
          const score = jog ? d + REACH : d;
          if (d < (jog ? JOG_REACH : REACH) && score < bestDistance) {
            bestDistance = score;
            best = entity;
          }
        }
      }
    }
    return best;
  }

  /** Redraws the label when the control or its pad mode changes; false when
   * the control has no hint. */
  private draw(entity: Entity): boolean {
    const name = entity.object3D?.name ?? '';
    const isPad = entity.hasComponent(PerfPad);
    const deck = (isPad ? entity.getValue(PerfPad, 'deck') : 'A') as DeckId;
    const padMode = liveEngine().state[deck].padMode;
    const key = isPad ? `${entity.index}:${padMode}` : `${entity.index}`;
    if (key === this.shownKey) return true;
    const hint = hintFor(name, padMode, isPad ? (entity.getValue(PerfPad, 'slot') ?? 0) : 0);
    if (hint == null) return false;
    this.shownKey = key;
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6, 9, 14, 0.88)';
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(41, 215, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(hint.title, W / 2, 54);
    ctx.fillStyle = '#B8C4D4';
    ctx.font = '30px sans-serif';
    ctx.fillText(hint.body, W / 2, 100, W - 32);
    this.texture.needsUpdate = true;
    return true;
  }
}
