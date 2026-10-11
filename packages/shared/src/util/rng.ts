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

/** Pick a key with probability proportional to its weight. Keys with weight <= 0 are never picked. */
export function pickWeighted<K extends string>(rng: Rng, weights: Record<K, number>): K {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (entries.length === 0) throw new Error('pickWeighted: all weights are <= 0');
  let r = rng() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r < 0) return key;
  }
  const last = entries[entries.length - 1];
  return (last as [K, number])[0];
}
