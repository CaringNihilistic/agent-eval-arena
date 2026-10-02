import postgres from "postgres";

import { E2E_DATABASE_URL } from "../playwright.config";

/** Make an empty database for the run: create it if missing, and clear what an earlier run left. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(E2E_DATABASE_URL);
  const database = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(database)) throw new Error(`Unexpected database name ${database}`);

  const admin = new URL(E2E_DATABASE_URL);
  admin.pathname = "/postgres";
  const server = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  const existing = await server`SELECT 1 FROM pg_database WHERE datname = ${database}`;
  if (existing.length === 0) await server.unsafe(`CREATE DATABASE ${database}`);
  await server.end();

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe(
    "DROP TABLE IF EXISTS decisions, shares, challenges, rate_limit_counters CASCADE",
  );
  await sql.end();
}
