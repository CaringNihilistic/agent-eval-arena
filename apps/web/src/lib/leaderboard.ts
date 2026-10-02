// Everything the leaderboard page shows, computed from the recorded runs, the
// vote log, and Anthropic's published benchmark scores. The only implementation
// of each statistic in the project.

import { eloTable, type EloRow } from "@/lib/elo";
import { mean, rankDescending, wilson, type Interval } from "@/lib/stats";
import type { Category, OfficialBenchmarks, RunHeader, VoteRecord } from "@/lib/types";

export interface ObjectiveRow {
  config: string;
  runs: number;
  /** Runs on tasks with a right answer (code and agent). */
  scored_runs: number;
  passes: number;
  pass_rate: number | null;
  pass_ci: Interval | null;
  /** Runs on open-ended tasks, scored by constraint checks. */
  constraint_runs: number;
  checks_met: number;
  checks_total: number;
  /** Share of stated limits respected. Not a measure of quality. */
  constraints_met_rate: number | null;
  /** Pass counts 1, fail 0, an open-ended run the share of its checks met. */
  mean_score: number | null;
  mean_answer_words: number | null;
  mean_reference_cost_usd: number | null;
  mean_steps: number | null;
  mean_latency_ms: number | null;
  passes_per_reference_dollar: number | null;
}

export function objectiveTable(
  runs: readonly RunHeader[],
  configs: readonly string[],
): ObjectiveRow[] {
  return configs.map((config) => {
    const mine = runs.filter((run) => run.config_id === config);
    const scored = mine.filter((run) => run.passed !== null);
    const open = mine.filter((run) => run.scorer_type === "constraints");
    const passes = scored.filter((run) => run.passed === true).length;
    const checksMet = open.reduce((sum, run) => sum + run.checks_met, 0);
    const checksTotal = open.reduce((sum, run) => sum + run.checks_total, 0);
    const scoredCost = scored.reduce((sum, run) => sum + run.reference_cost_usd, 0);
    return {
      config,
      runs: mine.length,
      scored_runs: scored.length,
      passes,
      pass_rate: scored.length > 0 ? passes / scored.length : null,
      pass_ci: wilson(passes, scored.length),
      constraint_runs: open.length,
      checks_met: checksMet,
      checks_total: checksTotal,
      constraints_met_rate: checksTotal > 0 ? checksMet / checksTotal : null,
      mean_score: mean(mine.map((run) => run.score)),
      mean_answer_words: mean(mine.map((run) => run.answer_words)),
      mean_reference_cost_usd: mean(mine.map((run) => run.reference_cost_usd)),
      mean_steps: mean(mine.map((run) => run.steps)),
      mean_latency_ms: mean(mine.map((run) => run.latency_ms)),
      passes_per_reference_dollar: scoredCost > 0 ? passes / scoredCost : null,
    };
  });
}

export interface AgreementStat {
  /** Votes on code and agent matches where exactly one side passed. */
  decisive_votes: number;
  agreeing_votes: number;
  agreement_rate: number | null;
  ci: Interval | null;
  /** How people voted in each scorer outcome. */
  table: {
    one_passed: { picked_passing: number; picked_failing: number; tie: number; both_bad: number };
    both_passed: { left: number; right: number; tie: number; both_bad: number };
    both_failed: { left: number; right: number; tie: number; both_bad: number };
  };
}

/**
 * Do voters pick the side the scorer passed? Only tasks with a right answer
 * count. A tie or "both bad" on a decisive match counts as disagreement.
 */
export function agreement(votes: readonly VoteRecord[]): AgreementStat {
  const table: AgreementStat["table"] = {
    one_passed: { picked_passing: 0, picked_failing: 0, tie: 0, both_bad: 0 },
    both_passed: { left: 0, right: 0, tie: 0, both_bad: 0 },
    both_failed: { left: 0, right: 0, tie: 0, both_bad: 0 },
  };
  for (const vote of votes) {
    if (vote.left_passed === null || vote.right_passed === null) continue;
    if (vote.left_passed === vote.right_passed) {
      table[vote.left_passed ? "both_passed" : "both_failed"][vote.choice] += 1;
      continue;
    }
    const passing = vote.left_passed ? "left" : "right";
    if (vote.choice === "tie" || vote.choice === "both_bad") table.one_passed[vote.choice] += 1;
    else table.one_passed[vote.choice === passing ? "picked_passing" : "picked_failing"] += 1;
  }
  const row = table.one_passed;
  const decisive = row.picked_passing + row.picked_failing + row.tie + row.both_bad;
  return {
    decisive_votes: decisive,
    agreeing_votes: row.picked_passing,
    agreement_rate: decisive > 0 ? row.picked_passing / decisive : null,
    ci: wilson(row.picked_passing, decisive),
    table,
  };
}

export interface PickRate {
  votes: number;
  picks: number;
  rate: number | null;
  ci: Interval | null;
}

function pickRate(picks: number, votes: number): PickRate {
  return { votes, picks, rate: votes > 0 ? picks / votes : null, ci: wilson(picks, votes) };
}

/** Share of left-or-right votes that picked the left pane. 50% means no position bias. */
export function positionBias(votes: readonly VoteRecord[]): PickRate {
  const sided = votes.filter((vote) => vote.choice === "left" || vote.choice === "right");
  return pickRate(sided.filter((vote) => vote.choice === "left").length, sided.length);
}

export interface LengthBias {
  /** Left-or-right votes on open-ended matches whose answers differ in length. */
  overall: PickRate;
  by_category: Partial<Record<Category, PickRate>>;
  /** Open-ended votes left out: ties, "both bad", and equal-length pairs. */
  excluded: number;
}

/** On open-ended tasks, how often did the longer answer win? 50% means no bias. */
export function lengthBias(votes: readonly VoteRecord[]): LengthBias {
  const open = votes.filter((vote) => vote.open_ended);
  const usable = open.filter(
    (vote) =>
      (vote.choice === "left" || vote.choice === "right") &&
      vote.left_answer_words !== vote.right_answer_words,
  );
  const pickedLonger = (vote: VoteRecord) =>
    (vote.choice === "left") === vote.left_answer_words > vote.right_answer_words;
  const rate = (subset: readonly VoteRecord[]) =>
    pickRate(subset.filter(pickedLonger).length, subset.length);
  const byCategory: Partial<Record<Category, PickRate>> = {};
  for (const category of new Set(usable.map((vote) => vote.task_category))) {
    byCategory[category] = rate(usable.filter((vote) => vote.task_category === category));
  }
  return { overall: rate(usable), by_category: byCategory, excluded: open.length - usable.length };
}

export interface OfficialStanding {
  model: string;
  /** Null when the model shares no published benchmark with any other model here. */
  rank: number | null;
  /** Head-to-head record on shared benchmarks, against each other model. */
  versus: { model: string; shared: number; wins: number; losses: number }[];
}

/**
 * An order for the models from Anthropic's published scores. Two models can be
 * compared only on benchmarks both have a score for; the one with the higher
 * score on more of them is ahead. A model with nothing in common with the
 * others cannot be placed and gets no rank.
 */
export function officialRanking(
  official: OfficialBenchmarks,
  models: readonly string[],
): OfficialStanding[] {
  const headToHead = (a: string, b: string) => {
    let shared = 0;
    let wins = 0;
    let losses = 0;
    for (const benchmark of official.benchmarks) {
      const mine = benchmark.scores.find((score) => score.model === a);
      const theirs = benchmark.scores.find((score) => score.model === b);
      if (!mine || !theirs) continue;
      shared += 1;
      if (mine.value > theirs.value) wins += 1;
      if (mine.value < theirs.value) losses += 1;
    }
    return { model: b, shared, wins, losses };
  };
  const standings = models.map((model) => ({
    model,
    versus: models.filter((other) => other !== model).map((other) => headToHead(model, other)),
  }));
  const points = new Map<string, number | null>(
    standings.map(({ model, versus }) => {
      const comparable = versus.filter((record) => record.shared > 0);
      if (comparable.length === 0) return [model, null];
      return [model, comparable.filter((record) => record.wins > record.losses).length];
    }),
  );
  const ranks = rankDescending(points);
  return standings.map((standing) => ({ ...standing, rank: ranks.get(standing.model) ?? null }));
}

export interface HeadlineRow {
  config: string;
  display_name: string;
  model: string;
  elo: number;
  votes: number;
  /** Null until the config has a vote. */
  elo_rank: number | null;
  official_rank: number | null;
  scorer_rank: number | null;
  mean_score: number | null;
}

export interface Leaderboard {
  category: Category | null;
  votes: number;
  headline: HeadlineRow[];
  preference: EloRow[];
  objective: ObjectiveRow[];
  official: OfficialStanding[];
  agreement: AgreementStat;
  position_bias: PickRate;
  length_bias: LengthBias;
}

export interface ConfigInfo {
  id: string;
  display_name: string;
  model: string;
}

/** Build the whole leaderboard, optionally for one task category. */
export function buildLeaderboard(
  runs: readonly RunHeader[],
  votes: readonly VoteRecord[],
  official: OfficialBenchmarks,
  configs: readonly ConfigInfo[],
  category: Category | null,
): Leaderboard {
  const inCategory = <T>(items: readonly T[], of: (item: T) => Category) =>
    category === null ? items : items.filter((item) => of(item) === category);
  const myRuns = inCategory(runs, (run) => run.category);
  const myVotes = inCategory(votes, (vote) => vote.task_category);
  const ids = configs.map((config) => config.id);

  const preference = eloTable(
    myVotes.map((vote) => ({
      left: vote.left_config_id,
      right: vote.right_config_id,
      choice: vote.choice,
    })),
    ids,
  );
  const objective = objectiveTable(myRuns, ids);
  const standings = officialRanking(
    official,
    configs.map((config) => config.model),
  );

  const eloRanks = rankDescending(
    new Map(preference.map((row) => [row.config, row.votes > 0 ? Math.round(row.elo) : null])),
  );
  const scorerRanks = rankDescending(new Map(objective.map((row) => [row.config, row.mean_score])));

  const headline = configs.map((config) => {
    const elo = preference.find((row) => row.config === config.id);
    return {
      config: config.id,
      display_name: config.display_name,
      model: config.model,
      elo: elo?.elo ?? 1000,
      votes: elo?.votes ?? 0,
      elo_rank: eloRanks.get(config.id) ?? null,
      official_rank: standings.find((row) => row.model === config.model)?.rank ?? null,
      scorer_rank: scorerRanks.get(config.id) ?? null,
      mean_score: objective.find((row) => row.config === config.id)?.mean_score ?? null,
    };
  });

  return {
    category,
    votes: myVotes.length,
    headline,
    preference,
    objective,
    official: standings,
    agreement: agreement(myVotes),
    position_bias: positionBias(myVotes),
    length_bias: lengthBias(myVotes),
  };
}
