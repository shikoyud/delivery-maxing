/** A random number source returning values in [0, 1). */
export type Rng = () => number;

/** Seeded mulberry32 PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The index of `weights` picked with probability proportional to its weight, from one rng() draw: the first index
 * whose running total passes the draw. Weights <= 0 are never picked; throws when none is positive.
 */
export function pickIndexWeighted(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  let last = -1;
  weights.forEach((w, i) => {
    if (w > 0) {
      total += w;
      last = i;
    }
  });
  if (last < 0) throw new Error('pickIndexWeighted: all weights are <= 0');
  let r = rng() * total;
  for (let i = 0; i < last; i++) {
    const w = weights[i] as number;
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return i;
  }
  return last;
}

/** Pick a key with probability proportional to its weight (pickIndexWeighted). Keys with weight <= 0 are never picked. */
export function pickWeighted<K extends string>(rng: Rng, weights: Record<K, number>): K {
  const entries = Object.entries(weights) as [K, number][];
  if (!entries.some(([, w]) => w > 0)) throw new Error('pickWeighted: all weights are <= 0');
  return (entries[pickIndexWeighted(rng, entries.map(([, w]) => w))] as [K, number])[0];
}

/** A Fisher-Yates shuffled copy of `items`. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
