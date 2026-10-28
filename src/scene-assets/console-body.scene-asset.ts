import { BoxGeometry, Color, CylinderGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D as Spot, PlaneGeometry, TorusGeometry } from '@iwsdk/core';
import type { Material, Object3D } from '@iwsdk/core';
import { BODY, DECK, deckX, MIXER, MIXER_HALF, STRIP_X } from './console-layout.js';
import { DECK_COLORS, glow, materials } from './console-materials.js';
import { bevelBox } from './lib/hardsurface.js';

/**
 * The console body (static): chassis, deck and mixer faceplates, jog wells,
 * display screens, fader slots with scale ticks, and LED meter columns
 * Meter{A,B}Leds and Master{L,R}Leds, instanced meshes whose instance i
 * (0 = bottom) the meter system colours. Interactive controls are separate assets placed on top.
 */
const T = BODY.top;

function mesh(name: string, geometry: Mesh['geometry'], material: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  m.position.set(x, y, z);
  return m;
}

function slot(name: string, x: number, z: number, along: 'x' | 'z', length: number): Object3D {
  const g = new Group();
  g.name = name;
  const w = along === 'x' ? length : 0.005;
  const d = along === 'x' ? 0.005 : length;
  g.add(mesh(`${name}-slot`, new BoxGeometry(w, 0.0012, d), materials.slot, x, T + 0.0021, z));
  // five scale ticks beside the slot, one instanced draw
  const ticks = new InstancedMesh(along === 'x' ? new BoxGeometry(0.0008, 0.0006, 0.004) : new BoxGeometry(0.004, 0.0006, 0.0008), materials.tick, 5);
  ticks.name = `${name}-ticks`;
  const spot = new Spot();
  for (let i = 0; i < 5; i++) {
    const f = -0.5 + i / 4;
    if (along === 'x') spot.position.set(x + f * length * 0.9, T + 0.0018, z - 0.011);
    else spot.position.set(x - 0.011, T + 0.0018, z + f * length * 0.9);
    spot.updateMatrix();
    ticks.setMatrixAt(i, spot.matrix);
  }
  g.add(ticks);
  return g;
}

/** Unlit LED colour; the meter system colours lit segments per instance. */
export const LED_OFF = '#16181A';
const ledMaterial = new MeshBasicMaterial({ color: '#FFFFFF', toneMapped: false });

function meter(prefix: string, x: number, z0: number, z1: number, count: number): Object3D {
  const g = new Group();
  g.name = `${prefix}Meter`;
  const leds = new InstancedMesh(new BoxGeometry(0.006, 0.0014, (Math.abs(z1 - z0) / count) * 0.7), ledMaterial, count);
  leds.name = `${prefix}Leds`;
  const spot = new Spot();
  const off = new Color(LED_OFF);
  for (let i = 0; i < count; i++) {
    spot.position.set(x, T + 0.0022, z0 + ((z1 - z0) * (i + 0.5)) / count);
    spot.updateMatrix();
    leds.setMatrixAt(i, spot.matrix);
    leds.setColorAt(i, off);
  }
  g.add(leds);
  return g;
}

function deck(id: 'A' | 'B'): Object3D {
  const g = new Group();
  g.name = `Deck${id}`;
  const cx = deckX(-0.2075, id);
  g.add(mesh(`Deck${id}Plate`, bevelBox(0.195, 0.0016, 0.3, 0.0006), materials.deckPlate, cx, T + 0.0008, 0));
  const jx = deckX(DECK.jog.x, id);
  const well = mesh(`Deck${id}JogWell`, new TorusGeometry(DECK.jog.radius + 0.004, 0.0028, 10, 64), materials.darkMetal, jx, T + 0.0016, DECK.jog.z);
  well.rotation.x = -Math.PI / 2;
  g.add(well);
  g.add(mesh(`Display${id}`, bevelBox(DECK.display.width, 0.003, DECK.display.depth, 0.001), materials.screen, deckX(DECK.display.x, id), T + 0.0025, DECK.display.z));
  // flat screen face with clean UVs for the waveform texture (DisplaySystem)
  const screen = mesh(`DisplayScreen${id}`, new PlaneGeometry(DECK.display.width - 0.006, DECK.display.depth - 0.005), materials.screen, deckX(DECK.display.x, id), T + 0.0042, DECK.display.z);
  screen.rotation.x = -Math.PI / 2;
  g.add(screen);
  g.add(slot(`Tempo${id}`, deckX(DECK.tempo.x, id), DECK.tempo.z, 'z', DECK.tempo.length));
  // deck colour accent along the front edge
  g.add(mesh(`Deck${id}Accent`, new BoxGeometry(0.17, 0.004, 0.003), glow(DECK_COLORS[id], 1.4), cx, T * 0.55, BODY.depth / 2 + 0.0004));
  return g;
}

function mixer(): Object3D {
  const g = new Group();
  g.name = 'Mixer';
  g.add(mesh('MixerPlate', bevelBox(MIXER_HALF * 2 - 0.006, 0.0016, 0.3, 0.0006), materials.mixerPlate, 0, T + 0.0008, 0));
  for (const id of ['A', 'B'] as const) {
    const x = id === 'A' ? -STRIP_X : STRIP_X;
    g.add(slot(`Channel${id}`, x, MIXER.fader.z, 'z', MIXER.fader.length));
    const mx = id === 'A' ? -MIXER.meter.x : MIXER.meter.x;
    g.add(meter(`Meter${id}`, mx, MIXER.meter.z0, MIXER.meter.z1, MIXER.meter.segments));
  }
  g.add(meter('MasterL', MIXER.master.xs[0], MIXER.master.z0, MIXER.master.z1, MIXER.meter.segments));
  g.add(meter('MasterR', MIXER.master.xs[1], MIXER.master.z0, MIXER.master.z1, MIXER.meter.segments));
  g.add(slot('Crossfader', 0, MIXER.crossfader.z, 'x', MIXER.crossfader.length));
  return g;
}

export function createConsoleBody(): Group {
  const root = new Group();
  root.name = 'ConsoleBody';
  // the chassis rests on 3 mm feet; its top is exactly T
  const chassis = mesh('Chassis', bevelBox(BODY.width, T - 0.003, BODY.depth, 0.006, 0.018, 4), materials.body, 0, 0.003 + (T - 0.003) / 2, 0);
  root.add(chassis, deck('A'), deck('B'), mixer());
  const foot = new CylinderGeometry(0.012, 0.012, 0.003, 16);
  for (const [x, z] of [[-0.27, -0.13], [0.27, -0.13], [-0.27, 0.13], [0.27, 0.13]]) {
    root.add(mesh('Foot', foot, materials.rubber, x, 0.0015, z));
  }
  return root;
}
