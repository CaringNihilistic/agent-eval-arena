// @vitest-environment node
// Runs against a real Postgres when TEST_DATABASE_URL is set, and is skipped
// otherwise. Locally: `docker compose up -d db`, then
// TEST_DATABASE_URL=postgres://arena:arena-local@localhost:5433/arena pnpm test:web
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { postgresStore, type NewVote } from "@/server/store";

const url = process.env.TEST_DATABASE_URL;
const tag = `test-${randomUUID()}`;

function vote(changes: Partial<NewVote> = {}): NewVote {
  return {
    match_id: `${tag}-match`,
    voter_id: randomUUID(),
    ip_hash: tag,
    choice: "left",
    left_config_id: "a@v1",
    right_config_id: "b@v1",
    left_passed: null,
    right_passed: null,
    left_answer_words: 40,
    right_answer_words: 55,
    task_id: "writing-01",
    task_category: "writing",
    open_ended: true,
    ...changes,
  };
}

describe.skipIf(!url)("the Postgres vote store", () => {
  afterAll(async () => {
    const sql = postgres(url!, { onnotice: () => {} });
    await sql`DELETE FROM votes WHERE ip_hash = ${tag}`;
    await sql`DELETE FROM rate_limit_counters WHERE bucket LIKE ${tag + "%"}`;
    await sql.end();
  });

  it("stores a vote once per voter per match and reads it back", async () => {
    const store = postgresStore(url!);
    const mine = vote();

    expect(await store.insertVote(mine)).toBe(true);
    expect(await store.insertVote({ ...mine, choice: "right" })).toBe(false);
    expect(await store.voteOn(mine.match_id, mine.voter_id)).toBe("left");
    expect(await store.votedMatchIds(mine.voter_id)).toEqual(new Set([mine.match_id]));

    const stored = (await store.allVotes()).find((row) => row.voter_id === mine.voter_id);
    expect(stored).toMatchObject({
      choice: "left",
      left_passed: null,
      left_answer_words: 40,
      right_answer_words: 55,
      open_ended: true,
      task_category: "writing",
    });
    expect(stored).not.toHaveProperty("ip_hash");
  });

  it("tallies every voter's vote on a match", async () => {
    const store = postgresStore(url!);
    const matchId = `${tag}-tally`;
    await store.insertVote(vote({ match_id: matchId, choice: "tie" }));
    await store.insertVote(vote({ match_id: matchId, choice: "right" }));

    expect((await store.votesOn(matchId)).sort()).toEqual(["right", "tie"]);
  });

  it("keeps rate-limit counters across a restart and across connections", async () => {
    const window = new Date("2026-10-02T12:00:00Z");
    const before = postgresStore(url!);
    expect(await before.hit(`${tag}:bucket`, window)).toBe(1);
    expect(await before.hit(`${tag}:bucket`, window)).toBe(2);

    // A new process would build a new store with a new connection pool.
    const after = postgresStore(url!);
    expect(await after.hit(`${tag}:bucket`, window)).toBe(3);
    // A different window starts again.
    expect(await after.hit(`${tag}:bucket`, new Date("2026-10-02T12:10:00Z"))).toBe(1);
  });

  it("counts concurrent hits without losing any", async () => {
    const store = postgresStore(url!);
    const window = new Date("2026-10-02T13:00:00Z");

    const counts = await Promise.all(
      Array.from({ length: 20 }, () => store.hit(`${tag}:burst`, window)),
    );

    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
