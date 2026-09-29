// Seeded pseudo-random number generation. Every random choice the engine makes
// must go through an Rng so the same seed always reproduces the same output.

export const MAX_SEED = 999_999;

export interface Rng {
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Normally distributed value (Box–Muller). */
  normal(mean?: number, std?: number): number;
  pick<T>(items: readonly T[]): T;
  weightedPick<T>(values: readonly T[], weights: readonly number[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Independent stream derived from this seed and a key, e.g. a column name. */
  derive(key: string): Rng;
}

/** A fresh seed for when the user leaves the seed empty. Shown in the UI so it can be reused. */
export function generateSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] % MAX_SEED) + 1;
  }
  return Math.floor(Math.random() * MAX_SEED) + 1;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, used to derive sub-stream seeds. */
function hashString(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  let spareNormal: number | null = null;

  const rng: Rng = {
    seed,
    next,
    int(min, max) {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    normal(mean = 0, std = 1) {
      if (spareNormal !== null) {
        const z = spareNormal;
        spareNormal = null;
        return mean + z * std;
      }
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const mag = Math.sqrt(-2 * Math.log(u));
      spareNormal = mag * Math.sin(2 * Math.PI * v);
      return mean + mag * Math.cos(2 * Math.PI * v) * std;
    },
    pick(items) {
      if (!items.length) throw new Error('pick() called with an empty array');
      return items[Math.floor(next() * items.length)];
    },
    weightedPick(values, weights) {
      if (!values.length) throw new Error('weightedPick() called with an empty array');
      let total = 0;
      for (let i = 0; i < values.length; i++) total += Math.max(0, weights[i] ?? 0);
      if (total <= 0) return rng.pick(values);
      let r = next() * total;
      for (let i = 0; i < values.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r < 0) return values[i];
      }
      return values[values.length - 1];
    },
    chance(p) {
      return next() < p;
    },
    derive(key) {
      return createRng(hashString(key, hashString(String(seed))));
    },
  };
  return rng;
}
