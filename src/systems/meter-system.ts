import { createSystem, MeshStandardMaterial } from '@iwsdk/core';
import type { Material, Mesh } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot } from '../console-components.js';

const SEGMENTS = 12;
/** The bottom segment lights at -36 dB, each one above it 3 dB louder. */
const FLOOR_DB = -36;
const STEP_DB = 3;

/** Lights the console's LED meters (channel A, channel B, master L/R) from
 * the engine's levels: green, then yellow from -9 dB, red from -3 dB. */
export class MeterSystem extends createSystem({
  console: { required: [ConsoleRoot] },
}) {
  private columns!: { meshes: Mesh[]; off: Material; source: 'A' | 'B' | 'master' }[];
  private lit!: MeshStandardMaterial[];

  init(): void {
    this.columns = [];
    const lamp = (hex: string) => new MeshStandardMaterial({ color: '#111111', emissive: hex, emissiveIntensity: 1.6, roughness: 0.4 });
    const green = lamp('#3DFF6E');
    const yellow = lamp('#FFD21F');
    const red = lamp('#FF3B3B');
    this.lit = Array.from({ length: SEGMENTS }, (_, i) => (i >= 11 ? red : i >= 9 ? yellow : green));
  }

  // the console body loads after the entity qualifies: collect segments lazily
  private collect(root: { getObjectByName(name: string): unknown }): void {
    const sources = [
      ['MeterA', 'A'],
      ['MeterB', 'B'],
      ['MasterL', 'master'],
      ['MasterR', 'master'],
    ] as const;
    for (const [prefix, source] of sources) {
      const meshes: Mesh[] = [];
      for (let i = 0; i < SEGMENTS; i++) {
        const mesh = root.getObjectByName(`${prefix}_${i}`) as Mesh | undefined;
        if (mesh == null) return;
        meshes.push(mesh);
      }
      this.columns.push({ meshes, off: meshes[0].material as Material, source });
    }
  }

  update(): void {
    if (this.columns.length === 0) {
      for (const entity of this.queries.console.entities) if (entity.object3D != null) this.collect(entity.object3D);
      if (this.columns.length === 0) return;
    }
    const s = liveEngine().state;
    for (const column of this.columns) {
      const level = column.source === 'master' ? s.level : s[column.source].level;
      const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
      const count = Math.max(0, Math.min(SEGMENTS, Math.floor((db - FLOOR_DB) / STEP_DB) + 1));
      for (let i = 0; i < SEGMENTS; i++) column.meshes[i].material = i < count ? this.lit[i] : column.off;
    }
  }
}
