import { BufferAttribute, BufferGeometry } from '@iwsdk/core';

/** Merge indexed geometries that share a material into one (position, normal,
 * uv and an optional vertex colour attribute where all inputs have it).
 * Inputs are consumed (disposed). Static scenery: one draw call instead of many. */
export function mergeGeometries(list: BufferGeometry[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const g of list) {
    vertices += g.getAttribute('position').count;
    indices += g.getIndex()!.count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let i = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    position.set(p.array as Float32Array, v * 3);
    normal.set(g.getAttribute('normal').array as Float32Array, v * 3);
    const t = g.getAttribute('uv');
    if (t != null) uv.set(t.array as Float32Array, v * 2);
    const idx = g.getIndex()!;
    for (let k = 0; k < idx.count; k++) index[i + k] = idx.getX(k) + v;
    v += p.count;
    i += idx.count;
    g.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('uv', new BufferAttribute(uv, 2));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}
