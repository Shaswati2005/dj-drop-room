import { Color, createSystem } from '@iwsdk/core';
import type { InstancedMesh } from '@iwsdk/core';
import { liveEngine } from '../audio/live.js';
import { ConsoleRoot } from '../console-components.js';
import { LED_OFF } from '../scene-assets/console-body.scene-asset.js';

const SEGMENTS = 12;
/** The bottom segment lights at -36 dB, each one above it 3 dB louder. */
const FLOOR_DB = -36;
const STEP_DB = 3;

/** Lights the console's LED meters (channel A, channel B, master L/R) from
 * the engine's levels: green, then yellow from -9 dB, red from -3 dB. Each
 * column is one instanced mesh; a segment's colour is its instance colour. */
export class MeterSystem extends createSystem({
  console: { required: [ConsoleRoot] },
}) {
  private columns!: { leds: InstancedMesh; source: 'A' | 'B' | 'master'; shown: number }[];
  private lit!: Color[];
  private off!: Color;

  init(): void {
    this.columns = [];
    const green = new Color('#3DFF6E');
    const yellow = new Color('#FFD21F');
    const red = new Color('#FF3B3B');
    this.lit = Array.from({ length: SEGMENTS }, (_, i) => (i >= 11 ? red : i >= 9 ? yellow : green));
    this.off = new Color(LED_OFF);
  }

  // the console body loads after the entity qualifies: collect columns lazily
  private collect(root: { getObjectByName(name: string): unknown }): void {
    const sources = [
      ['MeterA', 'A'],
      ['MeterB', 'B'],
      ['MasterL', 'master'],
      ['MasterR', 'master'],
    ] as const;
    for (const [prefix, source] of sources) {
      const leds = root.getObjectByName(`${prefix}Leds`) as InstancedMesh | undefined;
      if (leds == null) return;
      this.columns.push({ leds, source, shown: -1 });
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
      // upload only when the lit count changes
      if (count === column.shown) continue;
      column.shown = count;
      for (let i = 0; i < SEGMENTS; i++) column.leds.setColorAt(i, i < count ? this.lit[i] : this.off);
      column.leds.instanceColor!.needsUpdate = true;
    }
  }
}
