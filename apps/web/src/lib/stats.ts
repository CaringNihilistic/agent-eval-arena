// Small statistics helpers. Each is the only implementation in the project.

export interface Interval {
  low: number;
  high: number;
}

/** Wilson score interval for a proportion, 95% by default. Null with no trials. */
export function wilson(successes: number, trials: number, z = 1.96): Interval | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const centre = (p + z2 / (2 * trials)) / (1 + z2 / trials);
  const half =
    (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / (1 + z2 / trials);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** A seeded generator of numbers in [0, 1), so bootstrap output is reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The value at fraction `q` of a sorted list, by linear interpolation. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new Error("percentile of an empty list");
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Competition ranks, best first: equal values share a rank and the next rank
 * skips ("1, 2, 2, 4"). A null value has no rank.
 */
export function rankDescending<K>(values: ReadonlyMap<K, number | null>): Map<K, number | null> {
  const present = [...values.entries()].filter((entry): entry is [K, number] => entry[1] !== null);
  const ranks = new Map<K, number | null>();
  for (const [key, value] of values) {
    ranks.set(key, value === null ? null : 1 + present.filter(([, other]) => other > value).length);
  }
  return ranks;
}
