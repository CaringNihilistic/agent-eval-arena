// Finds anything in a payload that a voter must not see before voting.
// Shared by every test that checks a blind response, so the rule is written once.

/** Keys that must be absent or null in anything sent before the vote. */
export const WITHHELD_KEYS = [
  "config",
  "model",
  "prompt_tokens",
  "completion_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_tokens",
  "cost_usd",
  "reference_cost_usd",
  "passed",
  "score",
  "scorer_type",
  "explanation",
] as const;

export interface Leak {
  path: string;
  reason: string;
}

/**
 * Walks `value` and reports every withheld key that holds a value, and every
 * place one of the `secrets` strings appears (model names, config names, run
 * ids, the system prompt).
 */
export function findLeaks(value: unknown, secrets: readonly string[], path = "$"): Leak[] {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return secrets
      .filter((secret) => secret.length > 0 && lower.includes(secret.toLowerCase()))
      .map((secret) => ({ path, reason: `contains "${secret}"` }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findLeaks(item, secrets, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = `${path}.${key}`;
      const withheld = (WITHHELD_KEYS as readonly string[]).includes(key);
      const own: Leak[] =
        withheld && child !== null && child !== undefined
          ? [{ path: childPath, reason: `"${key}" has a value` }]
          : [];
      return [...own, ...findLeaks(child, secrets, childPath)];
    });
  }
  return [];
}
