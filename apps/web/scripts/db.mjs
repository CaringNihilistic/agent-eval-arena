// Database chores for the public site: apply the schema, or remove the rows the
// end-to-end test left behind.
//
//   node scripts/db.mjs migrate   [--from NAME]
//   node scripts/db.mjs clean-e2e [--from NAME]
//
// The connection string is read from the environment variable NAME (default
// DATABASE_URL), or, if it is not set there, from the repository's git-ignored
// .env file. It is never printed and never written anywhere.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import postgres from "postgres";

import { SCHEMA } from "../db/schema.mjs";

/** Voter ids the end-to-end test uses, so its decisions can be told from real ones. */
export const E2E_VOTER_PREFIX = "e2e00000-0000-4000-8000-";

const [command, ...rest] = process.argv.slice(2);
const flag = rest.indexOf("--from");
const name = flag >= 0 ? rest[flag + 1] : "DATABASE_URL";

function connectionString() {
  if (process.env[name]) return process.env[name];
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env");
  const value = existsSync(file) ? parseEnv(readFileSync(file, "utf8"))[name] : undefined;
  if (!value) {
    console.error(`${name} is not set in the environment or in the repository's .env file.`);
    process.exit(2);
  }
  return value;
}

const url = connectionString();
const host = new URL(url).hostname;
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  if (command === "migrate") {
    await sql.unsafe(SCHEMA);
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`;
    console.log(
      `Schema applied on ${host}. Tables: ${tables.map((row) => row.table_name).join(", ")}`,
    );
  } else if (command === "clean-e2e") {
    const like = `${E2E_VOTER_PREFIX}%`;
    const decisions = await sql`DELETE FROM decisions WHERE voter_id LIKE ${like} RETURNING id`;
    const shares = await sql`DELETE FROM shares WHERE voter_id LIKE ${like} RETURNING share_id`;
    const challenges = await sql`DELETE FROM challenges WHERE voter_id LIKE ${like} RETURNING id`;
    console.log(
      `Removed the end-to-end test's rows on ${host}: ${decisions.length} decisions, ` +
        `${shares.length} share links, ${challenges.length} challenges.`,
    );
  } else {
    console.error("usage: node scripts/db.mjs <migrate|clean-e2e> [--from ENV_NAME]");
    process.exitCode = 2;
  }
} finally {
  await sql.end();
}
