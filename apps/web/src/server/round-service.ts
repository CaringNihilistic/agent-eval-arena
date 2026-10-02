// Rounds, the blind view, decisions, the reveal, and a player's progress. All
// the rules live here; the route handlers only translate HTTP to these calls.

import { createHmac } from "node:crypto";

import type { TraceEvent } from "@arena/schema";

import { blindView, seatAlias, summarizeBlindSide } from "@/lib/blind-view";
import {
  buildCasebook,
  compatibility,
  crowdShare,
  type Casebook,
  type Compatibility,
} from "@/lib/casebook";
import type { Expression } from "@/lib/guests";
import { modelTotals } from "@/lib/leaderboard";
import {
  isFreeMode,
  morningPostDate,
  morningPostNumber,
  morningPostRoundId,
  newSeed,
  pickFree,
  resolveRound,
  SEED,
  weekendRoundId,
  type RoundPlan,
} from "@/lib/rounds";
import {
  answerFits,
  judge,
  morningPostState,
  newlyEarned,
  rankFor,
  totalPoints,
  weekendState,
} from "@/lib/scoring";
import {
  holds,
  isConfidence,
  SEATS,
  type Answer,
  type AuthorOption,
  type BlindLetter,
  type BlindRound,
  type Confidence,
  type DecisionRecord,
  type GameState,
  type LetterRecord,
  type Mode,
  type PublicTask,
  type RevealedLetter,
  type RevealedRound,
  type RoundResponse,
  type RunHeader,
  type Seat,
  type WeekendState,
} from "@/lib/types";
import type { Recordings } from "@/server/recordings";
import type { Store } from "@/server/store";

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const VOTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireVoterId(value: string | null): string {
  if (!value || !VOTER_ID.test(value)) {
    throw new ServiceError(400, "The X-Voter-Id header must be a UUID.");
  }
  return value.toLowerCase();
}

/** Decisions one address may make in each fixed window. */
export const DECISION_LIMITS = [
  { scope: "decisions-10min", windowMs: 10 * 60 * 1000, max: 120 },
  { scope: "decisions-day", windowMs: 24 * 60 * 60 * 1000, max: 1500 },
] as const;

const LOCAL_HASH_KEY = "arena-local-development";

/** A keyed hash of the address. The raw address is never stored. */
export function hashIp(
  ip: string,
  key: string | undefined = process.env.ARENA_IP_HASH_KEY,
): string {
  if (!key && process.env.VERCEL) {
    throw new ServiceError(500, "ARENA_IP_HASH_KEY is not set on this deployment.");
  }
  return createHmac("sha256", key || LOCAL_HASH_KEY)
    .update(ip)
    .digest("hex")
    .slice(0, 32);
}

/** Read an answer from a request body, keeping only the fields it may have. */
export function parseAnswer(value: unknown): Answer {
  const bad = new ServiceError(400, "The answer is not one this game understands.");
  if (value === null || typeof value !== "object") throw bad;
  const input = value as Record<string, unknown>;
  switch (input.type) {
    case "trust":
      if (["A", "B", "equal", "neither"].includes(input.choice as string)) {
        return { type: "trust", choice: input.choice as "A" | "B" | "equal" | "neither" };
      }
      throw bad;
    case "accuse":
      return { type: "accuse" };
    case "ranking": {
      const order = input.order;
      if (
        Array.isArray(order) &&
        order.every((seat) => (SEATS as readonly unknown[]).includes(seat))
      ) {
        return { type: "ranking", order: order as Seat[] };
      }
      throw bad;
    }
    case "author":
      if (typeof input.model === "string") return { type: "author", model: input.model };
      throw bad;
    case "call":
      if (typeof input.holds === "boolean") return { type: "call", holds: input.holds };
      throw bad;
    default:
      throw bad;
  }
}

export function parseConfidence(value: unknown): Confidence {
  if (!isConfidence(value)) {
    throw new ServiceError(400, "Say how sure you are: a hunch, fairly sure, or certain.");
  }
  return value;
}

/** The three possible authors, always in the same order. */
export function authorOptions(recordings: Recordings): AuthorOption[] {
  return recordings.configs
    .map((config) => ({
      model: config.model,
      label: config.display_name.split(",")[0].replace(/^Claude\s+/, ""),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function requireRun(recordings: Recordings, runId: string): RunHeader {
  const run = recordings.runs.get(runId);
  if (!run) throw new ServiceError(500, "A round refers to a run that is not recorded.");
  return run;
}

function requireTask(recordings: Recordings, taskId: string): PublicTask {
  const task = recordings.tasks.get(taskId);
  if (!task) throw new ServiceError(500, "A round refers to a task that is not recorded.");
  return task;
}

function requirePlan(recordings: Recordings, roundId: string, voterId: string): RoundPlan {
  const plan = resolveRound(recordings.catalog, roundId, voterId);
  if (!plan) throw new ServiceError(404, "No such round.");
  return plan;
}

function gameState(
  plan: Pick<RoundPlan, "mode" | "game">,
  decisions: readonly DecisionRecord[],
): GameState | null {
  if (plan.game === null) return null;
  if (plan.mode === "weekend") return weekendState(decisions, plan.game.slice(3));
  const number = Number(plan.game.slice(3));
  return morningPostState(decisions, number, morningPostDate(number));
}

/** A round as a player who has not decided it may see it. */
function blindRound(recordings: Recordings, plan: RoundPlan, game: GameState | null): BlindRound {
  const letters: BlindLetter[] = plan.seats.map((seat) => {
    const alias = seatAlias(plan.id, seat.seat);
    const events = blindView(recordings.events(seat.run_id), alias);
    const summary = summarizeBlindSide(events);
    return {
      seat: seat.seat,
      guest: seat.guest,
      steps: summary.steps,
      final_answer: summary.final_answer,
      events,
    };
  });
  return {
    round_id: plan.id,
    mode: plan.mode,
    kind: plan.kind,
    decided: false,
    task: requireTask(recordings, plan.content.task_id),
    letters,
    authors: authorOptions(recordings),
    game,
  };
}

/** How each guest takes the decision. Sent only after it is made. */
export function expressionsFor(
  answer: Answer,
  facts: { trap: boolean; outcome: DecisionRecord["outcome"] },
  letters: readonly { seat: Seat; holds: boolean }[],
): Map<Seat, Expression> {
  const all = (expression: Expression) =>
    new Map(letters.map((letter) => [letter.seat, expression]));
  switch (answer.type) {
    case "accuse":
      // Caught: both seats flustered. Wrongly accused: everyone is shocked.
      return all(facts.trap ? "flustered" : "shocked");
    case "trust":
      if (answer.choice === "equal") return all("happy");
      if (answer.choice === "neither") return all("shocked");
      return new Map(
        letters.map((letter) => [letter.seat, letter.seat === answer.choice ? "happy" : "shocked"]),
      );
    case "ranking": {
      const last = answer.order[answer.order.length - 1];
      return new Map(
        letters.map((letter) => [
          letter.seat,
          letter.seat === answer.order[0] ? "happy" : letter.seat === last ? "shocked" : "neutral",
        ]),
      );
    }
    case "author":
      // Unmasked, or got away with it.
      return all(facts.outcome === "right" ? "flustered" : "happy");
    case "call":
      return new Map(letters.map((letter) => [letter.seat, letter.holds ? "happy" : "shocked"]));
  }
}

function revealedLetter(
  recordings: Recordings,
  record: LetterRecord,
  expression: Expression,
  allRuns: readonly RunHeader[],
): RevealedLetter {
  const run = requireRun(recordings, record.run_id);
  const events = recordings.events(run.run_id);
  let score: RevealedLetter["score"] = null;
  let finalAnswer: string | null = null;
  for (const event of events) {
    if (event.type === "score_computed") score = event.payload;
    if (event.type === "run_finished") finalAnswer = event.payload.final_answer;
  }
  return {
    seat: record.seat,
    guest: record.guest,
    expression,
    model: run.model,
    display_name: run.display_name,
    run_id: run.run_id,
    take: run.take,
    holds: record.holds,
    score,
    answer_words: run.answer_words,
    reference_cost_usd: run.reference_cost_usd,
    cost_usd: run.cost_usd,
    steps: run.steps,
    total_tokens: run.total_tokens,
    latency_ms: run.latency_ms,
    stop_reason: run.stop_reason,
    totals: modelTotals(allRuns, run.config_id),
    final_answer: finalAnswer,
    events: events.map((event): TraceEvent => ({ ...event, side: null })),
  };
}

async function reveal(
  recordings: Recordings,
  store: Store,
  plan: RoundPlan,
  decision: DecisionRecord,
  mine: readonly DecisionRecord[],
  progress: RevealedRound["progress"],
): Promise<RevealedRound> {
  const expressions = expressionsFor(
    decision.answer,
    { trap: decision.trap, outcome: decision.outcome },
    decision.letters,
  );
  const allRuns = [...recordings.runs.values()];
  const letters = decision.letters.map((letter) =>
    revealedLetter(recordings, letter, expressions.get(letter.seat) ?? "neutral", allRuns),
  );
  const models = new Set(letters.map((letter) => letter.model));
  // Only the published scores of the models at this table.
  const benchmarks = recordings.official.benchmarks
    .map((benchmark) => ({
      ...benchmark,
      scores: benchmark.scores.filter((score) => models.has(score.model)),
    }))
    .filter((benchmark) => benchmark.scores.length > 0);
  const crowd =
    plan.kind === "duel" && decision.answer.type === "trust"
      ? crowdShare(await store.decisionsOnContent(decision.content_key), decision)
      : null;
  return {
    round_id: plan.id,
    mode: plan.mode,
    kind: plan.kind,
    decided: true,
    task: requireTask(recordings, plan.content.task_id),
    letters,
    authors: authorOptions(recordings),
    trap: decision.trap,
    your_answer: decision.answer,
    confidence: decision.confidence,
    outcome: decision.outcome,
    points: decision.points,
    progress,
    crowd,
    official: { ...recordings.official, benchmarks },
    game: gameState(plan, mine),
  };
}

/** A round as this player may see it: blind until they have decided it. */
export async function roundView(
  recordings: Recordings,
  store: Store,
  roundId: string,
  voterId: string,
): Promise<RoundResponse> {
  const plan = requirePlan(recordings, roundId, voterId);
  const decision = await store.decisionOn(roundId, voterId);
  const mine = plan.game === null ? [] : await store.decisionsBy(voterId);
  if (decision !== null) return reveal(recordings, store, plan, decision, mine, null);
  return blindRound(recordings, plan, gameState(plan, mine));
}

export interface NextRound {
  /** Null when the mode has nothing left for this player, or the game is over. */
  round: BlindRound | null;
  game: GameState | null;
}

/** Deal the next round of a mode to a player. */
export async function nextRound(
  recordings: Recordings,
  store: Store,
  input: {
    voterId: string;
    mode: Mode;
    seed?: string | null;
    now?: Date;
    random?: () => number;
  },
): Promise<NextRound> {
  const { voterId, mode } = input;
  const mine = await store.decisionsBy(voterId);
  let roundId: string | null;
  let game: GameState | null = null;

  if (isFreeMode(mode)) {
    const decided = new Set(mine.map((decision) => decision.round_id));
    roundId = pickFree(recordings.catalog, mode, decided, input.random);
  } else if (mode === "weekend") {
    if (input.seed && !SEED.test(input.seed))
      throw new ServiceError(400, "That is not a game seed.");
    const state = weekendState(mine, input.seed ?? newSeed(input.random));
    game = state;
    roundId = state.over ? null : weekendRoundId(state.seed, state.next);
  } else {
    const number = morningPostNumber(input.now ?? new Date());
    const state = morningPostState(mine, number, morningPostDate(number));
    game = state;
    roundId = state.over ? null : morningPostRoundId(number, state.next);
  }
  if (roundId === null) return { round: null, game };
  const plan = requirePlan(recordings, roundId, voterId);
  return { round: blindRound(recordings, plan, game), game };
}

async function enforceRateLimit(store: Store, ipHash: string, now: Date): Promise<void> {
  for (const limit of DECISION_LIMITS) {
    const windowStart = new Date(Math.floor(now.getTime() / limit.windowMs) * limit.windowMs);
    const count = await store.hit(`${limit.scope}:${ipHash}`, windowStart);
    if (count > limit.max) {
      throw new ServiceError(429, "Too many decisions from this address. Try again later.");
    }
  }
}

/** A seeded round can only be played in order, in a game that is still going. */
function requireTurn(plan: RoundPlan, mine: readonly DecisionRecord[], now: Date): void {
  if (plan.game === null) return;
  const state = gameState(plan, mine);
  if (state === null) return;
  if (state.type === "morning_post" && state.number !== morningPostNumber(now)) {
    throw new ServiceError(409, "That edition of the Morning Post is no longer on the table.");
  }
  if (state.over) throw new ServiceError(409, "This game is over.");
  if (plan.index !== state.next) {
    throw new ServiceError(409, "Rounds of a game are played in order.");
  }
}

/** Record a decision and return the reveal. One decision per player per round. */
export async function decide(
  recordings: Recordings,
  store: Store,
  input: {
    roundId: string;
    voterId: string;
    answer: Answer;
    confidence: Confidence;
    ip: string;
    now?: Date;
  },
): Promise<RevealedRound> {
  const now = input.now ?? new Date();
  const plan = requirePlan(recordings, input.roundId, input.voterId);
  const authors = authorOptions(recordings).map((option) => option.model);
  if (!answerFits(plan.kind, input.answer, authors)) {
    throw new ServiceError(400, "That answer does not fit this round.");
  }
  const before = await store.decisionsBy(input.voterId);
  if (before.some((decision) => decision.round_id === plan.id)) {
    throw new ServiceError(409, "You have already decided this round.");
  }
  requireTurn(plan, before, now);
  const ipHash = hashIp(input.ip);
  await enforceRateLimit(store, ipHash, now);

  const letters: LetterRecord[] = plan.seats.map((seat, position) => {
    const run = requireRun(recordings, seat.run_id);
    return {
      seat: seat.seat,
      position,
      guest: seat.guest,
      run_id: run.run_id,
      config_id: run.config_id,
      model: run.model,
      passed: run.passed,
      score: run.score,
      answer_words: run.answer_words,
      holds: holds(run),
    };
  });
  const first = requireRun(recordings, plan.seats[0].run_id);
  const verdict = judge(plan.kind, input.answer, {
    trap: plan.content.trap,
    model: letters[0].model,
    holds: letters[0].holds,
  });
  const decision = {
    round_id: plan.id,
    voter_id: input.voterId,
    mode: plan.mode,
    kind: plan.kind,
    game: plan.game,
    round_index: plan.index,
    content_key: plan.content.key,
    task_id: plan.content.task_id,
    task_category: first.category,
    open_ended: first.scorer_type === "constraints",
    trap: plan.content.trap,
    answer: input.answer,
    confidence: input.confidence,
    letters,
    outcome: verdict.outcome,
    points: verdict.points,
  };
  const inserted = await store.insertDecision({ ...decision, ip_hash: ipHash });
  if (!inserted) throw new ServiceError(409, "You have already decided this round.");

  const stored: DecisionRecord = { ...decision, created_at: now.toISOString() };
  const after = [...before, stored];
  const points = totalPoints(after);
  return reveal(recordings, store, plan, stored, after, {
    points_total: points,
    rank: rankFor(points).name,
    unlocked: newlyEarned(before, after),
  });
}

function byContent(decisions: readonly DecisionRecord[]): Map<string, DecisionRecord[]> {
  const grouped = new Map<string, DecisionRecord[]>();
  for (const decision of decisions) {
    grouped.set(decision.content_key, [...(grouped.get(decision.content_key) ?? []), decision]);
  }
  return grouped;
}

/** A player's Casebook: points, rank, distinctions, and what their votes show. */
export async function casebookFor(store: Store, voterId: string): Promise<Casebook> {
  const everyone = await store.allDecisions();
  const mine = everyone.filter((decision) => decision.voter_id === voterId);
  return buildCasebook(mine, byContent(everyone));
}

/** A Casebook by its public share id. */
export async function sharedCasebook(store: Store, shareId: string): Promise<Casebook> {
  const voterId = await store.voterForShare(shareId);
  if (voterId === null) throw new ServiceError(404, "No such Casebook.");
  return casebookFor(store, voterId);
}

/** Make a challenge link from a Weekend the player has finished. */
export async function createChallenge(
  store: Store,
  voterId: string,
  seed: unknown,
): Promise<{ id: string }> {
  if (typeof seed !== "string" || !SEED.test(seed)) {
    throw new ServiceError(400, "That is not a game seed.");
  }
  const state = weekendState(await store.decisionsBy(voterId), seed);
  if (!state.over) throw new ServiceError(409, "Finish the Weekend before challenging a friend.");
  return { id: await store.createChallenge(seed, voterId) };
}

export interface ChallengeView {
  id: string;
  seed: string;
  you_are_challenger: boolean;
  you: WeekendState;
  /** The challenger's result, shown once this player has finished the same rounds. */
  challenger: Pick<WeekendState, "points" | "results" | "candles" | "survived"> | null;
  compatibility: Compatibility | null;
}

export async function challengeView(
  store: Store,
  id: string,
  voterId: string,
): Promise<ChallengeView> {
  const challenge = await store.challenge(id);
  if (challenge === null) throw new ServiceError(404, "No such challenge.");
  const mine = await store.decisionsBy(voterId);
  const you = weekendState(mine, challenge.seed);
  const isChallenger = challenge.voter_id === voterId;
  const show = you.over && !isChallenger;
  let challenger: ChallengeView["challenger"] = null;
  let shared: Compatibility | null = null;
  if (show) {
    const theirs = await store.decisionsBy(challenge.voter_id);
    const state = weekendState(theirs, challenge.seed);
    challenger = {
      points: state.points,
      results: state.results,
      candles: state.candles,
      survived: state.survived,
    };
    const inGame = (decisions: readonly DecisionRecord[]) =>
      decisions.filter((decision) => decision.game === you.game);
    shared = compatibility(inGame(mine), inGame(theirs));
  }
  return {
    id,
    seed: challenge.seed,
    you_are_challenger: isChallenger,
    you,
    challenger,
    compatibility: shared,
  };
}
