// An in-memory store for tests. It keeps the same rules as the Postgres one:
// one decision per player per round, counters that only go up, one share id per
// player, one challenge per player per seed.

import type { DecisionRecord } from "@/lib/types";
import type { Challenge, NewDecision, Store } from "@/server/store";

export interface MemoryStore extends Store {
  rows: (DecisionRecord & { ip_hash: string })[];
  counters: Map<string, number>;
}

export function memoryStore(): MemoryStore {
  const rows: MemoryStore["rows"] = [];
  const counters = new Map<string, number>();
  const shares = new Map<string, string>();
  const challenges: Challenge[] = [];
  const strip = (row: MemoryStore["rows"][number]): DecisionRecord => {
    const copy: Partial<typeof row> = { ...row };
    delete copy.ip_hash;
    return copy as DecisionRecord;
  };
  return {
    rows,
    counters,
    async decisionOn(roundId, voterId) {
      const row = rows.find((item) => item.round_id === roundId && item.voter_id === voterId);
      return row ? strip(row) : null;
    },
    async decisionsBy(voterId) {
      return rows.filter((row) => row.voter_id === voterId).map(strip);
    },
    async insertDecision(decision: NewDecision) {
      if (
        rows.some((row) => row.round_id === decision.round_id && row.voter_id === decision.voter_id)
      ) {
        return false;
      }
      rows.push({
        ...decision,
        created_at: new Date(1_790_000_000_000 + rows.length * 1000).toISOString(),
      });
      return true;
    },
    async allDecisions() {
      return rows.map(strip);
    },
    async decisionsOnContent(contentKey) {
      return rows.filter((row) => row.content_key === contentKey).map(strip);
    },
    async hit(bucket, windowStart) {
      const key = `${bucket}@${windowStart.toISOString()}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return count;
    },
    async shareIdFor(voterId) {
      for (const [shareId, owner] of shares) if (owner === voterId) return shareId;
      const shareId = `share-${shares.size + 1}`;
      shares.set(shareId, voterId);
      return shareId;
    },
    async voterForShare(shareId) {
      return shares.get(shareId) ?? null;
    },
    async createChallenge(seed, voterId) {
      const existing = challenges.find((item) => item.seed === seed && item.voter_id === voterId);
      if (existing) return existing.id;
      const id = `challenge-${challenges.length + 1}`;
      challenges.push({ id, seed, voter_id: voterId });
      return id;
    },
    async challenge(id) {
      return challenges.find((item) => item.id === id) ?? null;
    },
  };
}
