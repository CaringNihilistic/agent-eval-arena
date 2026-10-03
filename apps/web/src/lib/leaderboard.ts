// Everything "The Official Record" shows, computed from the recorded runs, the
// decision log, and Anthropic's published benchmark scores. The only
// implementation of each statistic in the project.

import { eloTable, type EloRow, type EloVote } from "@/lib/elo";
import { GUEST_IDS, type GuestId } from "@/lib/guests";
import { mean, rankDescending, wilson, type Interval } from "@/lib/stats";
import type {
  Category,
  DecisionRecord,
  LetterRecord,
  Mode,
  ModelTotals,
  OfficialBenchmarks,
  RunHeader,
  Spread,
} from "@/lib/types";

/** Modes whose preferences count toward Elo. */
export const ELO_MODES: readonly Mode[] = ["drawing_room", "library"];
/** Two-letter preference votes needed before costume and position bias are reported. */
export const MIN_BIAS_VOTES = 30;
/** Blind comparisons needed before the players' ranking is shown. Below this a ranking is noise. */
export const MIN_RANKING_VOTES = 30;

export interface PairwiseResult extends EloVote {
  mode: Mode;
}

/** A ranking as pairwise results: each letter beats every letter ranked below it. */
export function rankingToPairwise(order: readonly string[]): { winner: string; loser: string }[] {
  const pairs = [];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      pairs.push({ winner: order[i], loser: order[j] });
    }
  }
  return pairs;
}

function letterAt(decision: DecisionRecord, seat: string): LetterRecord | undefined {
  return decision.letters.find((letter) => letter.seat === seat);
}

/**
 * The preference results Elo is computed from: Drawing Room and Library only,
 * never a trap round, never an accusation, in the order the decisions were made.
 */
export function eloVotes(decisions: readonly DecisionRecord[]): PairwiseResult[] {
  const votes: PairwiseResult[] = [];
  for (const decision of decisions) {
    if (!ELO_MODES.includes(decision.mode) || decision.trap) continue;
    const answer = decision.answer;
    if (answer.type === "trust") {
      const a = letterAt(decision, "A");
      const b = letterAt(decision, "B");
      if (!a || !b) continue;
      const choice = { A: "left", B: "right", equal: "tie", neither: "both_bad" } as const;
      votes.push({
        left: a.config_id,
        right: b.config_id,
        choice: choice[answer.choice],
        mode: decision.mode,
      });
    } else if (answer.type === "ranking") {
      const configs = answer.order.map((seat) => letterAt(decision, seat)?.config_id);
      if (configs.some((config) => config === undefined)) continue;
      for (const pair of rankingToPairwise(configs as string[])) {
        votes.push({ left: pair.winner, right: pair.loser, choice: "left", mode: decision.mode });
      }
    }
  }
  return votes;
}

export interface ObjectiveRow extends ModelTotals {
  config: string;
  runs: number;
  /** Mean over the runs of the bank. The interval pools every run and so treats repeats of a task as independent. */
  pass_rate: number | null;
  pass_ci: Interval | null;
  /** Share of stated limits respected, over every run. Not a measure of quality. */
  constraints_met_rate: number | null;
  /** Pass counts 1, fail 0, an open-ended run the share of its checks met. Mean over every run. */
  mean_score: number | null;
  mean_steps: number | null;
  mean_latency_ms: number | null;
}

function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  return { mean: mean(values) ?? 0, min: Math.min(...values), max: Math.max(...values) };
}

function takesOf(runs: readonly RunHeader[]): number[] {
  return [...new Set(runs.map((run) => run.take))].sort((a, b) => a - b);
}

/** One model's totals across every recorded run of the bank, with the range between runs. */
export function modelTotals(runs: readonly RunHeader[], config: string): ModelTotals {
  const mine = runs.filter((run) => run.config_id === config);
  const takes = takesOf(mine);
  const perTake = takes.map((take) => mine.filter((run) => run.take === take));
  const scored = (subset: readonly RunHeader[]) => subset.filter((run) => run.passed !== null);
  const open = (subset: readonly RunHeader[]) =>
    subset.filter((run) => run.scorer_type === "constraints");
  const first = perTake[0] ?? [];
  return {
    takes: takes.length,
    scored_tasks: scored(first).length,
    passes: spread(perTake.map((subset) => scored(subset).filter((run) => run.passed).length)),
    checks_total: open(first).reduce((sum, run) => sum + run.checks_total, 0),
    checks_met: spread(
      perTake.map((subset) => open(subset).reduce((sum, run) => sum + run.checks_met, 0)),
    ),
    mean_answer_words: mean(mine.map((run) => run.answer_words)) ?? 0,
    mean_reference_cost_usd: mean(mine.map((run) => run.reference_cost_usd)) ?? 0,
  };
}

export function objectiveTable(
  runs: readonly RunHeader[],
  configs: readonly string[],
): ObjectiveRow[] {
  return configs.map((config) => {
    const mine = runs.filter((run) => run.config_id === config);
    const totals = modelTotals(runs, config);
    const scored = mine.filter((run) => run.passed !== null);
    const passes = scored.filter((run) => run.passed).length;
    const open = mine.filter((run) => run.scorer_type === "constraints");
    const met = open.reduce((sum, run) => sum + run.checks_met, 0);
    const checks = open.reduce((sum, run) => sum + run.checks_total, 0);
    return {
      config,
      runs: mine.length,
      ...totals,
      pass_rate: scored.length > 0 ? passes / scored.length : null,
      pass_ci: wilson(passes, scored.length),
      constraints_met_rate: checks > 0 ? met / checks : null,
      mean_score: mean(mine.map((run) => run.score)),
      mean_steps: mean(mine.map((run) => run.steps)),
      mean_latency_ms: mean(mine.map((run) => run.latency_ms)),
    };
  });
}

export interface VarianceRow {
  config: string;
  takes: number;
  /** Tasks this model ran more than once. */
  tasks: number;
  /** Tasks on which its score was not the same in every run. */
  tasks_varying: number;
  /** Over those tasks, the mean gap between its best and worst score (0 to 1). */
  mean_spread: number | null;
  /** The largest such gap on any one task. */
  max_spread: number | null;
  /** Its mean score over the bank in each run: the least and the most. */
  bank_score: Spread;
}

/**
 * How much each model's score moves between identical runs: same task, same
 * prompt, same settings. This is the noise floor under every comparison here.
 */
export function runVariance(runs: readonly RunHeader[], configs: readonly string[]): VarianceRow[] {
  return configs.map((config) => {
    const mine = runs.filter((run) => run.config_id === config);
    const takes = takesOf(mine);
    const byTask = new Map<string, number[]>();
    for (const run of mine)
      byTask.set(run.task_id, [...(byTask.get(run.task_id) ?? []), run.score]);
    const repeated = [...byTask.values()].filter((scores) => scores.length > 1);
    const gaps = repeated.map((scores) => Math.max(...scores) - Math.min(...scores));
    return {
      config,
      takes: takes.length,
      tasks: repeated.length,
      tasks_varying: gaps.filter((gap) => gap > 0).length,
      mean_spread: mean(gaps),
      max_spread: gaps.length > 0 ? Math.max(...gaps) : null,
      bank_score: spread(
        takes.map(
          (take) => mean(mine.filter((run) => run.take === take).map((run) => run.score)) ?? 0,
        ),
      ),
    };
  });
}

/** Two-letter rounds where the player trusted one letter over the other. */
function sidedDuels(decisions: readonly DecisionRecord[]): DecisionRecord[] {
  return decisions.filter(
    (decision) =>
      decision.kind === "duel" &&
      decision.answer.type === "trust" &&
      (decision.answer.choice === "A" || decision.answer.choice === "B"),
  );
}

function trustedSeat(decision: DecisionRecord): string | null {
  return decision.answer.type === "trust" ? decision.answer.choice : null;
}

export interface AgreementStat {
  /** Votes on code and agent rounds where exactly one side passed. */
  decisive_votes: number;
  agreeing_votes: number;
  agreement_rate: number | null;
  ci: Interval | null;
}

/**
 * Do players trust the letter the scorer passed? Only Elo-eligible duels on
 * tasks with a right answer count. "Equally good" or "Neither" on a decisive
 * round counts as disagreement.
 */
export function agreement(decisions: readonly DecisionRecord[]): AgreementStat {
  let decisive = 0;
  let agreeing = 0;
  for (const decision of decisions) {
    if (decision.kind !== "duel" || decision.trap || decision.answer.type !== "trust") continue;
    if (!ELO_MODES.includes(decision.mode)) continue;
    const [a, b] = [letterAt(decision, "A"), letterAt(decision, "B")];
    if (!a || !b || a.passed === null || b.passed === null || a.passed === b.passed) continue;
    decisive += 1;
    if (decision.answer.choice === (a.passed ? "A" : "B")) agreeing += 1;
  }
  return {
    decisive_votes: decisive,
    agreeing_votes: agreeing,
    agreement_rate: decisive > 0 ? agreeing / decisive : null,
    ci: wilson(agreeing, decisive),
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

/** Share of sided votes that trusted the first letter shown. 50% means no position bias. */
export function positionBias(decisions: readonly DecisionRecord[]): PickRate {
  const sided = sidedDuels(decisions);
  const first = sided.filter(
    (decision) => letterAt(decision, trustedSeat(decision) ?? "")?.position === 0,
  );
  return pickRate(first.length, sided.length);
}

export interface CostumeRow extends PickRate {
  guest: GuestId;
}

/**
 * For each guest: of the sided two-letter votes that guest sat in, how often
 * was the guest's letter the one trusted? Guests are assigned at random, so
 * every rate should sit near 50% unless the costume itself sways players.
 */
export function costumeBias(decisions: readonly DecisionRecord[]): CostumeRow[] {
  const sided = sidedDuels(decisions);
  return GUEST_IDS.map((guest) => {
    const seated = sided.filter((decision) =>
      decision.letters.some((letter) => letter.guest === guest),
    );
    const trusted = seated.filter(
      (decision) => letterAt(decision, trustedSeat(decision) ?? "")?.guest === guest,
    );
    return { guest, ...pickRate(trusted.length, seated.length) };
  });
}

export interface LengthBias {
  /** Sided votes on open-ended duels between different authors whose letters differ in length. */
  overall: PickRate;
  /** Open-ended duel votes left out: "equally good", "neither", and equal-length pairs. */
  excluded: number;
}

/** On open-ended tasks, how often was the longer letter trusted? 50% means no bias. */
export function lengthBias(decisions: readonly DecisionRecord[]): LengthBias {
  const open = decisions.filter(
    (d) => d.kind === "duel" && d.open_ended && !d.trap && d.answer.type === "trust",
  );
  const usable = sidedDuels(open).filter((decision) => {
    const [a, b] = [letterAt(decision, "A"), letterAt(decision, "B")];
    return a !== undefined && b !== undefined && a.answer_words !== b.answer_words;
  });
  const longer = usable.filter((decision) => {
    const trusted = letterAt(decision, trustedSeat(decision) ?? "");
    const other = decision.letters.find((letter) => letter !== trusted);
    return (
      trusted !== undefined && other !== undefined && trusted.answer_words > other.answer_words
    );
  });
  return { overall: pickRate(longer.length, usable.length), excluded: open.length - usable.length };
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
  /** Pairwise preference results behind the Elo table, and how many came from each mode. */
  votes: number;
  /** False until there are enough comparisons to rank on; the page then shows the count, not a ranking. */
  ranking_ready: boolean;
  votes_needed: number;
  votes_by_mode: Partial<Record<Mode, number>>;
  headline: HeadlineRow[];
  preference: EloRow[];
  objective: ObjectiveRow[];
  /** How much each model's score moves between identical runs. */
  variance: VarianceRow[];
  official: OfficialStanding[];
  agreement: AgreementStat;
  length_bias: LengthBias;
  /** Null until there are enough sided two-letter votes to say anything. */
  position_bias: PickRate | null;
  costume_bias: CostumeRow[] | null;
  bias_votes: number;
  bias_votes_needed: number;
}

export interface ConfigInfo {
  id: string;
  display_name: string;
  model: string;
}

/** Build the whole record, optionally for one task category. */
export function buildLeaderboard(
  runs: readonly RunHeader[],
  decisions: readonly DecisionRecord[],
  official: OfficialBenchmarks,
  configs: readonly ConfigInfo[],
  category: Category | null,
): Leaderboard {
  const myRuns = category === null ? runs : runs.filter((run) => run.category === category);
  const mine =
    category === null ? decisions : decisions.filter((d) => d.task_category === category);
  const ids = configs.map((config) => config.id);

  const votes = eloVotes(mine);
  const byMode: Partial<Record<Mode, number>> = {};
  for (const vote of votes) byMode[vote.mode] = (byMode[vote.mode] ?? 0) + 1;
  const preference = eloTable(votes, ids);
  const objective = objectiveTable(myRuns, ids);
  const standings = officialRanking(
    official,
    configs.map((config) => config.model),
  );

  const rankingReady = votes.length >= MIN_RANKING_VOTES;
  const eloRanks = rankDescending(
    new Map(
      preference.map((row) => [
        row.config,
        rankingReady && row.votes > 0 ? Math.round(row.elo) : null,
      ]),
    ),
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

  const biasVotes = sidedDuels(mine).length;
  const enough = biasVotes >= MIN_BIAS_VOTES;
  return {
    category,
    votes: votes.length,
    ranking_ready: rankingReady,
    votes_needed: MIN_RANKING_VOTES,
    votes_by_mode: byMode,
    headline,
    preference,
    objective,
    variance: runVariance(myRuns, ids),
    official: standings,
    agreement: agreement(mine),
    length_bias: lengthBias(mine),
    position_bias: enough ? positionBias(mine) : null,
    costume_bias: enough ? costumeBias(mine) : null,
    bias_votes: biasVotes,
    bias_votes_needed: MIN_BIAS_VOTES,
  };
}
