// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  agreement,
  buildLeaderboard,
  lengthBias,
  objectiveTable,
  officialRanking,
  positionBias,
} from "@/lib/leaderboard";
import type { OfficialBenchmarks, RunHeader, VoteRecord } from "@/lib/types";

const OFFICIAL = JSON.parse(
  readFileSync(join(process.cwd(), "..", "..", "data", "official-benchmarks.json"), "utf8"),
) as OfficialBenchmarks;

function run(changes: Partial<RunHeader>): RunHeader {
  return {
    run_id: "r",
    config_id: "opus@v1",
    config_name: "opus",
    display_name: "Opus",
    model: "claude-opus-5-5",
    task_id: "code-01",
    category: "code",
    stop_reason: "answered",
    passed: true,
    score: 1,
    scorer_type: "python_check",
    checks_met: 0,
    checks_total: 0,
    answer_words: 40,
    steps: 2,
    tool_calls: 1,
    prompt_tokens: 900,
    completion_tokens: 100,
    total_tokens: 1000,
    cost_usd: 0,
    reference_cost_usd: 0.01,
    latency_ms: 4000,
    wall_clock_ms: 5000,
    file: "runs/x.jsonl",
    ...changes,
  };
}

function vote(changes: Partial<VoteRecord>): VoteRecord {
  return {
    match_id: "m",
    voter_id: "v",
    choice: "left",
    left_config_id: "opus@v1",
    right_config_id: "haiku@v1",
    left_passed: true,
    right_passed: false,
    left_answer_words: 10,
    right_answer_words: 10,
    task_id: "code-01",
    task_category: "code",
    open_ended: false,
    created_at: "2026-10-02T00:00:00Z",
    ...changes,
  };
}

const openVote = (changes: Partial<VoteRecord>) =>
  vote({
    left_passed: null,
    right_passed: null,
    open_ended: true,
    task_category: "writing",
    ...changes,
  });

describe("our scorer's table", () => {
  const runs = [
    run({}),
    run({ passed: false, score: 0, reference_cost_usd: 0.03 }),
    run({
      category: "writing",
      scorer_type: "constraints",
      passed: null,
      score: 0.5,
      checks_met: 3,
      checks_total: 6,
      answer_words: 100,
    }),
  ];
  const [row, empty] = objectiveTable(runs, ["opus@v1", "haiku@v1"]);

  it("keeps pass rate to tasks with a right answer", () => {
    expect(row).toMatchObject({ runs: 3, scored_runs: 2, passes: 1, pass_rate: 0.5 });
    expect(row.pass_ci?.low).toBeLessThan(0.5);
    expect(row.passes_per_reference_dollar).toBeCloseTo(25, 6);
  });

  it("reports constraints met separately, as a share of checks", () => {
    expect(row).toMatchObject({ constraint_runs: 1, checks_met: 3, checks_total: 6 });
    expect(row.constraints_met_rate).toBe(0.5);
  });

  it("averages over every run", () => {
    expect(row.mean_score).toBeCloseTo(0.5, 6);
    expect(row.mean_answer_words).toBe(60);
  });

  it("shows a config with no runs as empty, not as zero", () => {
    expect(empty).toMatchObject({ runs: 0, pass_rate: null, pass_ci: null, mean_score: null });
    expect(empty.constraints_met_rate).toBeNull();
  });
});

describe("agreement between votes and the scorer", () => {
  it("counts only matches where exactly one side passed, and ties as disagreement", () => {
    const stat = agreement([
      vote({ choice: "left" }),
      vote({ choice: "right" }),
      vote({ choice: "tie" }),
      vote({ left_passed: false, right_passed: true, choice: "right" }),
      vote({ right_passed: true, choice: "left" }),
      vote({ left_passed: false, choice: "both_bad" }),
    ]);

    expect(stat.decisive_votes).toBe(4);
    expect(stat.agreeing_votes).toBe(2);
    expect(stat.agreement_rate).toBe(0.5);
    expect(stat.table.one_passed).toEqual({
      picked_passing: 2,
      picked_failing: 1,
      tie: 1,
      both_bad: 0,
    });
    expect(stat.table.both_passed.left).toBe(1);
    expect(stat.table.both_failed.both_bad).toBe(1);
  });

  it("ignores open-ended tasks, which have no pass or fail", () => {
    const stat = agreement([openVote({ choice: "left" }), openVote({ choice: "right" })]);

    expect(stat.decisive_votes).toBe(0);
    expect(stat.agreement_rate).toBeNull();
    expect(stat.ci).toBeNull();
  });
});

describe("length bias", () => {
  const votes = [
    openVote({ choice: "left", left_answer_words: 90, right_answer_words: 60 }),
    openVote({ choice: "right", left_answer_words: 90, right_answer_words: 60 }),
    openVote({ choice: "right", left_answer_words: 40, right_answer_words: 80 }),
    openVote({
      choice: "left",
      left_answer_words: 80,
      right_answer_words: 50,
      task_category: "explanation",
    }),
    // Left out: a tie, an equal-length pair, and a task with a right answer.
    openVote({ choice: "tie", left_answer_words: 90, right_answer_words: 60 }),
    openVote({ choice: "left", left_answer_words: 70, right_answer_words: 70 }),
    vote({ choice: "left", left_answer_words: 500, right_answer_words: 5 }),
  ];
  const bias = lengthBias(votes);

  it("reports how often the longer answer was picked", () => {
    expect(bias.overall).toMatchObject({ votes: 4, picks: 3, rate: 0.75 });
    expect(bias.excluded).toBe(2);
  });

  it("breaks the rate down by category", () => {
    expect(bias.by_category.writing).toMatchObject({ votes: 3, picks: 2 });
    expect(bias.by_category.explanation).toMatchObject({ votes: 1, picks: 1 });
    expect(bias.by_category.code).toBeUndefined();
  });

  it("has no rate without usable votes", () => {
    expect(lengthBias([]).overall).toEqual({ votes: 0, picks: 0, rate: null, ci: null });
  });
});

describe("position bias", () => {
  it("is the share of left-or-right votes that picked the left pane", () => {
    const bias = positionBias([
      vote({ choice: "left" }),
      vote({ choice: "left" }),
      vote({ choice: "right" }),
      vote({ choice: "tie" }),
    ]);

    expect(bias).toMatchObject({ votes: 3, picks: 2 });
  });
});

describe("official ranking from Anthropic's published scores", () => {
  const models = ["claude-haiku-4-5", "claude-opus-5-5", "claude-sonnet-5-5"];
  const standings = officialRanking(OFFICIAL, models);
  const of = (model: string) => standings.find((row) => row.model === model)!;

  it("puts Opus 5.5 ahead of Sonnet 5.5 on the benchmarks they share", () => {
    const opusVsSonnet = of("claude-opus-5-5").versus.find(
      (record) => record.model === "claude-sonnet-5-5",
    );

    expect(opusVsSonnet).toEqual({ model: "claude-sonnet-5-5", shared: 8, wins: 7, losses: 1 });
    expect(of("claude-opus-5-5").rank).toBe(1);
    expect(of("claude-sonnet-5-5").rank).toBe(2);
  });

  it("gives Haiku 4.5 no rank, because it shares no benchmark with the others", () => {
    expect(of("claude-haiku-4-5").rank).toBeNull();
    expect(of("claude-haiku-4-5").versus.every((record) => record.shared === 0)).toBe(true);
  });

  it("reads a data file in which every score names a listed source", () => {
    expect(OFFICIAL.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const benchmark of OFFICIAL.benchmarks) {
      for (const score of benchmark.scores) {
        expect(OFFICIAL.sources[score.source]?.url).toMatch(/^https:\/\/www\.anthropic\.com\//);
        expect(score.display).toContain(String(score.value).replace(/\.0$/, ""));
      }
    }
  });
});

describe("the whole leaderboard", () => {
  const configs = [
    { id: "opus@v1", display_name: "Opus", model: "claude-opus-5-5" },
    { id: "haiku@v1", display_name: "Haiku", model: "claude-haiku-4-5" },
  ];
  const runs = [
    run({}),
    run({ config_id: "haiku@v1", model: "claude-haiku-4-5", passed: false, score: 0 }),
    run({ category: "writing", scorer_type: "constraints", passed: null, score: 0.5 }),
    run({
      config_id: "haiku@v1",
      category: "writing",
      scorer_type: "constraints",
      passed: null,
      score: 1,
    }),
  ];
  const votes = [vote({ choice: "right" }), openVote({ choice: "left" })];

  it("puts the three rankings side by side", () => {
    const board = buildLeaderboard(runs, votes, OFFICIAL, configs, null);
    const opus = board.headline.find((row) => row.config === "opus@v1");
    const haiku = board.headline.find((row) => row.config === "haiku@v1");

    expect(board.votes).toBe(2);
    // One win each, so the ratings differ only by order of play.
    expect(opus?.elo_rank).not.toBeNull();
    expect(opus?.official_rank).toBeNull();
    expect(haiku?.official_rank).toBeNull();
    expect(opus?.scorer_rank).toBe(1);
    expect(haiku?.scorer_rank).toBe(2);
  });

  it("filters runs and votes by category", () => {
    const board = buildLeaderboard(runs, votes, OFFICIAL, configs, "writing");
    const haiku = board.headline.find((row) => row.config === "haiku@v1");

    expect(board.votes).toBe(1);
    expect(haiku?.scorer_rank).toBe(1);
    expect(board.objective.every((row) => row.scored_runs === 0)).toBe(true);
    expect(board.agreement.decisive_votes).toBe(0);
  });

  it("shows no vote rank before anyone has voted", () => {
    const board = buildLeaderboard(runs, [], OFFICIAL, configs, null);

    expect(board.headline.every((row) => row.elo_rank === null && row.votes === 0)).toBe(true);
  });
});
