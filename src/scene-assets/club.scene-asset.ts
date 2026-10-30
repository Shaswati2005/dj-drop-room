import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  FrontSide,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from '@iwsdk/core';
import type { Material, Side, Texture } from '@iwsdk/core';

/**
 * Club mode (PLAN-DJ-UPGRADE 3.4): an intimate warehouse club around the
 * booth, in metres. Origin at the booth's centre ON THE FLOOR; -Z is the far
 * end (main LED wall), +Z is behind the DJ (a smaller second screen). The club
 * system centres it on the console and sets the booth table's height.
 * Everything static is merged or instanced, so the whole room is about 14 draw
 * calls (floor, walls, pillars, booth, 2 LED screens, frame, ceiling bars,
 * speakers, blinders, floor pools), with no lights and no shadows. The light
 * show drives the LED texture, the ceiling LEDs, the blinders, the floor pools
 * and the sub drivers' pump (see ClubSystem).
 */
export const ROOM = { width: 14, height: 6.2, near: 6.5, far: -9 };
export const LED_COLS = 64;
export const LED_ROWS = 24;
export const CEILING_BARS = 5;
export const CEILING_SEGMENTS = 40;
export const BLINDERS = 8;
export const POOLS = 8;
/** Sub woofers pumped by the kick: 4 per side. */
export const DRIVERS = 8;
export const WALL_SCREEN = { z: -8.4, y: 2.5, width: 8, height: 3.2 };
export const BACK_SCREEN = { z: 5.8, y: 2.1, width: 5, height: 2.2 };
/** Subwoofers on the floor and a flown line array each side of the booth. */
export const STACKS = { x: 2.7, z: -2.6, yaw: 0.75 };

function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function dataTexture(size: number, fill: (x: number, y: number, rgba: Uint8Array, i: number) => void, mips = true): Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) fill(x, y, data, (y * size + x) * 4);
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
  texture.generateMipmaps = mips;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Poured concrete: grey noise, slab joints every half texture or panel seams. */
function concrete(seed: number, joints: boolean, seams: boolean): Texture {
  const rnd = random(seed);
  return dataTexture(128, (x, y, d, i) => {
    let v = 150 + rnd() * 70;
    if (joints && (x % 64 < 2 || y % 64 < 2)) v *= 0.45;
    if (seams && (x % 32 < 1 || y % 64 < 1)) v *= 0.6;
    d.set([v, v, v * 1.03, 255], i);
  });
}

/** The LED wall's pixel grid; the club system rewrites it each frame. */
export function ledTexture(): DataTexture {
  const data = new Uint8Array(LED_COLS * LED_ROWS * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const texture = new DataTexture(data, LED_COLS, LED_ROWS, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function radialTexture(): Texture {
  return dataTexture(
    64,
    (x, y, d, i) => {
      const r = Math.hypot(x - 31.5, y - 31.5) / 32;
      const v = Math.max(0, 1 - r) ** 2 * 255;
      d.set([v, v, v, 255], i);
    },
    false,
  );
}

function floorMaterial(): MeshStandardMaterial {
  const map = concrete(11, true, false);
  map.repeat.set(7, 8);
  return new MeshStandardMaterial({ color: '#6E7076', map, roughness: 0.82, metalness: 0.05 });
}

function wallMaterial(repeatX: number, repeatY: number, side: Side): MeshStandardMaterial {
  const map = concrete(23, false, true);
  map.repeat.set(repeatX, repeatY);
  return new MeshStandardMaterial({ color: '#585B62', map, roughness: 0.9, metalness: 0.02, side });
}

const dark = (hex: string, roughness = 0.7, metalness = 0.2): MeshStandardMaterial => new MeshStandardMaterial({ color: hex, roughness, metalness });

function mesh(name: string, geometry: Mesh['geometry'], material: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  m.position.set(x, y, z);
  return m;
}

interface Part {
  p: [number, number, number];
  s: [number, number, number];
  yaw?: number;
  pitch?: number;
}

/** One instanced mesh from a list of transforms (position, yaw, pitch, scale). */
function instanced(name: string, geometry: Mesh['geometry'], material: Material, parts: Part[]): InstancedMesh {
  const m = new InstancedMesh(geometry, material, parts.length);
  m.name = name;
  const o = new Object3D();
  parts.forEach((part, i) => {
    o.position.set(...part.p);
    o.scale.set(...part.s);
    o.rotation.set(part.pitch ?? 0, part.yaw ?? 0, 0, 'YXZ');
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  });
  return m;
}

/** A stack-local point in club space (stack at (sx, sz), turned by `yaw`). */
function inStack(sx: number, sz: number, yaw: number, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [sx + x * c + z * s, y, sz - x * s + z * c];
}

function speakers(): Group {
  const group = new Group();
  group.name = 'Speakers';
  const cabinets: Part[] = [];
  const drivers: Part[] = [];
  for (const side of [-1, 1]) {
    const yaw = -side * STACKS.yaw;
    const at = (x: number, y: number, z: number) => inStack(side * STACKS.x, STACKS.z, yaw, x, y, z);
    // 2 x 2 subs: 0.62 x 0.55 x 0.75, one big front driver each
    for (const dx of [-0.32, 0.32])
      for (const level of [0, 1]) {
        const y = 0.275 + level * 0.56;
        cabinets.push({ p: at(dx, y, 0), s: [0.62, 0.55, 0.75], yaw });
        drivers.push({ p: at(dx, y, 0.385), s: [1, 1, 1], yaw });
      }
    // line array: 8 modules curving down, flown on a rigging bar from the ceiling
    const top = 5.2;
    for (let i = 0; i < 8; i++) cabinets.push({ p: at(0, top - i * 0.235, -0.1), s: [0.62, 0.22, 0.4], yaw, pitch: -i * 0.05 });
    cabinets.push({ p: at(0, (top + ROOM.height) / 2 + 0.12, -0.1), s: [0.05, ROOM.height - top - 0.12, 0.05], yaw });
    cabinets.push({ p: at(0, top + 0.12, -0.1), s: [0.7, 0.05, 0.45], yaw });
  }
  const cabinetMesh = instanced('SpeakerCabinets', new BoxGeometry(1, 1, 1), dark('#2A2C32', 0.6, 0.25), cabinets);
  const woofer = new CylinderGeometry(0.21, 0.21, 0.04, 28);
  woofer.rotateX(Math.PI / 2);
  const driverMesh = instanced('SpeakerDrivers', woofer, dark('#0B0B0D', 0.55, 0.1), drivers);
  group.add(cabinetMesh, driverMesh);
  return group;
}

/** Ceiling pixel bars: housings and a row of LED segments each, ripple-driven. */
function ceiling(): Group {
  const group = new Group();
  group.name = 'Ceiling';
  const y = ROOM.height - 0.25;
  const zs = [-6, -3.4, -0.8, 1.8, 4.4];
  const housings = instanced('CeilingHousings', new BoxGeometry(13, 0.08, 0.12), dark('#0C0D10', 0.5, 0.3), zs.map((z) => ({ p: [0, y + 0.02, z], s: [1, 1, 1] })));
  const leds: Part[] = [];
  const width = 12.6;
  for (const z of zs) for (let k = 0; k < CEILING_SEGMENTS; k++) leds.push({ p: [-width / 2 + ((k + 0.5) / CEILING_SEGMENTS) * width, y - 0.04, z], s: [1, 1, 1] });
  const ledMesh = instanced('CeilingLeds', new BoxGeometry((width / CEILING_SEGMENTS) * 0.8, 0.03, 0.08), new MeshBasicMaterial({ color: '#FFFFFF', toneMapped: false, fog: false }), leds);
  const off = new Color('#0E1015');
  for (let i = 0; i < leds.length; i++) ledMesh.setColorAt(i, off);
  group.add(housings, ledMesh);
  return group;
}

/** The main LED wall (far end), a smaller screen behind the DJ, and a frame. */
function screens(): Group {
  const group = new Group();
  group.name = 'Screens';
  const texture = ledTexture();
  const material = new MeshBasicMaterial({ map: texture, toneMapped: false, fog: false, side: FrontSide });
  const wall = mesh('LedWall', new PlaneGeometry(WALL_SCREEN.width, WALL_SCREEN.height), material, 0, WALL_SCREEN.y, WALL_SCREEN.z);
  const back = mesh('LedWallBack', new PlaneGeometry(BACK_SCREEN.width, BACK_SCREEN.height), material, 0, BACK_SCREEN.y, BACK_SCREEN.z);
  back.rotation.y = Math.PI;
  const frames = instanced('LedFrames', new BoxGeometry(1, 1, 1), dark('#0A0B0D', 0.5, 0.4), [
    { p: [0, WALL_SCREEN.y, WALL_SCREEN.z - 0.08], s: [WALL_SCREEN.width + 0.3, WALL_SCREEN.height + 0.3, 0.12] },
    { p: [0, BACK_SCREEN.y, BACK_SCREEN.z + 0.08], s: [BACK_SCREEN.width + 0.25, BACK_SCREEN.height + 0.25, 0.12] },
  ]);
  group.add(wall, back, frames);
  return group;
}

/** Warm-white blinders either side of the far wall, flashed softly on drops. */
function blinders(): Mesh {
  const parts: Part[] = [];
  for (const side of [-1, 1])
    for (const dx of [-0.17, 0.17])
      for (const dy of [-0.17, 0.17]) parts.push({ p: [side * 4.4 + dx, 2.2 + dy, -7.6], s: [1, 1, 1], yaw: side * 0.35 });
  return instanced('Blinders', new BoxGeometry(0.3, 0.3, 0.1), new MeshBasicMaterial({ color: '#2A2418', toneMapped: false, fog: false }), parts);
}

/** One soft light pool per moving head, placed on the floor by the club system. */
function pools(): InstancedMesh {
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    map: radialTexture(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const m = new InstancedMesh(geometry, material, POOLS);
  m.name = 'FloorPools';
  m.frustumCulled = false;
  const off = new Color('#000000');
  for (let i = 0; i < POOLS; i++) m.setColorAt(i, off);
  m.renderOrder = 5;
  return m;
}

/**
 * The club. Children: ClubFloor, ClubWalls, Pillars, BoothTable (1 m tall
 * box with its origin at the floor: the system scales Y to the console's
 * height), Speakers {SpeakerCabinets, SpeakerDrivers}, Ceiling {CeilingLeds},
 * Screens {LedWall, LedWallBack}, Blinders, FloorPools.
 */
export function createClubRoom(): Object3D {
  const club = new Group();
  club.name = 'ClubRoom';
  const depth = ROOM.near - ROOM.far;
  const centreZ = (ROOM.near + ROOM.far) / 2;
  const floorGeometry = new PlaneGeometry(ROOM.width, depth);
  floorGeometry.rotateX(-Math.PI / 2);
  club.add(mesh('ClubFloor', floorGeometry, floorMaterial(), 0, 0.003, centreZ));
  // the shell: an inside-out box (walls and ceiling), concrete with panel seams
  club.add(mesh('ClubWalls', new BoxGeometry(ROOM.width, ROOM.height, depth), wallMaterial(7, 3, BackSide), 0, ROOM.height / 2, centreZ));
  const pillars: Part[] = [];
  for (const x of [-5.8, 5.8]) for (const z of [-6, -1.5, 3]) pillars.push({ p: [x, ROOM.height / 2, z], s: [0.55, ROOM.height, 0.55] });
  club.add(instanced('Pillars', new BoxGeometry(1, 1, 1), wallMaterial(1, 2, FrontSide), pillars));
  // the DJ table: matte black, top set to the console's base by the system
  const table = new BoxGeometry(1.1, 1, 0.6);
  table.translate(0, 0.5, 0);
  const booth = mesh('BoothTable', table, dark('#0A0A0C', 0.9, 0.05), 0, 0, 0);
  booth.scale.y = 0.7;
  club.add(booth, speakers(), ceiling(), screens(), blinders(), pools());
  return club;
}
