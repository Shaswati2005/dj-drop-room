import {
  AddEquation,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CustomBlending,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OneFactor,
  SphereGeometry,
  TorusGeometry,
  ZeroFactor,
} from '@iwsdk/core';
import { mergeGeometries } from './lib/merge.js';

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
/** Unlit LED colour; lit pixels are set per instance by the light show. */
export const PIXEL_OFF = '#101318';
const pixelMaterial = new MeshBasicMaterial({ color: '#FFFFFF', toneMapped: false });
const barCase = new MeshStandardMaterial({ color: '#0A0B0D', metalness: 0.2, roughness: 0.6 });

/** Where the pan and tilt axes sit inside a fixture's mount (m). */
export const PAN_Y = -CHORD / 2 - 0.016;
export const TILT_Y = -0.04;

/** Additive light cone, bright at the lens and fading to nothing at the far
 * end (vertex colours: black adds no light). Apex at the tilt origin's lens, pointing -Y. */
function beamGeometry(): ConeGeometry {
  const geometry = new ConeGeometry(0.06, BEAM_LENGTH, 16, 6, true);
  geometry.translate(0, -BEAM_LENGTH / 2 - 0.034, 0);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - -(pos.getY(i) + 0.034) / BEAM_LENGTH;
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

/** The ring: three chords, the diagonal lacing and the pixel-bar hangers merged into ONE mesh. */
function truss(): Mesh {
  const parts: BufferGeometry[] = [];
  // three chords: two on top, one below (a triangular box truss bent round)
  const chords: [number, number][] = [
    [RADIUS - CHORD / 2, CHORD / 2],
    [RADIUS + CHORD / 2, CHORD / 2],
    [RADIUS, -CHORD / 2],
  ];
  for (const [r, y] of chords) {
    const ring = new TorusGeometry(r, TUBE, 8, 96);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    parts.push(ring);
  }
  // diagonal lacing between the chords
  const steps = 72;
  const strut = new Object3D();
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const b = ((i + 0.5) / steps) * Math.PI * 2;
    const [r0, y0] = chords[i % 2];
    const [r1, y1] = chords[2];
    const p0 = [Math.cos(a) * r0, y0, Math.sin(a) * r0];
    const p1 = [Math.cos(b) * r1, y1, Math.sin(b) * r1];
    strut.position.set((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
    strut.scale.set(1, 1, 1);
    strut.rotation.set(0, 0, 0);
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    strut.scale.y = Math.hypot(dx, dy, dz);
    strut.lookAt(strut.position.x + dx, strut.position.y + dy, strut.position.z + dz);
    strut.rotateX(Math.PI / 2);
    strut.updateMatrix();
    const lace = new CylinderGeometry(0.0025, 0.0025, 1, 5);
    lace.applyMatrix4(strut.matrix);
    parts.push(lace);
  }
  // a hanger ball above each pixel bar
  for (let j = 0; j < PIXEL_BARS; j++) {
    const a = ((j + 0.5) / PIXEL_BARS) * Math.PI * 2;
    const ball = new SphereGeometry(0.004, 8, 6);
    ball.translate(Math.cos(a) * RADIUS, -CHORD / 2 - 0.006, Math.sin(a) * RADIUS);
    parts.push(ball);
  }
  const mesh = new Mesh(mergeGeometries(parts), aluminium);
  mesh.name = 'Truss';
  return mesh;
}

/** Index of pixel k (0 = top) of bar j in the Pixels instanced mesh. */
export const pixelIndex = (j: number, k: number): number => j * PIXELS + k;

/** The 8 vertical LED pixel bars hung from the lower chord: housings and the
 * Pixels (coloured per instance by the light show). */
function pixelBars(): Object3D[] {
  const height = 0.2;
  const housings = new InstancedMesh(new BoxGeometry(0.014, height + 0.01, 0.01), barCase, PIXEL_BARS);
  housings.name = 'PixelBarHousings';
  const pixels = new InstancedMesh(new BoxGeometry(0.01, height / PIXELS - 0.003, 0.004), pixelMaterial, PIXEL_BARS * PIXELS);
  pixels.name = 'Pixels';
  const bar = new Object3D();
  const part = new Object3D();
  bar.add(part);
  const off = new Color(PIXEL_OFF);
  for (let j = 0; j < PIXEL_BARS; j++) {
    const a = ((j + 0.5) / PIXEL_BARS) * Math.PI * 2;
    bar.position.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS);
    bar.rotation.y = -a - Math.PI / 2;
    const place = (mesh: InstancedMesh, index: number, y: number, z = 0) => {
      part.position.set(0, y, z);
      bar.updateMatrixWorld(true);
      mesh.setMatrixAt(index, part.matrixWorld);
    };
    place(housings, j, -CHORD / 2 - height / 2 - 0.01);
    for (let k = 0; k < PIXELS; k++) {
      place(pixels, pixelIndex(j, k), -CHORD / 2 - 0.015 - (k + 0.5) * (height / PIXELS), 0.006);
      pixels.setColorAt(pixelIndex(j, k), off);
    }
  }
  return [housings, pixels];
}

/** Matrix that puts a fixture's mount at its place on the ring. */
function mountMatrix(i: number): Matrix4 {
  const a = (i / RIG_HEADS) * Math.PI * 2;
  const mount = new Object3D();
  mount.position.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS);
  // face outward so a positive tilt throws the beam away from the centre
  mount.rotation.y = -a + Math.PI / 2;
  mount.updateMatrix();
  return mount.matrix;
}

function instances(name: string, geometry: BufferGeometry, material: MeshStandardMaterial | MeshBasicMaterial, matrices: Matrix4[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, matrices.length);
  mesh.name = name;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  return mesh;
}

/**
 * The light rig that appears over the console on the first DROP (PLAN-DJ-
 * UPGRADE 3.4): a 1.1 m circular truss, 8 moving heads pointing down and out
 * across the table and room, and 8 LED pixel bars between them. Origin at the
 * ring's centre; the system lifts it above the console.
 *
 * Eight draw calls in all: Truss (ring, lacing, hangers merged), Clamps,
 * Yokes, Heads, Lenses and Beams (instanced, one instance per moving head),
 * PixelBarHousings and Pixels. The empty groups Fixture{i} > Pan{i} > Tilt{i}
 * carry each head's pan and tilt: the light show rotates them, then copies
 * their world matrices into the Yokes (pan), Heads, Lenses and Beams (tilt)
 * instances every frame.
 */
export function createLightRig(): Object3D {
  const rig = new Group();
  rig.name = 'LightRig';
  rig.add(truss());

  // static clamps, in mount space
  const clamp = new BoxGeometry(0.018, 0.016, 0.022);
  clamp.translate(0, -CHORD / 2 - 0.008, 0);
  // yoke (pan space): base disc and two arms
  const yoke = mergeGeometries([
    new CylinderGeometry(0.02, 0.022, 0.01, 20).translate(0, -0.005, 0),
    new BoxGeometry(0.006, 0.04, 0.016).translate(-0.024, -0.028, 0),
    new BoxGeometry(0.006, 0.04, 0.016).translate(0.024, -0.028, 0),
  ]);
  // head and lens (tilt space)
  const head = new CylinderGeometry(0.018, 0.02, 0.05, 20).translate(0, -0.006, 0);
  const lens = new CylinderGeometry(0.015, 0.015, 0.003, 20).translate(0, -0.032, 0);

  const mounts = Array.from({ length: RIG_HEADS }, (_, i) => mountMatrix(i));
  const identity = Array.from({ length: RIG_HEADS }, () => new Matrix4());
  for (let i = 0; i < RIG_HEADS; i++) {
    const mount = new Group();
    mount.name = `Fixture${i}`;
    mount.applyMatrix4(mounts[i]);
    const pan = new Group();
    pan.name = `Pan${i}`;
    pan.position.y = PAN_Y;
    const tilt = new Group();
    tilt.name = `Tilt${i}`;
    tilt.position.y = TILT_Y;
    pan.add(tilt);
    mount.add(pan);
    rig.add(mount);
  }
  rig.add(
    instances('Clamps', clamp, fixtureBody, mounts),
    instances('Yokes', yoke, fixtureBody, identity),
    instances('Heads', head, fixtureBody, identity),
    instances('Lenses', lens, lensOff, identity),
  );
  const beams = instances('Beams', beamGeometry(), beamMaterial(), identity);
  beams.name = 'Beams';
  beams.renderOrder = 10;
  // the moving parts leave their rest-pose bounds
  beams.frustumCulled = false;
  for (const name of ['Yokes', 'Heads', 'Lenses']) rig.getObjectByName(name)!.frustumCulled = false;
  const off = new Color('#000000');
  for (let i = 0; i < RIG_HEADS; i++) beams.setColorAt(i, off);
  // lights are effects, not geometry: keep them out of preview framing
  beams.userData.iwsdkPreviewBounds = 'exclude';
  rig.add(beams);
  rig.add(...pixelBars());
  return rig;
}
