// The database schema: the decision log, share links, challenges, and rate-limit
// counters. Every statement is idempotent, so applying it twice changes nothing.
// Used by the server (src/server/store.ts) on first use, and by scripts/migrate.mjs.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id bigserial PRIMARY KEY,
  round_id text NOT NULL,
  voter_id text NOT NULL,
  ip_hash text NOT NULL,
  mode text NOT NULL,
  kind text NOT NULL,
  game text,
  round_index integer,
  content_key text NOT NULL,
  task_id text NOT NULL,
  task_category text NOT NULL,
  open_ended boolean NOT NULL,
  trap boolean NOT NULL,
  answer jsonb NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('hunch', 'fairly', 'certain')),
  letters jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('right', 'wrong', 'none')),
  points integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, voter_id)
);
CREATE INDEX IF NOT EXISTS decisions_voter ON decisions (voter_id);
CREATE INDEX IF NOT EXISTS decisions_content ON decisions (content_key);
CREATE TABLE IF NOT EXISTS shares (
  share_id text PRIMARY KEY,
  voter_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS challenges (
  id text PRIMARY KEY,
  seed text NOT NULL,
  voter_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seed, voter_id)
);
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
`;
