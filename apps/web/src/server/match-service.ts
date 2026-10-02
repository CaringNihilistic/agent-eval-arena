// Matches, the blind view, votes, and the reveal. All the rules live here; the
// route handlers only translate HTTP to these calls.

import { createHmac } from "node:crypto";

import type { TraceEvent } from "@arena/schema";

import { blindSides, type MatchSide } from "@/lib/blind-view";
import type { Choice } from "@/lib/elo";
import type {
  Category,
  MatchRecord,
  MatchResponse,
  RevealedMatchResponse,
  RevealedSide,
  RunHeader,
  Tallies,
} from "@/lib/types";
import type { Recordings } from "@/server/recordings";
import type { VoteStore } from "@/server/store";

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

/** Votes one address may cast in each fixed window. */
export const VOTE_LIMITS = [
  { scope: "votes-10min", windowMs: 10 * 60 * 1000, max: 30 },
  { scope: "votes-day", windowMs: 24 * 60 * 60 * 1000, max: 300 },
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

function requireMatch(recordings: Recordings, matchId: string): MatchRecord {
  const match = recordings.matches.get(matchId);
  if (!match) throw new ServiceError(404, "No such match.");
  return match;
}

function requireRun(recordings: Recordings, runId: string): RunHeader {
  const run = recordings.runs.get(runId);
  if (!run) throw new ServiceError(500, "A match refers to a run that is not recorded.");
  return run;
}

/** A random match the voter has not voted on yet, or null if there is none left. */
export async function pickMatch(
  recordings: Recordings,
  store: VoteStore,
  voterId: string,
  category: Category | null,
  random: () => number = Math.random,
): Promise<string | null> {
  const voted = await store.votedMatchIds(voterId);
  const open = [...recordings.matches.values()].filter(
    (match) => !voted.has(match.id) && (category === null || match.category === category),
  );
  if (open.length === 0) return null;
  return open[Math.floor(random() * open.length)].id;
}

function revealedSide(recordings: Recordings, runId: string, side: MatchSide): RevealedSide {
  const run = requireRun(recordings, runId);
  const events = recordings.events(runId).map((event): TraceEvent => ({ ...event, side }));
  let score: RevealedSide["score"] = null;
  let finalAnswer: string | null = null;
  for (const event of events) {
    if (event.type === "score_computed") score = event.payload;
    if (event.type === "run_finished") finalAnswer = event.payload.final_answer;
  }
  return {
    config: { id: run.config_id, display_name: run.display_name, model: run.model },
    run_id: run.run_id,
    metrics: {
      steps: run.steps,
      tool_calls: run.tool_calls,
      total_tokens: run.total_tokens,
      prompt_tokens: run.prompt_tokens,
      completion_tokens: run.completion_tokens,
      cost_usd: run.cost_usd,
      reference_cost_usd: run.reference_cost_usd,
      latency_ms: run.latency_ms,
      answer_words: run.answer_words,
      stop_reason: run.stop_reason,
    },
    score,
    final_answer: finalAnswer,
    events,
  };
}

function tally(choices: readonly Choice[]): Tallies {
  const tallies: Tallies = { left: 0, right: 0, tie: 0, both_bad: 0 };
  for (const choice of choices) tallies[choice] += 1;
  return tallies;
}

async function revealed(
  recordings: Recordings,
  store: VoteStore,
  match: MatchRecord,
  yourVote: Choice,
): Promise<RevealedMatchResponse> {
  const left = revealedSide(recordings, match.left_run_id, "left");
  const right = revealedSide(recordings, match.right_run_id, "right");
  const models = new Set([left.config.model, right.config.model]);
  // Only the published scores of the two models in this match.
  const benchmarks = recordings.official.benchmarks
    .map((benchmark) => ({
      ...benchmark,
      scores: benchmark.scores.filter((score) => models.has(score.model)),
    }))
    .filter((benchmark) => benchmark.scores.length > 0);
  return {
    match_id: match.id,
    voted: true,
    your_vote: yourVote,
    task: requireTask(recordings, match),
    sides: { left, right },
    tallies: tally(await store.votesOn(match.id)),
    official: { ...recordings.official, benchmarks },
  };
}

function requireTask(recordings: Recordings, match: MatchRecord) {
  const task = recordings.tasks.get(match.task_id);
  if (!task) throw new ServiceError(500, "A match refers to a task that is not recorded.");
  return task;
}

/** A match as this voter may see it: blind until they have voted on it. */
export async function matchView(
  recordings: Recordings,
  store: VoteStore,
  matchId: string,
  voterId: string,
): Promise<MatchResponse> {
  const match = requireMatch(recordings, matchId);
  const vote = await store.voteOn(matchId, voterId);
  if (vote !== null) return revealed(recordings, store, match, vote);
  return {
    match_id: match.id,
    voted: false,
    task: requireTask(recordings, match),
    sides: blindSides(match.id, {
      left: recordings.events(match.left_run_id),
      right: recordings.events(match.right_run_id),
    }),
  };
}

async function enforceRateLimit(store: VoteStore, ipHash: string, now: Date): Promise<void> {
  for (const limit of VOTE_LIMITS) {
    const windowStart = new Date(Math.floor(now.getTime() / limit.windowMs) * limit.windowMs);
    const count = await store.hit(`${limit.scope}:${ipHash}`, windowStart);
    if (count > limit.max) {
      throw new ServiceError(429, "Too many votes from this address. Try again later.");
    }
  }
}

/** Record a vote and return the reveal. One vote per voter per match. */
export async function castVote(
  recordings: Recordings,
  store: VoteStore,
  input: { matchId: string; voterId: string; choice: Choice; ip: string; now?: Date },
): Promise<RevealedMatchResponse> {
  const match = requireMatch(recordings, input.matchId);
  const left = requireRun(recordings, match.left_run_id);
  const right = requireRun(recordings, match.right_run_id);
  if ((await store.voteOn(match.id, input.voterId)) !== null) {
    throw new ServiceError(409, "You have already voted on this match.");
  }
  const ipHash = hashIp(input.ip);
  await enforceRateLimit(store, ipHash, input.now ?? new Date());
  const inserted = await store.insertVote({
    match_id: match.id,
    voter_id: input.voterId,
    ip_hash: ipHash,
    choice: input.choice,
    left_config_id: left.config_id,
    right_config_id: right.config_id,
    left_passed: left.passed,
    right_passed: right.passed,
    left_answer_words: left.answer_words,
    right_answer_words: right.answer_words,
    task_id: match.task_id,
    task_category: match.category,
    open_ended: left.scorer_type === "constraints",
  });
  if (!inserted) throw new ServiceError(409, "You have already voted on this match.");
  return revealed(recordings, store, match, input.choice);
}
