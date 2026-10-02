// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { eloRatings } from "@/lib/elo";
import {
  agreement,
  buildLeaderboard,
  costumeBias,
  eloVotes,
  lengthBias,
  MIN_BIAS_VOTES,
  modelTotals,
  objectiveTable,
  officialRanking,
  positionBias,
  rankingToPairwise,
  runVariance,
} from "@/lib/leaderboard";
import type { OfficialBenchmarks, RunHeader } from "@/lib/types";
import { decision, HAIKU, letter, OPUS, SONNET } from "@/test/decisions";

const OFFICIAL = JSON.parse(
  readFileSync(join(process.cwd(), "..", "..", "data", "official-benchmarks.json"), "utf8"),
) as OfficialBenchmarks;

const ranking = (order: ("A" | "B" | "C")[]) =>
  decision({
    mode: "library",
    kind: "ranking",
    answer: { type: "ranking", order },
    letters: [letter("A", OPUS), letter("B", SONNET), letter("C", HAIKU)],
  });

describe("a ranking as pairwise results", () => {
  it("makes three results from three letters: each beats those ranked below it", () => {
    expect(rankingToPairwise(["x", "y", "z"])).toEqual([
      { winner: "x", loser: "y" },
      { winner: "x", loser: "z" },
      { winner: "y", loser: "z" },
    ]);
  });

  it("feeds Elo three wins tagged with the mode", () => {
    const votes = eloVotes([ranking(["C", "A", "B"])]);

    expect(votes).toEqual([
      { left: `${HAIKU}@v1`, right: `${OPUS}@v1`, choice: "left", mode: "library" },
      { left: `${HAIKU}@v1`, right: `${SONNET}@v1`, choice: "left", mode: "library" },
      { left: `${OPUS}@v1`, right: `${SONNET}@v1`, choice: "left", mode: "library" },
    ]);
  });
});

describe("which decisions count toward Elo", () => {
  it("counts Drawing Room preferences, with each choice mapped to a result", () => {
    const votes = eloVotes([
      decision({ answer: { type: "trust", choice: "A" } }),
      decision({ answer: { type: "trust", choice: "B" } }),
      decision({ answer: { type: "trust", choice: "equal" } }),
      decision({ answer: { type: "trust", choice: "neither" } }),
    ]);

    expect(votes.map((vote) => vote.choice)).toEqual(["left", "right", "tie", "both_bad"]);
    expect(votes.every((vote) => vote.left === `${OPUS}@v1` && vote.mode === "drawing_room")).toBe(
      true,
    );
  });

  it("never counts a trap round", () => {
    const trap = decision({
      trap: true,
      letters: [letter("A", OPUS), letter("B", OPUS)],
      outcome: "wrong",
    });

    expect(eloVotes([trap])).toEqual([]);
  });

  it("never counts the Weekend, the Morning Post, or the Timetable", () => {
    const elsewhere = (["weekend", "morning_post", "timetable"] as const).map((mode) =>
      decision({ mode }),
    );

    expect(eloVotes(elsewhere)).toEqual([]);
  });

  it("does not count an accusation as a preference", () => {
    expect(
      eloVotes([decision({ answer: { type: "accuse" }, outcome: "wrong", points: -30 })]),
    ).toEqual([]);
    expect(
      eloVotes([decision({ mode: "library", kind: "ranking", answer: { type: "accuse" } })]),
    ).toEqual([]);
  });

  it("leaves the ratings untouched by trap and Weekend votes", () => {
    const real = [decision({}), ranking(["A", "B", "C"])];
    const noise = [
      decision({ trap: true, letters: [letter("A", OPUS), letter("B", OPUS)] }),
      decision({ mode: "weekend", answer: { type: "trust", choice: "B" } }),
    ];

    expect(eloRatings(eloVotes([...real, ...noise]))).toEqual(eloRatings(eloVotes(real)));
  });
});

describe("costume bias", () => {
  it("reports, per guest, how often that guest's letter was the one trusted", () => {
    const votes = [
      decision({ answer: { type: "trust", choice: "A" } }), // constance trusted over pike
      decision({ answer: { type: "trust", choice: "A" } }),
      decision({ answer: { type: "trust", choice: "B" } }), // pike trusted
      decision({ answer: { type: "trust", choice: "equal" } }), // not a sided vote
    ];
    const rows = costumeBias(votes);
    const of = (guest: string) => rows.find((row) => row.guest === guest)!;

    expect(of("constance")).toMatchObject({ votes: 3, picks: 2 });
    expect(of("pike")).toMatchObject({ votes: 3, picks: 1 });
    expect(of("ivy")).toMatchObject({ votes: 0, picks: 0, rate: null });
    expect(rows).toHaveLength(6);
  });

  it("includes trap rounds, where the author is the same and only the costume differs", () => {
    const trap = decision({
      trap: true,
      letters: [letter("A", OPUS), letter("B", OPUS)],
      answer: { type: "trust", choice: "B" },
    });

    expect(costumeBias([trap]).find((row) => row.guest === "pike")).toMatchObject({
      votes: 1,
      picks: 1,
    });
  });
});

describe("position bias", () => {
  it("is the share of sided votes that trusted the first letter shown", () => {
    const bias = positionBias([
      decision({ answer: { type: "trust", choice: "A" } }),
      decision({ answer: { type: "trust", choice: "A" } }),
      decision({ answer: { type: "trust", choice: "B" } }),
      decision({ answer: { type: "trust", choice: "neither" } }),
      decision({ answer: { type: "accuse" } }),
    ]);

    expect(bias).toMatchObject({ votes: 3, picks: 2 });
  });
});

describe("length bias", () => {
  const pair = (a: number, b: number) => [
    letter("A", OPUS, { answer_words: a }),
    letter("B", HAIKU, { answer_words: b }),
  ];

  it("reports how often the longer letter was trusted, on open-ended tasks", () => {
    const bias = lengthBias([
      decision({ letters: pair(90, 60), answer: { type: "trust", choice: "A" } }),
      decision({ letters: pair(90, 60), answer: { type: "trust", choice: "B" } }),
      decision({ letters: pair(40, 80), answer: { type: "trust", choice: "B" } }),
      // Left out: equal lengths, "equally good", a task with a right answer, a trap.
      decision({ letters: pair(70, 70), answer: { type: "trust", choice: "A" } }),
      decision({ letters: pair(90, 60), answer: { type: "trust", choice: "equal" } }),
      decision({ letters: pair(500, 5), open_ended: false }),
      decision({ letters: pair(500, 5), trap: true }),
    ]);

    expect(bias.overall).toMatchObject({ votes: 3, picks: 2 });
    expect(bias.excluded).toBe(2);
  });
});

describe("agreement between votes and the scorer", () => {
  const scored = (a: boolean, b: boolean, choice: "A" | "B" | "equal") =>
    decision({
      open_ended: false,
      task_category: "code",
      letters: [letter("A", OPUS, { passed: a }), letter("B", HAIKU, { passed: b })],
      answer: { type: "trust", choice },
    });

  it("counts only rounds where exactly one letter passed", () => {
    const stat = agreement([
      scored(true, false, "A"),
      scored(true, false, "B"),
      scored(false, true, "B"),
      scored(true, false, "equal"),
      scored(true, true, "A"),
      decision({}),
    ]);

    expect(stat).toMatchObject({ decisive_votes: 4, agreeing_votes: 2, agreement_rate: 0.5 });
  });

  it("ignores traps and modes that do not count toward the record", () => {
    const weekend = { ...scored(true, false, "A"), mode: "weekend" as const };
    const trap = { ...scored(true, false, "A"), trap: true };

    expect(agreement([weekend, trap]).decisive_votes).toBe(0);
  });
});

function run(changes: Partial<RunHeader>): RunHeader {
  return {
    run_id: "r",
    config_id: "opus@v1",
    config_name: "opus",
    display_name: "Opus",
    model: OPUS,
    task_id: "code-01",
    take: 1,
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

/** One author's three runs of a small bank: two scored tasks and one open-ended. */
function bank(config: string, perTake: { passes: boolean[]; met: number }[]): RunHeader[] {
  return perTake.flatMap(({ passes, met }, index) => [
    ...passes.map((passed, task) =>
      run({
        config_id: config,
        take: index + 1,
        task_id: `code-0${task + 1}`,
        passed,
        score: passed ? 1 : 0,
      }),
    ),
    run({
      config_id: config,
      take: index + 1,
      task_id: "writing-01",
      category: "writing",
      scorer_type: "constraints",
      passed: null,
      score: met / 4,
      checks_met: met,
      checks_total: 4,
      answer_words: 100,
    }),
  ]);
}

describe("our scorer's totals", () => {
  const runs = bank("opus@v1", [
    { passes: [true, true], met: 4 },
    { passes: [true, false], met: 2 },
    { passes: [true, true], met: 3 },
  ]);

  it("span every run, with the lowest and highest count in any one run", () => {
    const totals = modelTotals(runs, "opus@v1");

    expect(totals).toMatchObject({ takes: 3, scored_tasks: 2, checks_total: 4 });
    expect(totals.passes).toEqual({ mean: 5 / 3, min: 1, max: 2 });
    expect(totals.checks_met).toEqual({ mean: 3, min: 2, max: 4 });
    expect(totals.mean_answer_words).toBe(60);
  });

  it("give rates over all runs, and keep pass rate and rules met apart", () => {
    const [row, empty] = objectiveTable(runs, ["opus@v1", "haiku@v1"]);

    expect(row.runs).toBe(9);
    expect(row.pass_rate).toBeCloseTo(5 / 6, 6);
    expect(row.constraints_met_rate).toBe(0.75);
    expect(row.mean_score).toBeCloseTo((5 + 2.25) / 9, 6);
    expect(empty).toMatchObject({ runs: 0, takes: 0, pass_rate: null, mean_score: null });
  });

  it("is the single run's own figures when the bank was run once", () => {
    const once = modelTotals(
      runs.filter((item) => item.take === 1),
      "opus@v1",
    );

    expect(once.takes).toBe(1);
    expect(once.passes).toEqual({ mean: 2, min: 2, max: 2 });
  });
});

describe("how much a model varies between identical runs", () => {
  const steady = bank("steady@v1", [
    { passes: [true, true], met: 4 },
    { passes: [true, true], met: 4 },
    { passes: [true, true], met: 4 },
  ]);
  const shaky = bank("shaky@v1", [
    { passes: [true, true], met: 4 },
    { passes: [true, false], met: 2 },
    { passes: [true, true], met: 3 },
  ]);
  const [steadyRow, shakyRow] = runVariance([...steady, ...shaky], ["steady@v1", "shaky@v1"]);

  it("is zero for a model that scores the same every time", () => {
    expect(steadyRow).toMatchObject({
      takes: 3,
      tasks: 3,
      tasks_varying: 0,
      mean_spread: 0,
      max_spread: 0,
    });
    expect(steadyRow.bank_score).toEqual({ mean: 1, min: 1, max: 1 });
  });

  it("counts the tasks whose score changed and the gap between best and worst run", () => {
    // code-02 went from pass to fail (gap 1); writing-01 from 4 of 4 to 2 of 4 (gap 0.5).
    expect(shakyRow).toMatchObject({ takes: 3, tasks: 3, tasks_varying: 2, max_spread: 1 });
    expect(shakyRow.mean_spread).toBeCloseTo(0.5, 6);
    expect(shakyRow.bank_score.max).toBe(1);
    expect(shakyRow.bank_score.min).toBeCloseTo(0.5, 6);
  });

  it("has nothing to report for a bank run once", () => {
    const [row] = runVariance(
      steady.filter((item) => item.take === 1),
      ["steady@v1"],
    );

    expect(row).toMatchObject({
      takes: 1,
      tasks: 0,
      tasks_varying: 0,
      mean_spread: null,
      max_spread: null,
    });
  });

  it("is part of the record, and follows the category filter", () => {
    const configs = [{ id: "shaky@v1", display_name: "Shaky", model: "m" }];
    const all = buildLeaderboard(shaky, [], OFFICIAL, configs, null);
    const code = buildLeaderboard(shaky, [], OFFICIAL, configs, "code");

    expect(all.variance[0].tasks).toBe(3);
    expect(code.variance[0]).toMatchObject({ tasks: 2, tasks_varying: 1 });
  });
});

describe("official ranking from Anthropic's published scores", () => {
  const standings = officialRanking(OFFICIAL, [HAIKU, OPUS, SONNET]);
  const of = (model: string) => standings.find((row) => row.model === model)!;

  it("puts Opus 5.5 ahead of Sonnet 5.5 on the benchmarks they share", () => {
    expect(of(OPUS).versus.find((record) => record.model === SONNET)).toEqual({
      model: SONNET,
      shared: 8,
      wins: 7,
      losses: 1,
    });
    expect(of(OPUS).rank).toBe(1);
    expect(of(SONNET).rank).toBe(2);
  });

  it("gives Haiku 4.5 no rank, because it shares no benchmark with the others", () => {
    expect(of(HAIKU).rank).toBeNull();
  });

  it("reads a data file in which every score names a listed source", () => {
    expect(OFFICIAL.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const benchmark of OFFICIAL.benchmarks) {
      for (const score of benchmark.scores) {
        expect(OFFICIAL.sources[score.source]?.url).toMatch(/^https:\/\/www\.anthropic\.com\//);
      }
    }
  });
});

describe("the whole record", () => {
  const configs = [
    { id: `${OPUS}@v1`, display_name: "Opus", model: OPUS },
    { id: `${HAIKU}@v1`, display_name: "Haiku", model: HAIKU },
  ];
  const sided = (count: number) => Array.from({ length: count }, () => decision({}));

  it("holds back costume and position bias until there are enough votes", () => {
    const few = buildLeaderboard([], sided(MIN_BIAS_VOTES - 1), OFFICIAL, configs, null);
    const enough = buildLeaderboard([], sided(MIN_BIAS_VOTES), OFFICIAL, configs, null);

    expect(few.costume_bias).toBeNull();
    expect(few.position_bias).toBeNull();
    expect(few).toMatchObject({
      bias_votes: MIN_BIAS_VOTES - 1,
      bias_votes_needed: MIN_BIAS_VOTES,
    });
    expect(enough.costume_bias).toHaveLength(6);
    expect(enough.position_bias).toMatchObject({ votes: MIN_BIAS_VOTES, picks: MIN_BIAS_VOTES });
  });

  it("counts comparisons by mode and filters by category", () => {
    const board = buildLeaderboard(
      [],
      [decision({}), ranking(["A", "B", "C"]), decision({ task_category: "code" })],
      OFFICIAL,
      configs,
      null,
    );
    const code = buildLeaderboard(
      [],
      [decision({}), decision({ task_category: "code" })],
      OFFICIAL,
      configs,
      "code",
    );

    expect(board.votes).toBe(5);
    expect(board.votes_by_mode).toEqual({ drawing_room: 2, library: 3 });
    expect(code.votes).toBe(1);
  });

  it("shows no vote rank before anyone has voted", () => {
    const board = buildLeaderboard([], [], OFFICIAL, configs, null);

    expect(board.headline.every((row) => row.elo_rank === null && row.votes === 0)).toBe(true);
  });
});
