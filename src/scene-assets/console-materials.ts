import { MeshStandardMaterial } from '@iwsdk/core';

/** Shared console materials. One instance per look, reused by every mesh;
 * systems clone a material before changing it on one control. */
export const DECK_COLORS = { A: '#29D7FF', B: '#FF3DA8' } as const;

export const materials = {
  body: new MeshStandardMaterial({ color: '#121317', roughness: 0.62, metalness: 0.1 }),
  deckPlate: new MeshStandardMaterial({ color: '#1A1B20', roughness: 0.45, metalness: 0.2 }),
  mixerPlate: new MeshStandardMaterial({ color: '#17181D', roughness: 0.5, metalness: 0.3 }),
  slot: new MeshStandardMaterial({ color: '#040405', roughness: 0.95 }),
  screen: new MeshStandardMaterial({ color: '#06090E', emissive: '#0E3558', emissiveIntensity: 0.7, roughness: 0.15 }),
  ledOff: new MeshStandardMaterial({ color: '#16181A', roughness: 0.4 }),
  tick: new MeshStandardMaterial({ color: '#8A8F98', roughness: 0.6 }),
  rubber: new MeshStandardMaterial({ color: '#0C0C0E', roughness: 0.92 }),
  knob: new MeshStandardMaterial({ color: '#1A1B1F', roughness: 0.7, metalness: 0.15 }),
  metal: new MeshStandardMaterial({ color: '#B8BDC6', roughness: 0.32, metalness: 1 }),
  darkMetal: new MeshStandardMaterial({ color: '#3A3D44', roughness: 0.4, metalness: 0.9 }),
  vinyl: new MeshStandardMaterial({ color: '#0A0A0B', roughness: 0.55, metalness: 0.1 }),
  white: new MeshStandardMaterial({ color: '#F2F2F2', emissive: '#FFFFFF', emissiveIntensity: 0.5, roughness: 0.5 }),
};

const glows = new Map<string, MeshStandardMaterial>();
/** A lit material in one colour (button caps, rings, accents). */
export function glow(hex: string, intensity = 1): MeshStandardMaterial {
  const key = `${hex}:${intensity}`;
  let material = glows.get(key);
  if (material == null) {
    material = new MeshStandardMaterial({ color: '#111111', emissive: hex, emissiveIntensity: intensity, roughness: 0.4 });
    glows.set(key, material);
  }
  return material;
}
