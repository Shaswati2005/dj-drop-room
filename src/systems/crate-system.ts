import { CanvasTexture, createSystem, MeshBasicMaterial, SRGBColorSpace } from '@iwsdk/core';
import type { Mesh } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import type { CrateSlot, EngineState } from '../audio/engine.js';
import { ConsoleRoot } from '../console-components.js';
import { notice } from '../share.js';

const SLOT = { w: 352, h: 80 };
const STATUS = { w: 288, h: 86 };
const DECK_COLORS = { A: '#29D7FF', B: '#FF3DA8' };
const GREEN = '#3DFF6E';

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
    const meshes = [0, 1, 2, 3].map((i) => root.getObjectByName(`CrateScreen${i}`) as Mesh | undefined);
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
    const key = `${slot.onA}${slot.onB}${slot.match}`;
    if (key === face.key) return;
    face.key = key;
    const { ctx, w, h } = face;
    ctx.fillStyle = '#04070C';
    ctx.fillRect(0, 0, w, h);
    if (slot.match) {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(slot.name.toUpperCase(), 12, 33);
    // which deck holds it
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    let x = w - 22;
    for (const [id, on] of [['B', slot.onB], ['A', slot.onA]] as const) {
      if (!on) continue;
      ctx.fillStyle = DECK_COLORS[id];
      ctx.fillRect(x - 15, 9, 30, 30);
      ctx.fillStyle = '#04070C';
      ctx.fillText(id, x, 32);
      x -= 36;
    }
    ctx.textAlign = 'left';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#C9D1DC';
    ctx.fillText(`${slot.bpm} BPM`, 12, 69);
    // Camelot key badge: green when the track mixes with the playing deck
    const bw = 84;
    ctx.fillStyle = slot.match ? GREEN : '#2A3344';
    ctx.fillRect(w - bw - 12, 44, bw, 30);
    ctx.fillStyle = slot.match ? '#04120A' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(slot.key, w - bw / 2 - 12, 68);
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
