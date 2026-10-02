// Seeded choices. Everything that must come out the same for every player of a
// seeded game (a Weekend, a Morning Post, a challenge) is drawn through here.

import { seededRandom } from "@/lib/stats";

/** FNV-1a, 32 bits. Not cryptographic: it only has to spread strings evenly. */
export function hash32(text: string, salt = 0): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Sixteen hex characters derived from a string. Used for ids that must not name their content. */
export function hashId(text: string): string {
  const part = (salt: number) => hash32(text, salt).toString(16).padStart(8, "0");
  return part(0x9e3779b9) + part(0x85ebca6b);
}

/** A repeatable source of numbers in [0, 1) for a string seed. */
export function randomFor(seed: string): () => number {
  const random = seededRandom(hash32(seed));
  // The first few outputs of a small generator are weakly mixed for similar seeds.
  for (let index = 0; index < 4; index += 1) random();
  return random;
}

export function pick<T>(items: readonly T[], random: () => number): T {
  if (items.length === 0) throw new Error("Cannot pick from an empty list");
  return items[Math.floor(random() * items.length)];
}

/** A shuffled copy (Fisher-Yates). */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}
