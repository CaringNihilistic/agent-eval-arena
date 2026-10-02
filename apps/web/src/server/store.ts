// The vote log and the rate-limit counters. Both live in Postgres so they survive
// restarts and are shared between serverless instances.

import postgres from "postgres";

import type { Choice } from "@/lib/elo";
import type { Category, VoteRecord } from "@/lib/types";

export interface NewVote extends Omit<VoteRecord, "created_at"> {
  ip_hash: string;
}

export interface VoteStore {
  /** The voter's vote on this match, or null. */
  voteOn(matchId: string, voterId: string): Promise<Choice | null>;
  votedMatchIds(voterId: string): Promise<Set<string>>;
  /** False if this voter has already voted on this match. */
  insertVote(vote: NewVote): Promise<boolean>;
  /** Every vote, oldest first: the order Elo is replayed in. */
  allVotes(): Promise<VoteRecord[]>;
  votesOn(matchId: string): Promise<Choice[]>;
  /** Add one to a counter and return its new value, in one atomic statement. */
  hit(bucket: string, windowStart: Date): Promise<number>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS votes (
  id bigserial PRIMARY KEY,
  match_id text NOT NULL,
  voter_id text NOT NULL,
  ip_hash text NOT NULL,
  choice text NOT NULL CHECK (choice IN ('left', 'right', 'tie', 'both_bad')),
  left_config_id text NOT NULL,
  right_config_id text NOT NULL,
  left_passed boolean,
  right_passed boolean,
  left_answer_words integer NOT NULL,
  right_answer_words integer NOT NULL,
  task_id text NOT NULL,
  task_category text NOT NULL,
  open_ended boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, voter_id)
);
CREATE INDEX IF NOT EXISTS votes_voter ON votes (voter_id);
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
`;

interface VoteRow {
  match_id: string;
  voter_id: string;
  choice: Choice;
  left_config_id: string;
  right_config_id: string;
  left_passed: boolean | null;
  right_passed: boolean | null;
  left_answer_words: number;
  right_answer_words: number;
  task_id: string;
  task_category: Category;
  open_ended: boolean;
  created_at: Date;
}

export function postgresStore(url: string): VoteStore {
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  let ready: Promise<unknown> | undefined;
  // Creating the tables is idempotent, so every process may do it on first use.
  const prepared = () => (ready ??= sql.unsafe(SCHEMA));

  return {
    async voteOn(matchId, voterId) {
      await prepared();
      const rows = await sql<{ choice: Choice }[]>`
        SELECT choice FROM votes WHERE match_id = ${matchId} AND voter_id = ${voterId}`;
      return rows[0]?.choice ?? null;
    },
    async votedMatchIds(voterId) {
      await prepared();
      const rows = await sql<{ match_id: string }[]>`
        SELECT match_id FROM votes WHERE voter_id = ${voterId}`;
      return new Set(rows.map((row) => row.match_id));
    },
    async insertVote(vote) {
      await prepared();
      const rows = await sql`
        INSERT INTO votes ${sql(
          vote,
          "match_id",
          "voter_id",
          "ip_hash",
          "choice",
          "left_config_id",
          "right_config_id",
          "left_passed",
          "right_passed",
          "left_answer_words",
          "right_answer_words",
          "task_id",
          "task_category",
          "open_ended",
        )}
        ON CONFLICT (match_id, voter_id) DO NOTHING
        RETURNING id`;
      return rows.length === 1;
    },
    async allVotes() {
      await prepared();
      const rows = await sql<VoteRow[]>`
        SELECT match_id, voter_id, choice, left_config_id, right_config_id, left_passed,
               right_passed, left_answer_words, right_answer_words, task_id, task_category,
               open_ended, created_at
        FROM votes ORDER BY created_at, id`;
      return rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
    },
    async votesOn(matchId) {
      await prepared();
      const rows = await sql<{ choice: Choice }[]>`
        SELECT choice FROM votes WHERE match_id = ${matchId}`;
      return rows.map((row) => row.choice);
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
  };
}

let cached: VoteStore | undefined;

export class StoreNotConfiguredError extends Error {}

/** The vote store for this server process. */
export function voteStore(): VoteStore {
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
