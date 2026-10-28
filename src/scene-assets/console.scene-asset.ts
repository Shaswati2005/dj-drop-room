import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { bevelBox } from './lib/hardsurface.js';

/**
 * Console geometry (PLAN §2.1). Origin at the bottom centre, +Z toward the
 * player, top surface at TOP. The two deck wings hinge 15° toward the player
 * so every pad stays inside a two-foot reach; total width ≤ 64 cm. The scene
 * places the deck groups with the same WING_* numbers.
 */
export const TOP = 0.03;
export const CENTRE_WIDTH = 0.24;
export const WING_WIDTH = 0.205;
export const WING_ANGLE = (15 * Math.PI) / 180;
export const DECK_COLORS = { A: '#29D7FF', B: '#FF3DA8' };
export const STEM_COLORS = { drums: '#FF7A2E', bass: '#2E8BFF', chords: '#A65CFF', melody: '#2EFFB0' };

const body = () => new MeshStandardMaterial({ color: '#1B1D24', roughness: 0.55, metalness: 0.2 });
const bezel = () => new MeshStandardMaterial({ color: '#0E0F13', roughness: 0.8 });
const glow = (hex: string, intensity = 1) =>
  new MeshStandardMaterial({ color: '#111111', emissive: hex, emissiveIntensity: intensity, roughness: 0.4 });
const iconMaterial = () =>
  new MeshStandardMaterial({ color: '#FFFFFF', emissive: '#FFFFFF', emissiveIntensity: 0.6, roughness: 0.5 });

function named<T extends Object3D>(object: T, name: string): T {
  object.name = name;
  return object;
}

function wing(side: -1 | 1, accent: string): Group {
  const group = named(new Group(), side < 0 ? 'WingA' : 'WingB');
  const slab = named(new Mesh(bevelBox(WING_WIDTH, TOP, 0.28, 0.004), body()), 'Slab');
  slab.position.y = TOP / 2;
  const strip = named(new Mesh(new BoxGeometry(WING_WIDTH - 0.02, 0.003, 0.004), glow(accent, 1.2)), 'Accent');
  strip.position.set(0, TOP * 0.6, 0.141);
  group.add(slab, strip);
  // hinge at the centre's side edge, wing swung toward the player
  const half = WING_WIDTH / 2;
  group.position.set(side * (CENTRE_WIDTH / 2 + half * Math.cos(WING_ANGLE)), 0, half * Math.sin(WING_ANGLE));
  group.rotation.y = -side * WING_ANGLE;
  return group;
}

export function createConsoleFrame(): Group {
  const root = named(new Group(), 'ConsoleFrame');
  const centre = named(new Mesh(bevelBox(CENTRE_WIDTH, TOP, 0.3, 0.004), body()), 'Centre');
  centre.position.y = TOP / 2;
  root.add(centre, wing(-1, DECK_COLORS.A), wing(1, DECK_COLORS.B));
  return root;
}

/** Pad: a dark bezel with a lit cap named "Cap" that the feedback system
 * colours and presses down. Origin at the centre of the cap top, the point a
 * fingertip presses; the bezel bottom sits PAD_HEIGHT below it. */
export const PAD_HEIGHT = 0.018;

function pad(width: number, depth: number, color: string, icon: Object3D | null): Group {
  const root = new Group();
  const base = named(new Mesh(bevelBox(width + 0.008, 0.006, depth + 0.008, 0.0015), bezel()), 'Bezel');
  base.position.y = 0.003 - PAD_HEIGHT;
  const cap = named(new Mesh(bevelBox(width, 0.012, depth, 0.003), glow(color, 0.06)), 'Cap');
  cap.position.y = 0.012 - PAD_HEIGHT;
  if (icon != null) {
    icon.position.y = 0.0065;
    cap.add(icon);
  }
  root.add(base, cap);
  return root;
}

function stemIcon(stem: keyof typeof STEM_COLORS): Object3D {
  const m = iconMaterial();
  const g = named(new Group(), 'Icon');
  if (stem === 'drums') {
    const ring = new Mesh(new TorusGeometry(0.009, 0.0022, 8, 24), m);
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
  } else if (stem === 'bass') {
    for (const [i, w] of [0.022, 0.014].entries()) {
      const bar = new Mesh(new BoxGeometry(w, 0.0015, 0.004), m);
      bar.position.z = (i - 0.5) * 0.008;
      g.add(bar);
    }
  } else if (stem === 'chords') {
    for (let i = 0; i < 3; i++) {
      const dot = new Mesh(new SphereGeometry(0.0032, 10, 6), m);
      dot.scale.y = 0.4;
      dot.position.set(-0.008 + i * 0.008, 0, 0.006 - i * 0.006);
      g.add(dot);
    }
  } else {
    const head = new Mesh(new SphereGeometry(0.004, 10, 6), m);
    head.scale.y = 0.4;
    head.position.set(-0.003, 0, 0.005);
    const stemBar = new Mesh(new BoxGeometry(0.0016, 0.0015, 0.014), m);
    stemBar.position.set(0.0008, 0, -0.002);
    g.add(head, stemBar);
  }
  for (const child of g.children) child.name = `${stem}-icon`;
  return g;
}

export function createStemPad(stem: keyof typeof STEM_COLORS): Group {
  return named(pad(0.044, 0.044, STEM_COLORS[stem], stemIcon(stem)), `Pad-${stem}`);
}

export function createPlayButton(): Group {
  const tri = named(new Mesh(new CylinderGeometry(0.008, 0.008, 0.0015, 3), iconMaterial()), 'PlayIcon');
  // point the triangle away from the player
  tri.rotation.y = Math.PI / 2;
  return named(pad(0.05, 0.036, '#3DFF6E', tri), 'PlayButton');
}

/** The round "tap to start" pad that sits where DROP will be. Origin at the
 * cap top, 0.02 m above its base. */
export function createStartPad(): Group {
  const root = named(new Group(), 'StartPad');
  const base = named(new Mesh(new CylinderGeometry(0.05, 0.052, 0.006, 40), bezel()), 'Bezel');
  base.position.y = 0.003 - 0.02;
  const cap = named(new Mesh(new CylinderGeometry(0.045, 0.045, 0.014, 40), glow('#FFC93D', 0.8)), 'Cap');
  cap.position.y = 0.013 - 0.02;
  const ring = named(new Mesh(new TorusGeometry(0.03, 0.0025, 8, 40), iconMaterial()), 'StartRing');
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0075;
  cap.add(ring);
  root.add(base, cap);
  return root;
}
