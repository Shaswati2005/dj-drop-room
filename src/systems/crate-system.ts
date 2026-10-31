import { CanvasTexture, createSystem, MeshBasicMaterial, SRGBColorSpace } from '@iwsdk/core';
import type { Mesh } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import type { CrateSlot, EngineState } from '../audio/engine.js';
import { ConsoleRoot } from '../console-components.js';
import { notice } from '../share.js';

const SLOT = { w: 260, h: 84 };
const STATUS = { w: 288, h: 86 };
const DECK_COLORS = { A: '#29D7FF', B: '#FF3DA8' };
const GREEN = '#3DFF6E';
const AMBER = '#FFB020';
const GREY = '#7B8494';
const BADGE_COLORS = { green: GREEN, amber: AMBER, grey: GREY };

interface Face {
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  w: number;
  h: number;
  /** what was drawn last; redrawn only when this changes */
  key: string;
}

/**
 * The crate shelf's screens (PLAN-DJ-UPGRADE day 9): per track its name, BPM
 * and Camelot key, which deck holds it, and a green frame when it mixes with
 * the playing deck (key within one step of the wheel, tempo within 6 %). The
 * middle screen shows REC time, "pause the deck first" refusals and SHARE
 * messages. Redrawn only when something on a screen changes.
 */
export class CrateSystem extends createSystem({
  console: { required: [ConsoleRoot] },
}) {
  private slots!: Face[];
  private status: Face | null = null;
  private since = 0;

  init(): void {
    this.slots = [];
  }

  private face(mesh: Mesh, w: number, h: number): Face {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    mesh.material = new MeshBasicMaterial({ map: texture, toneMapped: false });
    return { ctx: canvas.getContext('2d')!, texture, w, h, key: '' };
  }

  private attach(root: { getObjectByName(name: string): unknown }): void {
    const meshes = [0, 1, 2, 3, 4, 5].map((i) => root.getObjectByName(`CrateScreen${i}`) as Mesh | undefined);
    const status = root.getObjectByName('CrateStatus') as Mesh | undefined;
    if (meshes.some((m) => m == null) || status == null) return;
    this.slots = meshes.map((m) => this.face(m!, SLOT.w, SLOT.h));
    this.status = this.face(status, STATUS.w, STATUS.h);
  }

  update(delta: number): void {
    if (this.slots.length === 0) {
      for (const entity of this.queries.console.entities) if (entity.object3D != null) this.attach(entity.object3D);
      if (this.slots.length === 0) return;
    }
    // text only changes now and then
    this.since += delta;
    if (this.since < 0.1) return;
    this.since = 0;
    const engine = liveEngine();
    const crate = engine.crate();
    for (let i = 0; i < crate.length; i++) this.drawSlot(this.slots[i], crate[i]);
    this.drawStatus(this.status!, engine.state);
  }

  private drawSlot(face: Face, slot: CrateSlot): void {
    const key = `${slot.onA}${slot.onB}${slot.badge}${slot.ratio}`;
    if (key === face.key) return;
    face.key = key;
    const { ctx, w, h } = face;
    const badge = slot.badge === '' ? null : BADGE_COLORS[slot.badge];
    ctx.fillStyle = '#04070C';
    ctx.fillRect(0, 0, w, h);
    if (badge != null) {
      ctx.strokeStyle = badge;
      ctx.lineWidth = 5;
      ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = 'bold 23px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(slot.name.toUpperCase(), 10, 29);
    // which deck holds it
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    let x = w - 20;
    for (const [id, on] of [['B', slot.onB], ['A', slot.onA]] as const) {
      if (!on) continue;
      ctx.fillStyle = DECK_COLORS[id];
      ctx.fillRect(x - 11, 33, 22, 22);
      ctx.fillStyle = '#04070C';
      ctx.fillText(id, x, 50);
      x -= 28;
    }
    ctx.textAlign = 'left';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#C9D1DC';
    ctx.fillText(`${slot.bpm}`, 10, 74);
    // double / half time over the playing deck (Airlock over Rainy Tape): a tag next to the BPM
    if (slot.ratio !== '') {
      const label = slot.ratio === '2x' ? '2×' : '½×';
      ctx.fillStyle = AMBER;
      ctx.fillRect(58, 56, 44, 24);
      ctx.fillStyle = '#04120A';
      ctx.textAlign = 'center';
      ctx.fillText(label, 80, 74);
    }
    // Camelot key badge: green / amber / grey against the playing deck
    const bw = 60;
    ctx.fillStyle = badge ?? '#2A3344';
    ctx.fillRect(w - bw - 10, 58, bw, 22);
    ctx.fillStyle = badge != null ? '#04120A' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(slot.key, w - bw / 2 - 10, 76);
    face.texture.needsUpdate = true;
  }

  private drawStatus(face: Face, s: EngineState): void {
    let line1: string;
    let line2 = '';
    let color: string;
    if (s.heard - s.refusedAt < 2) {
      line1 = `PAUSE DECK ${s.refusedDeck} FIRST`;
      color = '#FFB020';
    } else if (s.recording) {
      const t = Math.floor(s.recSeconds);
      line1 = `REC ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      color = '#FF4D4D';
    } else if (performance.now() - notice.at < 4000) {
      line1 = notice.text.slice(0, 22).toUpperCase();
      color = GREEN;
    } else if (s.takes > 0) {
      line1 = 'TAKE READY';
      line2 = 'SAVE IT ON THE PAGE';
      color = GREEN;
    } else {
      line1 = 'REC   SHARE';
      line2 = 'RECORD / COPY LINK';
      color = '#6B7587';
    }
    const key = `${line1}|${line2}|${color}`;
    if (key === face.key) return;
    face.key = key;
    const { ctx, w, h } = face;
    ctx.fillStyle = '#04070C';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = `bold ${line1.length > 14 ? 24 : 32}px sans-serif`;
    ctx.fillText(line1, w / 2, line2 ? 38 : 54);
    if (line2) {
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#6B7587';
      ctx.fillText(line2, w / 2, 68);
    }
    face.texture.needsUpdate = true;
  }
}
