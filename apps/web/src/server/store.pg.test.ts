// @vitest-environment node
// Runs against a real Postgres when TEST_DATABASE_URL is set, and is skipped
// otherwise. Locally: `docker compose up -d db`, then
// TEST_DATABASE_URL=postgres://arena:arena-local@localhost:5433/arena pnpm test:web
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { postgresStore, type NewDecision } from "@/server/store";
import { decision } from "@/test/decisions";

const url = process.env.TEST_DATABASE_URL;
const tag = `test-${randomUUID()}`;

function row(changes: Partial<NewDecision> = {}): NewDecision {
  const { created_at: _createdAt, ...base } = decision({
    round_id: `dr.${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    voter_id: randomUUID(),
    content_key: `${tag}|content`,
    confidence: "certain",
  });
  void _createdAt;
  return { ...base, ip_hash: tag, ...changes };
}

describe.skipIf(!url)("the Postgres store", () => {
  afterAll(async () => {
    const sql = postgres(url!, { onnotice: () => {} });
    await sql`DELETE FROM decisions WHERE ip_hash = ${tag}`;
    await sql`DELETE FROM rate_limit_counters WHERE bucket LIKE ${tag + "%"}`;
    await sql`DELETE FROM shares WHERE voter_id LIKE ${tag + "%"}`;
    await sql`DELETE FROM challenges WHERE voter_id LIKE ${tag + "%"}`;
    await sql.end();
  });

  it("stores a decision once per player per round and reads every field back", async () => {
    const store = postgresStore(url!);
    const mine = row({
      game: "wk.seed000001",
      round_index: 3,
      trap: true,
      points: 50,
      outcome: "right",
    });

    expect(await store.insertDecision(mine)).toBe(true);
    expect(await store.insertDecision({ ...mine, answer: { type: "accuse" } })).toBe(false);

    const stored = await store.decisionOn(mine.round_id, mine.voter_id);
    expect(stored).toMatchObject({
      mode: "drawing_room",
      kind: "duel",
      game: "wk.seed000001",
      round_index: 3,
      trap: true,
      confidence: "certain",
      answer: { type: "trust", choice: "A" },
      outcome: "right",
      points: 50,
    });
    expect(stored?.letters).toEqual(mine.letters);
    expect(stored?.letters[0]).toMatchObject({
      seat: "A",
      position: 0,
      guest: "constance",
      answer_words: 50,
    });
    expect(stored).not.toHaveProperty("ip_hash");
    expect(typeof stored?.created_at).toBe("string");
  });

  it("lists a player's decisions in order, and every player's on one pairing", async () => {
    const store = postgresStore(url!);
    const voter = randomUUID();
    const first = row({ voter_id: voter, content_key: `${tag}|pair` });
    const second = row({ voter_id: voter });
    const other = row({ content_key: `${tag}|pair` });
    for (const item of [first, second, other]) await store.insertDecision(item);

    expect((await store.decisionsBy(voter)).map((d) => d.round_id)).toEqual([
      first.round_id,
      second.round_id,
    ]);
    expect((await store.decisionsOnContent(`${tag}|pair`)).map((d) => d.voter_id).sort()).toEqual(
      [voter, other.voter_id].sort(),
    );
    expect((await store.allDecisions()).some((d) => d.round_id === other.round_id)).toBe(true);
  });

  it("keeps rate-limit counters across a restart and counts concurrent hits exactly", async () => {
    const window = new Date("2026-10-02T12:00:00Z");
    const before = postgresStore(url!);
    expect(await before.hit(`${tag}:bucket`, window)).toBe(1);
    expect(await before.hit(`${tag}:bucket`, window)).toBe(2);

    // A new process would build a new store with a new connection pool.
    const after = postgresStore(url!);
    expect(await after.hit(`${tag}:bucket`, window)).toBe(3);
    expect(await after.hit(`${tag}:bucket`, new Date("2026-10-02T12:10:00Z"))).toBe(1);

    const counts = await Promise.all(
      Array.from({ length: 20 }, () => after.hit(`${tag}:burst`, window)),
    );
    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("gives a player one share id, which is not their browser id", async () => {
    const store = postgresStore(url!);
    const voter = `${tag}-voter`;
    const shareId = await store.shareIdFor(voter);

    expect(await store.shareIdFor(voter)).toBe(shareId);
    expect(shareId).not.toContain(voter);
    expect(await store.voterForShare(shareId)).toBe(voter);
    expect(await store.voterForShare("nope")).toBeNull();
  });

  it("makes one challenge per player per seed", async () => {
    const store = postgresStore(url!);
    const voter = `${tag}-challenger`;
    const id = await store.createChallenge("seed000001", voter);

    expect(await store.createChallenge("seed000001", voter)).toBe(id);
    expect(await store.createChallenge("seed000002", voter)).not.toBe(id);
    expect(await store.challenge(id)).toEqual({ id, seed: "seed000001", voter_id: voter });
    expect(await store.challenge("nope")).toBeNull();
  });
});
