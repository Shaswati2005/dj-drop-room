import {
  AddEquation,
  CustomBlending,
  OneFactor,
  ZeroFactor,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  BoxGeometry,
  TorusGeometry,
  SphereGeometry,
} from '@iwsdk/core';

/** Ring radius (m) and the truss's triangular section. */
const RADIUS = 0.55;
const CHORD = 0.035;
const TUBE = 0.005;
export const RIG_HEADS = 8;
export const PIXEL_BARS = 8;
export const PIXELS = 10;
export const BEAM_LENGTH = 1.5;

const aluminium = new MeshStandardMaterial({ color: '#B9BEC6', metalness: 0.85, roughness: 0.32 });
const fixtureBody = new MeshStandardMaterial({ color: '#16181C', metalness: 0.3, roughness: 0.55 });
const lensOff = new MeshStandardMaterial({ color: '#202530', emissive: '#FFFFFF', emissiveIntensity: 0.4, roughness: 0.2 });
const pixelOff = new MeshStandardMaterial({ color: '#0C0E12', emissive: '#000000', roughness: 0.5 });
const barCase = new MeshStandardMaterial({ color: '#0A0B0D', metalness: 0.2, roughness: 0.6 });

/** Additive light cone, bright at the lens and fading to nothing at the far
 * end (vertex colours: black adds no light). Apex at the origin, pointing -Y. */
function beamGeometry(): ConeGeometry {
  const geometry = new ConeGeometry(0.06, BEAM_LENGTH, 16, 6, true);
  geometry.translate(0, -BEAM_LENGTH / 2, 0);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - -pos.getY(i) / BEAM_LENGTH;
    const v = t * t * 0.5;
    colors.set([v, v, v], i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Light adds colour but leaves alpha alone: in passthrough the compositor
 * shows the real room wherever alpha is 0, so raising alpha would paint the
 * fading end of a beam black over the room. */
function beamMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
}

function truss(): Group {
  const group = new Group();
  group.name = 'Truss';
  // three chords: two on top, one below (a triangular box truss bent round)
  const chords: [number, number][] = [
    [RADIUS - CHORD / 2, CHORD / 2],
    [RADIUS + CHORD / 2, CHORD / 2],
    [RADIUS, -CHORD / 2],
  ];
  for (const [r, y] of chords) {
    const ring = new Mesh(new TorusGeometry(r, TUBE, 8, 96), aluminium);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    ring.name = 'Chord';
    group.add(ring);
  }
  // diagonal lacing between the chords
  const lace = new CylinderGeometry(0.0025, 0.0025, 1, 6);
  const steps = 72;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const b = ((i + 0.5) / steps) * Math.PI * 2;
    const [r0, y0] = chords[i % 2];
    const [r1, y1] = chords[2];
    const p0 = [Math.cos(a) * r0, y0, Math.sin(a) * r0];
    const p1 = [Math.cos(b) * r1, y1, Math.sin(b) * r1];
    const strut = new Mesh(lace, aluminium);
    strut.position.set((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const length = Math.hypot(dx, dy, dz);
    strut.scale.y = length;
    strut.lookAt(strut.position.x + dx, strut.position.y + dy, strut.position.z + dz);
    strut.rotateX(Math.PI / 2);
    strut.name = 'Lacing';
    group.add(strut);
  }
  return group;
}

/** A moving head hung under the truss: clamp, yoke (pans about Y), head
 * (tilts about X), lens and beam. */
function movingHead(i: number, beam: ConeGeometry): Group {
  const mount = new Group();
  mount.name = `Fixture${i}`;
  const clamp = new Mesh(new BoxGeometry(0.018, 0.016, 0.022), fixtureBody);
  clamp.position.y = -CHORD / 2 - 0.008;
  mount.add(clamp);
  const pan = new Group();
  pan.name = `Pan${i}`;
  pan.position.y = -CHORD / 2 - 0.016;
  mount.add(pan);
  const base = new Mesh(new CylinderGeometry(0.02, 0.022, 0.01, 20), fixtureBody);
  base.position.y = -0.005;
  pan.add(base);
  for (const side of [-1, 1]) {
    const arm = new Mesh(new BoxGeometry(0.006, 0.04, 0.016), fixtureBody);
    arm.position.set(side * 0.024, -0.028, 0);
    pan.add(arm);
  }
  const tilt = new Group();
  tilt.name = `Tilt${i}`;
  tilt.position.y = -0.04;
  pan.add(tilt);
  const head = new Mesh(new CylinderGeometry(0.018, 0.02, 0.05, 20), fixtureBody);
  head.position.y = -0.006;
  tilt.add(head);
  const lens = new Mesh(new CylinderGeometry(0.015, 0.015, 0.003, 20), lensOff);
  lens.position.y = -0.032;
  lens.name = `Lens${i}`;
  tilt.add(lens);
  const cone = new Mesh(beam, beamMaterial());
  cone.position.y = -0.034;
  cone.name = `Beam${i}`;
  cone.renderOrder = 10;
  // lights are effects, not geometry: keep them out of preview framing
  cone.userData.iwsdkPreviewBounds = 'exclude';
  tilt.add(cone);
  return mount;
}

/** A vertical LED pixel bar hung from the truss's lower chord. */
function pixelBar(j: number): Group {
  const bar = new Group();
  bar.name = `PixelBar${j}`;
  const height = 0.2;
  const housing = new Mesh(new BoxGeometry(0.014, height + 0.01, 0.01), barCase);
  housing.position.y = -CHORD / 2 - height / 2 - 0.01;
  bar.add(housing);
  const cell = new BoxGeometry(0.01, height / PIXELS - 0.003, 0.004);
  for (let k = 0; k < PIXELS; k++) {
    const pixel = new Mesh(cell, pixelOff);
    pixel.position.set(0, -CHORD / 2 - 0.015 - (k + 0.5) * (height / PIXELS), 0.006);
    pixel.name = `Pixel${j}_${k}`;
    bar.add(pixel);
  }
  const hanger = new Mesh(new SphereGeometry(0.004, 8, 6), aluminium);
  hanger.position.y = -CHORD / 2 - 0.006;
  bar.add(hanger);
  return bar;
}

/**
 * The light rig that appears over the console on the first DROP (PLAN-DJ-
 * UPGRADE §3.4): a 1.1 m circular truss, 8 moving heads pointing down and out
 * across the table and room, and 8 LED pixel bars between them. Origin at the
 * ring's centre; the system lifts it above the console and animates Pan{i},
 * Tilt{i}, Beam{i} and Pixel{j}_{k}.
 */
export function createLightRig(): Object3D {
  const rig = new Group();
  rig.name = 'LightRig';
  rig.add(truss());
  const beam = beamGeometry();
  for (let i = 0; i < RIG_HEADS; i++) {
    const a = (i / RIG_HEADS) * Math.PI * 2;
    const head = movingHead(i, beam);
    head.position.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS);
    // face outward so a positive tilt throws the beam away from the centre
    head.rotation.y = -a + Math.PI / 2;
    rig.add(head);
  }
  for (let j = 0; j < PIXEL_BARS; j++) {
    const a = ((j + 0.5) / PIXEL_BARS) * Math.PI * 2;
    const bar = pixelBar(j);
    bar.position.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS);
    bar.rotation.y = -a - Math.PI / 2;
    rig.add(bar);
  }
  return rig;
}
