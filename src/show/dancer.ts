import { BufferAttribute, BufferGeometry, CapsuleGeometry, MeshStandardMaterial, SphereGeometry } from '@iwsdk/core';
import type { IUniform } from '@iwsdk/core';

/**
 * The stylised dancer (PLAN 4.3): one merged ~600-triangle figure, 1.7 m tall,
 * facing +Z, drawn as a single InstancedMesh. All motion happens in the vertex
 * shader from the crowd's energy, the music's beat position and four
 * per-instance numbers, so animating the whole crowd costs no CPU per dancer.
 *
 * Parts (the `aPart` vertex attribute): 0 legs + torso, 1 head, 2 left arm, 3 right arm.
 * Per-instance `aDance` = (beat phase offset 0..2, mood -1..1, skin tone 0..1, jump weight 0..1).
 */
export const PART_BODY = 0;
export const PART_HEAD = 1;
export const PART_ARM_L = 2;
export const PART_ARM_R = 3;

const SHOULDER = { x: 0.26, y: 1.3 };

function parts(): { geometry: BufferGeometry; part: number }[] {
  const out: { geometry: BufferGeometry; part: number }[] = [];
  const legL = new CapsuleGeometry(0.085, 0.62, 2, 6);
  legL.translate(-0.1, 0.4, 0);
  const legR = new CapsuleGeometry(0.085, 0.62, 2, 6);
  legR.translate(0.1, 0.4, 0);
  const torso = new CapsuleGeometry(0.2, 0.42, 3, 8);
  torso.scale(1, 1, 0.65);
  torso.translate(0, 1.08, 0);
  out.push({ geometry: legL, part: PART_BODY }, { geometry: legR, part: PART_BODY }, { geometry: torso, part: PART_BODY });
  const head = new SphereGeometry(0.13, 10, 8);
  head.translate(0, 1.56, 0);
  out.push({ geometry: head, part: PART_HEAD });
  for (const [side, part] of [[-1, PART_ARM_L], [1, PART_ARM_R]] as const) {
    // hangs down from the shoulder
    const arm = new CapsuleGeometry(0.052, 0.46, 2, 6);
    arm.translate(side * SHOULDER.x, SHOULDER.y - 0.29, 0);
    out.push({ geometry: arm, part });
  }
  return out;
}

export function createDancerGeometry(): BufferGeometry {
  const list = parts();
  let vertices = 0;
  let indices = 0;
  for (const { geometry } of list) {
    vertices += geometry.getAttribute('position').count;
    indices += geometry.getIndex()!.count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const partId = new Float32Array(vertices);
  const index = new Uint16Array(indices);
  let v = 0;
  let i = 0;
  for (const { geometry, part } of list) {
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    const idx = geometry.getIndex()!;
    position.set(p.array as Float32Array, v * 3);
    normal.set(n.array as Float32Array, v * 3);
    partId.fill(part, v, v + p.count);
    for (let k = 0; k < idx.count; k++) index[i + k] = idx.getX(k) + v;
    v += p.count;
    i += idx.count;
    geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('aPart', new BufferAttribute(partId, 1));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

export interface DancerUniforms {
  uBeats: IUniform<number>;
  uEnergy: IUniform<number>;
  uJump: IUniform<number>;
}

const GLSL_PARS = /* glsl */ `
attribute vec4 aDance;
attribute float aPart;
uniform float uBeats;
uniform float uEnergy;
uniform float uJump;
varying float vIsHead;
varying vec3 vSkin;
float danceEnergy() { return clamp(uEnergy + aDance.y * 0.18, 0.0, 1.0); }
mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
float armAngle(float side, float e, float ph) {
  float pump = smoothstep(0.55, 0.8, e);
  float swing = 0.05 * sin(ph * 1.5708);
  return side * (0.12 + swing + pump * (2.45 + 0.3 * sin(ph * 6.2832)));
}
vec3 skinTone(float t) {
  if (t < 0.2) return vec3(0.95, 0.83, 0.72);
  if (t < 0.4) return vec3(0.85, 0.64, 0.49);
  if (t < 0.6) return vec3(0.66, 0.44, 0.30);
  if (t < 0.8) return vec3(0.42, 0.27, 0.19);
  return vec3(0.91, 0.77, 0.63);
}
`;

const SHOULDER_GLSL = `vec3(side * ${SHOULDER.x.toFixed(2)}, ${SHOULDER.y.toFixed(2)}, 0.0)`;

const GLSL_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( normal );
{
  float e = danceEnergy();
  float ph = uBeats + aDance.x;
  if (aPart > 1.5) {
    float side = aPart > 2.5 ? 1.0 : -1.0;
    objectNormal.xy = rot2(armAngle(side, e, ph)) * objectNormal.xy;
  }
  float sw = sin(ph * 1.5708) * (0.08 + 0.3 * e);
  objectNormal.xz = rot2(sw) * objectNormal.xz;
}
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

const GLSL_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
{
  float e = danceEnergy();
  float ph = uBeats + aDance.x;
  float bounce = abs(sin(3.14159265 * ph));
  if (aPart > 1.5) {
    float side = aPart > 2.5 ? 1.0 : -1.0;
    vec3 pivot = ${SHOULDER_GLSL};
    vec3 q = transformed - pivot;
    q.xy = rot2(armAngle(side, e, ph)) * q.xy;
    transformed = q + pivot;
  } else if (aPart > 0.5) {
    // head: stares down at a phone when bored, nods on the beat when dancing
    float nod = 0.35 * (1.0 - smoothstep(0.15, 0.3, e)) + bounce * 0.2 * smoothstep(0.25, 0.6, e);
    vec3 pivot = vec3(0.0, 1.42, 0.0);
    vec3 q = transformed - pivot;
    q.yz = rot2(-nod) * q.yz;
    transformed = q + pivot;
  }
  float amp = mix(0.0, 0.07, smoothstep(0.2, 0.7, e));
  float lift = bounce * amp;
  // losing it: jumping on every beat; a landing drop sends everyone up
  lift += smoothstep(0.85, 1.0, e) * bounce * 0.12;
  lift += uJump * (0.22 + 0.18 * aDance.w) * smoothstep(0.1, 0.5, e + 0.35);
  float sw = sin(ph * 1.5708) * (0.08 + 0.3 * e);
  transformed.xz = rot2(sw) * transformed.xz;
  transformed.y += lift;
  vIsHead = aPart > 0.5 && aPart < 1.5 ? 1.0 : 0.0;
  vSkin = skinTone(aDance.z);
}
`;

/** A lit material whose vertex shader dances the figure; `uniforms` is shared and updated by the system. */
export function createDancerMaterial(uniforms: DancerUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.75 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBeats = uniforms.uBeats;
    shader.uniforms.uEnergy = uniforms.uEnergy;
    shader.uniforms.uJump = uniforms.uJump;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_PARS}`)
      .replace('#include <beginnormal_vertex>', GLSL_NORMAL)
      .replace('#include <begin_vertex>', GLSL_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vIsHead;\nvarying vec3 vSkin;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vSkin, vIsHead);');
  };
  material.customProgramCacheKey = () => 'drop-room-dancer-1';
  return material;
}
