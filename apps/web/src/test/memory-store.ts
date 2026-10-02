// An in-memory vote store for tests. It keeps the same rules as the Postgres one:
// one vote per voter per match, and counters that only ever go up.

import type { VoteRecord } from "@/lib/types";
import type { NewVote, VoteStore } from "@/server/store";

export interface MemoryStore extends VoteStore {
  votes: (NewVote & { created_at: string })[];
  counters: Map<string, number>;
}

export function memoryStore(): MemoryStore {
  const votes: MemoryStore["votes"] = [];
  const counters = new Map<string, number>();
  return {
    votes,
    counters,
    async voteOn(matchId, voterId) {
      return (
        votes.find((vote) => vote.match_id === matchId && vote.voter_id === voterId)?.choice ?? null
      );
    },
    async votedMatchIds(voterId) {
      return new Set(votes.filter((vote) => vote.voter_id === voterId).map((v) => v.match_id));
    },
    async insertVote(vote) {
      if (votes.some((v) => v.match_id === vote.match_id && v.voter_id === vote.voter_id)) {
        return false;
      }
      votes.push({ ...vote, created_at: new Date(1_790_000_000_000 + votes.length).toISOString() });
      return true;
    },
    async allVotes() {
      return votes.map((stored) => {
        const vote: Partial<typeof stored> = { ...stored };
        delete vote.ip_hash;
        return vote as VoteRecord;
      });
    },
    async votesOn(matchId) {
      return votes.filter((vote) => vote.match_id === matchId).map((vote) => vote.choice);
    },
    async hit(bucket, windowStart) {
      const key = `${bucket}@${windowStart.toISOString()}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return count;
    },
  };
}
