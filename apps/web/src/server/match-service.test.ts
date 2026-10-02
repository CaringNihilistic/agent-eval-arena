// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { MatchRecord, OfficialBenchmarks, PublicTask, RunHeader } from "@/lib/types";
import {
  castVote,
  hashIp,
  matchView,
  pickMatch,
  requireVoterId,
  ServiceError,
  VOTE_LIMITS,
} from "@/server/match-service";
import { loadRecordings, type Recordings } from "@/server/recordings";
import { findLeaks } from "@/test/leak-scan";
import { memoryStore } from "@/test/memory-store";
import { identifyingStrings, leftRun, rightRun, type FixtureRun } from "@/test/trace-fixtures";

const VOTER = "11111111-2222-4333-8444-555555555555";
const OTHER_VOTER = "99999999-2222-4333-8444-555555555555";
const TASK: PublicTask = {
  id: "math-01",
  title: "Boxes of screws",
  category: "agent",
  difficulty: "easy",
  prompt: "What is 37 boxes at $4.85 each?",
  required_tools: ["calculator"],
};
const OFFICIAL: OfficialBenchmarks = {
  checked: "2026-10-02",
  note: "n",
  sources: {
    s: { title: "t", url: "https://www.anthropic.com/x", published: "p", conditions: "c" },
  },
  benchmarks: [
    {
      id: "shared",
      name: "Shared",
      area: "a",
      scores: [
        { model: "claude-opus-5-5", value: 2, display: "2", source: "s" },
        { model: "claude-sonnet-5-5", value: 1, display: "1", source: "s" },
      ],
    },
    {
      id: "other",
      name: "Other",
      area: "a",
      scores: [{ model: "claude-sonnet-5-5", value: 1, display: "1", source: "s" }],
    },
  ],
};

function header(run: FixtureRun, passed: boolean, words: number): RunHeader {
  return {
    run_id: run.runId,
    config_id: run.config.id,
    config_name: run.config.family_id,
    display_name: run.config.display_name,
    model: run.config.model,
    task_id: TASK.id,
    category: "agent",
    stop_reason: "answered",
    passed,
    score: passed ? 1 : 0,
    scorer_type: "numeric_tolerance",
    checks_met: 0,
    checks_total: 0,
    answer_words: words,
    steps: 2,
    tool_calls: 1,
    prompt_tokens: 800,
    completion_tokens: 103,
    total_tokens: 903,
    cost_usd: 0,
    reference_cost_usd: 0.000871,
    latency_ms: 1730,
    wall_clock_ms: 2100,
    file: "runs/x.jsonl",
  };
}

function fixtureRecordings(matchIds: string[] = ["m_one"]): Recordings {
  const runs = new Map([
    [leftRun.runId, header(leftRun, true, 1)],
    [rightRun.runId, header(rightRun, false, 3)],
  ]);
  const events = new Map([
    [leftRun.runId, leftRun.events],
    [rightRun.runId, rightRun.events],
  ]);
  const matches: MatchRecord[] = matchIds.map((id) => ({
    id,
    task_id: TASK.id,
    category: "agent",
    left_run_id: leftRun.runId,
    right_run_id: rightRun.runId,
  }));
  return {
    runs,
    matches: new Map(matches.map((match) => [match.id, match])),
    tasks: new Map([[TASK.id, TASK]]),
    configs: [leftRun, rightRun].map((run) => ({
      id: run.config.id,
      display_name: run.config.display_name,
      model: run.config.model,
    })),
    official: OFFICIAL,
    events: (runId) => events.get(runId) ?? [],
  };
}

const secrets = [...identifyingStrings(leftRun), ...identifyingStrings(rightRun)];

async function status(action: Promise<unknown>): Promise<number | null> {
  try {
    await action;
    return null;
  } catch (error) {
    if (error instanceof ServiceError) return error.status;
    throw error;
  }
}

describe("a match before the vote", () => {
  it("is served blind: no model, score, cost, tokens, timing, or thinking", async () => {
    const view = await matchView(fixtureRecordings(), memoryStore(), "m_one", VOTER);

    expect(view.voted).toBe(false);
    expect(findLeaks(view, secrets)).toEqual([]);
    expect(Object.keys(view).sort()).toEqual(["match_id", "sides", "task", "voted"]);
  });

  it("is still blind for a voter after someone else has voted", async () => {
    const store = memoryStore();
    const recordings = fixtureRecordings();
    await castVote(recordings, store, {
      matchId: "m_one",
      voterId: OTHER_VOTER,
      choice: "left",
      ip: "1.1.1.1",
    });

    const view = await matchView(recordings, store, "m_one", VOTER);

    expect(view.voted).toBe(false);
    expect(findLeaks(view, secrets)).toEqual([]);
  });

  it("reports an unknown match as not found", async () => {
    expect(await status(matchView(fixtureRecordings(), memoryStore(), "nope", VOTER))).toBe(404);
  });
});

describe("voting", () => {
  it("returns the reveal: models, measured results, tallies, official scores", async () => {
    const store = memoryStore();
    const reveal = await castVote(fixtureRecordings(), store, {
      matchId: "m_one",
      voterId: VOTER,
      choice: "right",
      ip: "1.1.1.1",
    });

    expect(reveal.voted).toBe(true);
    expect(reveal.your_vote).toBe("right");
    expect(reveal.sides.left.config.model).toBe("claude-opus-5-5");
    expect(reveal.sides.right.config.model).toBe("claude-haiku-4-5");
    expect(reveal.sides.left.score?.passed).toBe(true);
    expect(reveal.sides.right.score?.passed).toBe(false);
    expect(reveal.sides.left.metrics.total_tokens).toBe(903);
    expect(reveal.sides.left.events.every((event) => event.side === "left")).toBe(true);
    expect(reveal.sides.left.events.some((event) => event.type === "score_computed")).toBe(true);
    expect(reveal.tallies).toEqual({ left: 0, right: 1, tie: 0, both_bad: 0 });
  });

  it("shows only the two models' official scores", async () => {
    const reveal = await castVote(fixtureRecordings(), memoryStore(), {
      matchId: "m_one",
      voterId: VOTER,
      choice: "tie",
      ip: "1.1.1.1",
    });

    // Opus is in the match, Sonnet is not: the Sonnet-only benchmark is dropped.
    expect(reveal.official.benchmarks.map((benchmark) => benchmark.id)).toEqual(["shared"]);
    expect(reveal.official.benchmarks[0].scores.map((score) => score.model)).toEqual([
      "claude-opus-5-5",
    ]);
  });

  it("stores the vote with both sides' pass state and answer lengths", async () => {
    const store = memoryStore();
    await castVote(fixtureRecordings(), store, {
      matchId: "m_one",
      voterId: VOTER,
      choice: "left",
      ip: "203.0.113.9",
    });

    expect(store.votes[0]).toMatchObject({
      match_id: "m_one",
      choice: "left",
      left_config_id: "claude-opus-full@v1",
      right_config_id: "claude-haiku-full@v1",
      left_passed: true,
      right_passed: false,
      left_answer_words: 1,
      right_answer_words: 3,
      task_category: "agent",
      open_ended: false,
    });
    // The address is stored only as a keyed hash.
    expect(JSON.stringify(store.votes)).not.toContain("203.0.113.9");
    expect(store.votes[0].ip_hash).toBe(hashIp("203.0.113.9"));
  });

  it("rejects a second vote on the same match and serves the reveal instead", async () => {
    const store = memoryStore();
    const recordings = fixtureRecordings();
    const input = { matchId: "m_one", voterId: VOTER, choice: "left" as const, ip: "1.1.1.1" };
    await castVote(recordings, store, input);

    expect(await status(castVote(recordings, store, { ...input, choice: "right" }))).toBe(409);
    expect(store.votes).toHaveLength(1);
    const view = await matchView(recordings, store, "m_one", VOTER);
    expect(view.voted && view.your_vote).toBe("left");
  });

  it("rejects a vote on a match that does not exist", async () => {
    const input = { matchId: "nope", voterId: VOTER, choice: "left" as const, ip: "1.1.1.1" };

    expect(await status(castVote(fixtureRecordings(), memoryStore(), input))).toBe(404);
  });

  it("accepts only a UUID as the voter id", () => {
    expect(requireVoterId(VOTER.toUpperCase())).toBe(VOTER);
    for (const bad of [null, "", "me", "' OR 1=1 --"]) {
      expect(() => requireVoterId(bad)).toThrow(ServiceError);
    }
  });
});

describe("rate limiting", () => {
  const ids = Array.from({ length: VOTE_LIMITS[0].max + 2 }, (_, index) => `m_${index}`);
  const now = new Date("2026-10-02T12:03:00Z");

  it("refuses votes past the limit for one address, and counts in the store", async () => {
    const store = memoryStore();
    const recordings = fixtureRecordings(ids);
    const vote = (matchId: string, ip: string) =>
      castVote(recordings, store, { matchId, voterId: VOTER, choice: "left", ip, now });

    for (const id of ids.slice(0, VOTE_LIMITS[0].max)) await vote(id, "1.1.1.1");

    expect(await status(vote(ids[VOTE_LIMITS[0].max], "1.1.1.1"))).toBe(429);
    expect(store.votes).toHaveLength(VOTE_LIMITS[0].max);
    // Another address is not affected.
    expect(await status(vote(ids[VOTE_LIMITS[0].max], "2.2.2.2"))).toBeNull();
  });

  it("keeps counting after a restart, because the counters are not in memory", async () => {
    const store = memoryStore();
    const first = fixtureRecordings(ids);
    for (const id of ids.slice(0, VOTE_LIMITS[0].max)) {
      await castVote(first, store, {
        matchId: id,
        voterId: VOTER,
        choice: "tie",
        ip: "1.1.1.1",
        now,
      });
    }

    // A new server process: fresh recordings object, same database.
    const restarted = fixtureRecordings(ids);
    const blocked = castVote(restarted, store, {
      matchId: ids[VOTE_LIMITS[0].max],
      voterId: VOTER,
      choice: "tie",
      ip: "1.1.1.1",
      now,
    });

    expect(await status(blocked)).toBe(429);
  });

  it("starts a new allowance in the next window", async () => {
    const store = memoryStore();
    const recordings = fixtureRecordings(ids);
    for (const id of ids.slice(0, VOTE_LIMITS[0].max)) {
      await castVote(recordings, store, {
        matchId: id,
        voterId: VOTER,
        choice: "tie",
        ip: "1.1.1.1",
        now,
      });
    }
    const later = new Date(now.getTime() + VOTE_LIMITS[0].windowMs);

    const vote = castVote(recordings, store, {
      matchId: ids[VOTE_LIMITS[0].max],
      voterId: VOTER,
      choice: "tie",
      ip: "1.1.1.1",
      now: later,
    });

    expect(await status(vote)).toBeNull();
  });
});

describe("picking a match", () => {
  it("never offers a match the voter has already voted on", async () => {
    const store = memoryStore();
    const recordings = fixtureRecordings(["m_a", "m_b"]);
    await castVote(recordings, store, { matchId: "m_a", voterId: VOTER, choice: "left", ip: "x" });

    for (const roll of [0, 0.5, 0.99]) {
      expect(await pickMatch(recordings, store, VOTER, null, () => roll)).toBe("m_b");
    }
    await castVote(recordings, store, { matchId: "m_b", voterId: VOTER, choice: "left", ip: "x" });
    expect(await pickMatch(recordings, store, VOTER, null)).toBeNull();
    expect(await pickMatch(recordings, store, OTHER_VOTER, null)).not.toBeNull();
  });

  it("respects the category", async () => {
    const recordings = fixtureRecordings();

    expect(await pickMatch(recordings, memoryStore(), VOTER, "agent")).toBe("m_one");
    expect(await pickMatch(recordings, memoryStore(), VOTER, "writing")).toBeNull();
  });
});

describe("the recorded matches in data/recordings", () => {
  const recordings = loadRecordings();

  it("has every model on every task, and every pair as a match", () => {
    expect(recordings.configs.map((config) => config.model).sort()).toEqual([
      "claude-haiku-4-5",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
    ]);
    expect(recordings.tasks.size).toBe(30);
    expect(recordings.runs.size).toBe(90);
    expect(recordings.matches.size).toBe(90);
  });

  it("serves every match blind: no model, config, run id, prompt, score, cost, or timing", async () => {
    const store = memoryStore();
    const leaks: string[] = [];
    for (const match of recordings.matches.values()) {
      const view = await matchView(recordings, store, match.id, VOTER);
      const runSecrets = [match.left_run_id, match.right_run_id].flatMap((runId) => {
        const run = recordings.runs.get(runId)!;
        const started = recordings.events(runId).find((event) => event.type === "run_started");
        const prompt = started?.type === "run_started" ? started.payload.config?.system_prompt : "";
        return [
          run.run_id,
          run.config_id,
          run.config_name,
          run.display_name,
          run.model,
          prompt ?? "",
        ];
      });
      for (const leak of findLeaks(view, runSecrets)) {
        leaks.push(`${match.id} ${leak.path}: ${leak.reason}`);
      }
    }

    expect(leaks).toEqual([]);
  });

  it("serves no blind match in which an agent names a Claude model", async () => {
    // Claude Code tells each model its own name, so a model could repeat it.
    const store = memoryStore();
    const named: string[] = [];
    for (const match of recordings.matches.values()) {
      const view = await matchView(recordings, store, match.id, VOTER);
      if (/claude|haiku|sonnet|opus|anthropic/i.test(JSON.stringify(view.sides))) {
        named.push(match.id);
      }
    }

    expect(named).toEqual([]);
  });

  it("does not put the two sides of a match in a fixed order", () => {
    const leftModels = new Set(
      [...recordings.matches.values()].map(
        (match) => recordings.runs.get(match.left_run_id)!.model,
      ),
    );

    expect(leftModels.size).toBe(3);
  });
});
