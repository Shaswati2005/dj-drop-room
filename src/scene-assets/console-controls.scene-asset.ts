import { BoxGeometry, CylinderGeometry, Group, Mesh, TorusGeometry } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { DECK, PRESS_HEIGHT } from './console-layout.js';
import { DECK_COLORS, glow, materials } from './console-materials.js';
import { bevelBox } from './lib/hardsurface.js';

/**
 * Interactive console controls, one manifest asset each so the scene can give
 * every placement its own components. Pressables (pads, buttons) have their
 * origin at the centre of the cap top, the point a fingertip presses, and a
 * child named "Cap" that the feedback system lights and pushes down. Knobs,
 * fader caps and the jog wheel have their origin on the console surface.
 */

function named<T extends Object3D>(object: T, name: string): T {
  object.name = name;
  return object;
}

function at<T extends Object3D>(object: T, x: number, y: number, z: number): T {
  object.position.set(x, y, z);
  return object;
}

/** Bezel + cap; origin at the cap top. */
function pressable(name: string, height: number, bezel: Object3D, cap: Mesh, capHeight: number): Group {
  const root = named(new Group(), name);
  bezel.position.y = -height + 0.002;
  cap.name = 'Cap';
  cap.position.y = -capHeight / 2;
  root.add(bezel, cap);
  return root;
}

export function createPad(): Group {
  const s = DECK.pads.size;
  return pressable(
    'PerformancePad',
    PRESS_HEIGHT.pad,
    named(new Mesh(bevelBox(s + 0.005, 0.004, s + 0.005, 0.0012), materials.rubber), 'Bezel'),
    new Mesh(bevelBox(s, 0.011, s, 0.0025), glow('#FFFFFF', 0.05)),
    0.011,
  );
}

/** DJ-player-style round button: a lit ring around a dark rubber face. */
function roundButton(name: string, color: string, icon: Object3D | null): Group {
  const cap = new Mesh(new CylinderGeometry(0.017, 0.017, 0.011, 40), glow(color, 0.25));
  const face = named(at(new Mesh(new CylinderGeometry(0.0135, 0.0135, 0.0012, 40), materials.rubber), 0, 0.0056, 0), 'Face');
  cap.add(face);
  if (icon != null) face.add(at(icon, 0, 0.0008, 0));
  const bezel = named(new Mesh(new CylinderGeometry(0.0205, 0.021, 0.004, 40), materials.darkMetal), 'Bezel');
  return pressable(name, PRESS_HEIGHT.round, bezel, cap, 0.011);
}

export function createPlayButton(): Group {
  const tri = named(new Mesh(new CylinderGeometry(0.006, 0.006, 0.0006, 3), materials.white), 'PlayIcon');
  tri.rotation.y = Math.PI / 2; // point away from the player
  const pause = named(new Group(), 'PauseIcon');
  for (const x of [0.0055, 0.0085]) pause.add(named(at(new Mesh(new BoxGeometry(0.0018, 0.0006, 0.009), materials.white), x, 0, 0), 'PauseBar'));
  const icons = named(new Group(), 'Icons');
  icons.add(at(tri, -0.002, 0, 0), pause);
  return roundButton('PlayButton', '#3DFF6E', icons);
}

export function createCueButton(): Group {
  const bar = named(new Mesh(new BoxGeometry(0.012, 0.0006, 0.0022), materials.white), 'CueIcon');
  return roundButton('CueButton', '#FF9A1F', bar);
}

function smallButton(name: string, color: string, width: number, depth: number): Group {
  return pressable(
    name,
    PRESS_HEIGHT.small,
    named(new Mesh(bevelBox(width + 0.004, 0.003, depth + 0.004, 0.001), materials.rubber), 'Bezel'),
    new Mesh(bevelBox(width, 0.008, depth, 0.002), glow(color, 0.2)),
    0.008,
  );
}

/** A small button with a flat icon on its cap (the cap top is the origin). */
function iconButton(name: string, color: string, width: number, depth: number, icon: Object3D): Group {
  const root = smallButton(name, color, width, depth);
  const cap = root.getObjectByName('Cap')!;
  icon.position.set(0, 0.0044, 0);
  cap.add(icon);
  return root;
}

const dot = () => named(new Mesh(new CylinderGeometry(0.0055, 0.0055, 0.0006, 24), materials.white), 'RecDot');
const arrow = () => {
  const tri = named(new Mesh(new CylinderGeometry(0.006, 0.006, 0.0006, 3), materials.white), 'ShareIcon');
  tri.rotation.y = Math.PI / 2;
  return tri;
};

/** Crate load buttons: deck-coloured, poke to load the slot's track there. */
export const createLoadButtonA = () => smallButton('LoadButtonA', DECK_COLORS.A, 0.034, 0.02);
export const createLoadButtonB = () => smallButton('LoadButtonB', DECK_COLORS.B, 0.034, 0.02);
export const createRecButton = () => iconButton('RecButton', '#FF2D2D', 0.032, 0.02, dot());
export const createShareButton = () => iconButton('ShareButton', '#7C8CFF', 0.032, 0.02, arrow());

export const createSyncButton = () => smallButton('SyncButton', '#FFB020', 0.03, 0.018);
export const createModeButton = () => smallButton('ModeButton', '#FFFFFF', 0.033, 0.013);
export const createFxButton = () => smallButton('FxButton', '#38E8FF', 0.032, 0.022);

export function createDropButton(): Group {
  const cap = new Mesh(new CylinderGeometry(0.03, 0.03, 0.013, 48), glow('#FF2D55', 0.4));
  const face = named(at(new Mesh(new CylinderGeometry(0.025, 0.025, 0.0012, 48), materials.rubber), 0, 0.0066, 0), 'Face');
  const ring = named(new Mesh(new TorusGeometry(0.016, 0.0016, 8, 48), materials.white), 'DropRing');
  ring.rotation.x = -Math.PI / 2;
  face.add(at(ring, 0, 0.0008, 0));
  cap.add(face);
  const bezel = named(new Mesh(new CylinderGeometry(0.035, 0.036, 0.005, 48), materials.darkMetal), 'Bezel');
  return pressable('DropButton', PRESS_HEIGHT.drop, bezel, cap, 0.013);
}

export const createEndButtonA = () => roundButton('CrossfadeEndA', DECK_COLORS.A, null);
export const createEndButtonB = () => roundButton('CrossfadeEndB', DECK_COLORS.B, null);

/** Rotary knob on a metal skirt; the group named "Knob" turns about +Y and its
 * white pointer shows the value. Origin on the console surface. */
export function createKnob(large = false): Group {
  const r = large ? 0.015 : 0.012;
  const root = named(new Group(), large ? 'KnobLarge' : 'KnobSmall');
  const skirt = named(at(new Mesh(new CylinderGeometry(r + 0.002, r + 0.0025, 0.004, 32), materials.darkMetal), 0, 0.002, 0), 'Skirt');
  const knob = named(new Group(), 'Knob');
  const body = named(at(new Mesh(new CylinderGeometry(r * 0.88, r, 0.015, 24), materials.knob), 0, 0.0115, 0), 'KnobBody');
  const top = named(at(new Mesh(new CylinderGeometry(r * 0.8, r * 0.88, 0.002, 24), materials.rubber), 0, 0.02, 0), 'KnobTop');
  const pointer = named(at(new Mesh(new BoxGeometry(0.0016, 0.0012, r * 0.75), materials.white), 0, 0.0212, -r * 0.42), 'Pointer');
  knob.add(body, top, pointer);
  if (large) {
    const ring = named(new Mesh(new TorusGeometry(r + 0.0035, 0.0012, 8, 40), glow('#38E8FF', 0.6)), 'FilterRing');
    ring.rotation.x = -Math.PI / 2;
    root.add(at(ring, 0, 0.0015, 0));
  }
  root.add(skirt, knob);
  return root;
}

export const createKnobSmall = () => createKnob(false);
export const createKnobLarge = () => createKnob(true);

/** Fader cap on a short stem, sliding along `axis`. Origin on the surface. */
function faderCap(name: string, axis: 'x' | 'z'): Group {
  const root = named(new Group(), name);
  const across = 0.024;
  const along = 0.013;
  const w = axis === 'z' ? across : along;
  const d = axis === 'z' ? along : across;
  const stem = named(at(new Mesh(new BoxGeometry(0.004, 0.008, 0.004), materials.darkMetal), 0, 0.004, 0), 'Stem');
  const cap = named(at(new Mesh(bevelBox(w, 0.011, d, 0.0025), materials.knob), 0, 0.0125, 0), 'Cap');
  const lineW = axis === 'z' ? across * 0.8 : 0.0016;
  const lineD = axis === 'z' ? 0.0016 : across * 0.8;
  cap.add(named(at(new Mesh(new BoxGeometry(lineW, 0.0008, lineD), materials.white), 0, 0.0056, 0), 'Line'));
  root.add(stem, cap);
  return root;
}

export const createChannelFaderCap = () => faderCap('ChannelFaderCap', 'z');
export const createTempoFaderCap = () => faderCap('TempoFaderCap', 'z');
export const createCrossfaderCap = () => faderCap('CrossfaderCap', 'x');

/** Jog wheel: metal platter with a vinyl face, label and a marker so its spin
 * reads at a glance, inside a lit ring. "Platter" spins about +Y. */
export function createJogWheel(deck: 'A' | 'B'): Group {
  const R = DECK.jog.radius;
  const root = named(new Group(), `JogWheel${deck}`);
  const housing = named(at(new Mesh(new CylinderGeometry(R, R, 0.004, 64), materials.rubber), 0, 0.002, 0), 'Housing');
  const ring = named(new Mesh(new TorusGeometry(R - 0.0025, 0.0016, 8, 72), glow(DECK_COLORS[deck], 1.1)), 'JogRing');
  ring.rotation.x = -Math.PI / 2;
  root.add(housing, at(ring, 0, 0.0045, 0));

  const platter = named(new Group(), 'Platter');
  platter.position.y = 0.004;
  const rim = named(at(new Mesh(new CylinderGeometry(R - 0.006, R - 0.0055, 0.008, 64), materials.metal), 0, 0.004, 0), 'Rim');
  const vinyl = named(at(new Mesh(new CylinderGeometry(R - 0.012, R - 0.012, 0.0012, 64), materials.vinyl), 0, 0.0084, 0), 'Vinyl');
  const groove = named(new Mesh(new TorusGeometry(R * 0.55, 0.0006, 6, 64), materials.darkMetal), 'Groove');
  groove.rotation.x = -Math.PI / 2;
  const label = named(at(new Mesh(new CylinderGeometry(0.016, 0.016, 0.0014, 40), glow(DECK_COLORS[deck], 0.5)), 0, 0.0088, 0), 'Label');
  const spindle = named(at(new Mesh(new CylinderGeometry(0.0025, 0.0025, 0.004, 12), materials.metal), 0, 0.01, 0), 'Spindle');
  const marker = named(at(new Mesh(new BoxGeometry(0.003, 0.0008, 0.018), materials.white), 0, 0.0092, -(R - 0.022)), 'Marker');
  platter.add(rim, vinyl, at(groove, 0, 0.0092, 0), label, spindle, marker);
  root.add(platter);
  return root;
}

export const createJogWheelA = () => createJogWheel('A');
export const createJogWheelB = () => createJogWheel('B');

/** The round "tap to start" pad that sits over DROP until the music starts.
 * Origin at the cap top. */
export function createStartPad(): Group {
  const cap = new Mesh(new CylinderGeometry(0.045, 0.045, 0.014, 48), glow('#FFC93D', 0.8));
  const ring = named(new Mesh(new TorusGeometry(0.03, 0.0025, 8, 48), materials.white), 'StartRing');
  ring.rotation.x = -Math.PI / 2;
  cap.add(at(ring, 0, 0.0075, 0));
  const bezel = named(new Mesh(new CylinderGeometry(0.05, 0.052, 0.006, 48), materials.rubber), 'Bezel');
  return pressable('StartPad', PRESS_HEIGHT.start, bezel, cap, 0.014);
}
