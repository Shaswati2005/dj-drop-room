/**
 * What the crowd is doing right now, written by CrowdSystem and read by the
 * light show (hype tier) and by tests (`__dropRoom.crowd()`).
 */
export type CrowdContext = 'none' | 'table' | 'club';

export const CROWD_STATES = ['idle', 'bobbing', 'dancing', 'handsup'] as const;
export type CrowdStateName = (typeof CROWD_STATES)[number];

export const crowdState = {
  /** where the crowd stands: miniature on the table (mixed reality), life-size around the booth (club) */
  context: 'none' as CrowdContext,
  /** dancers drawn right now (16 when cold, up to 24 when on fire) */
  instances: 0,
  /** the total instances the mesh holds */
  capacity: 0,
  /** crowd energy 0..1 as used (forced value when `force` is set) */
  energy: 0.2,
  /** hype tier 0 cold, 1 warm, 2 hot, 3 on fire (PLAN 4.4) */
  tier: 0,
  /** tier the music itself has earned (the beams follow this; the resident crowd does not raise it) */
  earnedTier: 0,
  /** how many drawn dancers are in each state: idle, bobbing, dancing, hands up */
  counts: [0, 0, 0, 0],
  /** 1 on a landing drop, falling to 0 over 0.6 s: the jump */
  jump: 0,
  /** draw calls the crowd costs */
  drawCalls: 0,
  /** tests: a fixed energy instead of the music's, or null */
  force: null as number | null,
};

/** PLAN 4.4 tiers from energy 0..1: cold < .25, warm < .5, hot < .75, on fire. */
export function tierOf(energy: number): number {
  return energy < 0.25 ? 0 : energy < 0.5 ? 1 : energy < 0.75 ? 2 : 3;
}

/** A dancer's own state from the crowd energy plus their mood (-1..1). */
export function dancerState(energy: number, mood: number): number {
  const e = Math.max(0, Math.min(1, energy + mood * 0.18));
  return e < 0.3 ? 0 : e < 0.55 ? 1 : e < 0.78 ? 2 : 3;
}

/** Dancers drawn at a tier: 16 cold/warm, 20 hot, 24 on fire. */
export function visibleDancers(tier: number, capacity: number): number {
  return Math.min(capacity, tier >= 3 ? 24 : tier === 2 ? 20 : 16);
}

/** Spots for the club crowd: club space (metres), booth at the origin on the
 * floor, -Z toward the main LED wall. Rejection-sampled and deterministic:
 * never inside the DJ's own space, the speaker stacks, the pillars or the
 * walls, and at least `spacing` apart. */
export interface Spot {
  x: number;
  z: number;
  phase: number;
  mood: number;
  height: number;
}

export interface ClubObstacles {
  stacks: { x: number; z: number }[];
  stackRadius: number;
  pillars: { x: number; z: number }[];
  pillarRadius: number;
  /** half-extents of the walkable room */
  halfWidth: number;
  near: number;
  far: number;
}

export function clubSpots(count: number, obstacles: ClubObstacles, spacing = 0.9): Spot[] {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spots: Spot[] = [];
  let guard = 0;
  while (spots.length < count && guard++ < 20000) {
    // rings round the booth, denser toward the front (-Z), but all the way round
    const radius = 1.7 + Math.sqrt(random()) * 3.4;
    const angle = random() * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    if (Math.abs(x) > obstacles.halfWidth - 0.8 || z < obstacles.far + 1.4 || z > obstacles.near - 1) continue;
    // the DJ stands behind the table: keep that strip and the booth clear
    if (Math.abs(x) < 1.1 && z > -0.9 && z < 1.9) continue;
    if (obstacles.stacks.some((s) => Math.hypot(s.x - x, s.z - z) < obstacles.stackRadius)) continue;
    if (obstacles.pillars.some((p) => Math.hypot(p.x - x, p.z - z) < obstacles.pillarRadius)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < spacing)) continue;
    spots.push({ x, z, phase: random() * 2, mood: random() * 2 - 1, height: 0.93 + random() * 0.14 });
  }
  return spots;
}

/** Spots for the miniature crowd on a dance floor of `radius` (in dancer units, metres at full size). */
export function tableSpots(count: number, radius: number, spacing: number): Spot[] {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spots: Spot[] = [];
  let guard = 0;
  while (spots.length < count && guard++ < 20000) {
    const x = (random() * 2 - 1) * radius;
    const z = (random() * 2 - 1) * radius;
    if (x * x + z * z > radius * radius) continue;
    if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < spacing * spacing)) continue;
    spots.push({ x, z, phase: random() * 2, mood: random() * 2 - 1, height: 0.92 + random() * 0.16 });
  }
  return spots;
}
