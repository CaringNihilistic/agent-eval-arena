// The decision log, share links, challenges, and rate-limit counters. All in
// Postgres, so they survive restarts and are shared between serverless instances.

import { randomBytes } from "node:crypto";

import postgres from "postgres";

// A plain module, so the migration script (scripts/db.mjs) can share it.
import { SCHEMA } from "../../db/schema.mjs";

import type { DecisionRecord } from "@/lib/types";

export interface NewDecision extends Omit<DecisionRecord, "created_at"> {
  ip_hash: string;
}

export interface Challenge {
  id: string;
  seed: string;
  voter_id: string;
}

export interface Store {
  /** This player's decision on a round, or null. */
  decisionOn(roundId: string, voterId: string): Promise<DecisionRecord | null>;
  /** Everything a player has decided, oldest first. */
  decisionsBy(voterId: string): Promise<DecisionRecord[]>;
  /** False if this player has already decided this round. */
  insertDecision(decision: NewDecision): Promise<boolean>;
  /** Every decision, oldest first: the order Elo is replayed in. */
  allDecisions(): Promise<DecisionRecord[]>;
  /** Every player's decisions on one pairing. */
  decisionsOnContent(contentKey: string): Promise<DecisionRecord[]>;
  /** Add one to a counter and return its new value, in one atomic statement. */
  hit(bucket: string, windowStart: Date): Promise<number>;
  /** The public id of a player's Casebook, made on first use. */
  shareIdFor(voterId: string): Promise<string>;
  voterForShare(shareId: string): Promise<string | null>;
  createChallenge(seed: string, voterId: string): Promise<string>;
  challenge(id: string): Promise<Challenge | null>;
}

/** A random id for a public link. It carries no information about the player. */
export function publicId(): string {
  return randomBytes(9).toString("base64url");
}

type DecisionRow = Omit<DecisionRecord, "created_at"> & { created_at: Date };

const COLUMNS = [
  "round_id",
  "voter_id",
  "mode",
  "kind",
  "game",
  "round_index",
  "content_key",
  "task_id",
  "task_category",
  "open_ended",
  "trap",
  "answer",
  "confidence",
  "letters",
  "outcome",
  "points",
  "created_at",
] as const;

function record(row: DecisionRow): DecisionRecord {
  return { ...row, created_at: row.created_at.toISOString() };
}

export function postgresStore(url: string): Store {
  // No prepared statements: the public database is reached through a connection
  // pooler (Neon's), which hands each statement to whichever connection is free.
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  let ready: Promise<unknown> | undefined;
  // Creating the tables is idempotent, so every process may do it on first use.
  const prepared = () => (ready ??= sql.unsafe(SCHEMA));
  const columns = sql(COLUMNS);

  return {
    async decisionOn(roundId, voterId) {
      await prepared();
      const rows = await sql<DecisionRow[]>`
        SELECT ${columns} FROM decisions WHERE round_id = ${roundId} AND voter_id = ${voterId}`;
      return rows[0] ? record(rows[0]) : null;
    },
    async decisionsBy(voterId) {
      await prepared();
      const rows = await sql<DecisionRow[]>`
        SELECT ${columns} FROM decisions WHERE voter_id = ${voterId} ORDER BY created_at, id`;
      return rows.map(record);
    },
    async insertDecision(decision) {
      await prepared();
      const rows = await sql`
        INSERT INTO decisions ${sql({
          round_id: decision.round_id,
          voter_id: decision.voter_id,
          ip_hash: decision.ip_hash,
          mode: decision.mode,
          kind: decision.kind,
          game: decision.game,
          round_index: decision.round_index,
          content_key: decision.content_key,
          task_id: decision.task_id,
          task_category: decision.task_category,
          open_ended: decision.open_ended,
          trap: decision.trap,
          answer: sql.json(decision.answer),
          confidence: decision.confidence,
          letters: sql.json(decision.letters as never),
          outcome: decision.outcome,
          points: decision.points,
        })}
        ON CONFLICT (round_id, voter_id) DO NOTHING
        RETURNING id`;
      return rows.length === 1;
    },
    async allDecisions() {
      await prepared();
      const rows = await sql<DecisionRow[]>`
        SELECT ${columns} FROM decisions ORDER BY created_at, id`;
      return rows.map(record);
    },
    async decisionsOnContent(contentKey) {
      await prepared();
      const rows = await sql<DecisionRow[]>`
        SELECT ${columns} FROM decisions WHERE content_key = ${contentKey} ORDER BY created_at, id`;
      return rows.map(record);
    },
    async hit(bucket, windowStart) {
      await prepared();
      const rows = await sql<{ count: number }[]>`
        INSERT INTO rate_limit_counters (bucket, window_start, count)
        VALUES (${bucket}, ${windowStart}, 1)
        ON CONFLICT (bucket, window_start)
        DO UPDATE SET count = rate_limit_counters.count + 1
        RETURNING count`;
      return rows[0].count;
    },
    async shareIdFor(voterId) {
      await prepared();
      const rows = await sql<{ share_id: string }[]>`
        INSERT INTO shares (share_id, voter_id) VALUES (${publicId()}, ${voterId})
        ON CONFLICT (voter_id) DO UPDATE SET voter_id = EXCLUDED.voter_id
        RETURNING share_id`;
      return rows[0].share_id;
    },
    async voterForShare(shareId) {
      await prepared();
      const rows = await sql<{ voter_id: string }[]>`
        SELECT voter_id FROM shares WHERE share_id = ${shareId}`;
      return rows[0]?.voter_id ?? null;
    },
    async createChallenge(seed, voterId) {
      await prepared();
      const rows = await sql<{ id: string }[]>`
        INSERT INTO challenges (id, seed, voter_id) VALUES (${publicId()}, ${seed}, ${voterId})
        ON CONFLICT (seed, voter_id) DO UPDATE SET seed = EXCLUDED.seed
        RETURNING id`;
      return rows[0].id;
    },
    async challenge(id) {
      await prepared();
      const rows = await sql<Challenge[]>`
        SELECT id, seed, voter_id FROM challenges WHERE id = ${id}`;
      return rows[0] ?? null;
    },
  };
}

let cached: Store | undefined;

export class StoreNotConfiguredError extends Error {}

/** The store for this server process. */
export function store(): Store {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new StoreNotConfiguredError(
        "DATABASE_URL is not set. Start Postgres with `docker compose up -d db` and set it in .env.",
      );
    }
    cached = postgresStore(url);
  }
  return cached;
}
