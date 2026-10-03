// Shapes of the recorded data, the rounds, and the decision log, shared by
// server and browser code.

import type { ConstraintCheck, ScorerType, StopReason, TraceEvent } from "@arena/schema";

import type { Expression, GuestId } from "@/lib/guests";

export const CATEGORIES = [
  "writing",
  "diagram",
  "explanation",
  "tech_stack",
  "code",
  "agent",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  writing: "Writing",
  diagram: "Diagrams",
  explanation: "Explanation",
  tech_stack: "Tech stack",
  code: "Code",
  agent: "Agent tasks",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** The first line of a recorded run file, as the recorder wrote it. */
export interface RunHeader {
  run_id: string;
  config_id: string;
  config_name: string;
  display_name: string;
  model: string;
  task_id: string;
  /** Which run of this model on this task: 1, 2, 3. Every run uses the same settings. */
  take: number;
  category: Category;
  stop_reason: StopReason;
  /** Null for open-ended tasks, which have no right answer. */
  passed: boolean | null;
  score: number;
  scorer_type: ScorerType;
  checks_met: number;
  checks_total: number;
  /** Counted once, by the recorder. The web app never recounts. */
  answer_words: number;
  steps: number;
  tool_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  reference_cost_usd: number;
  latency_ms: number;
  wall_clock_ms: number;
  file: string;
}

/** Did the run hold up: passed its tests, or met every stated rule. */
export function holds(run: Pick<RunHeader, "passed" | "checks_met" | "checks_total">): boolean {
  return run.passed ?? run.checks_met === run.checks_total;
}

export interface PublicTask {
  id: string;
  title: string;
  category: Category;
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  required_tools: string[];
}

// ------------------------------------------------------------------ rounds

export const MODES = ["drawing_room", "library", "weekend", "timetable", "morning_post"] as const;
export type Mode = (typeof MODES)[number];

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export const MODE_NAMES: Record<Mode, string> = {
  drawing_room: "The Drawing Room",
  library: "The Library Gathering",
  weekend: "A Weekend at Wrenfield",
  timetable: "Does the Timetable Hold?",
  morning_post: "The Morning Post",
};

export type RoundKind = "duel" | "ranking" | "author" | "timetable";

export const SEATS = ["A", "B", "C"] as const;
export type Seat = (typeof SEATS)[number];

export const CONFIDENCES = ["hunch", "fairly", "certain"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  hunch: "A hunch",
  fairly: "Fairly sure",
  certain: "Certain",
};

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === "string" && (CONFIDENCES as readonly string[]).includes(value);
}

export type TrustChoice = "A" | "B" | "equal" | "neither";

export type Answer =
  | { type: "trust"; choice: TrustChoice }
  | { type: "accuse" }
  /** Seats from most trusted to least. */
  | { type: "ranking"; order: Seat[] }
  | { type: "author"; model: string }
  | { type: "call"; holds: boolean };

/** Right, wrong, or neither because the question was one of preference. */
export type Outcome = "right" | "wrong" | "none";

/** One letter of a decided round, as stored with the decision. */
export interface LetterRecord {
  seat: Seat;
  /** 0 for the first letter shown, counting from the left or the top. */
  position: number;
  guest: GuestId;
  run_id: string;
  config_id: string;
  model: string;
  passed: boolean | null;
  score: number;
  answer_words: number;
  holds: boolean;
}

/** One row of the decision log. Self-contained: no join is needed to use it. */
export interface DecisionRecord {
  round_id: string;
  voter_id: string;
  mode: Mode;
  kind: RoundKind;
  /** The seeded game the round belongs to ("wk.<seed>", "mp.<day>"), or null in free play. */
  game: string | null;
  round_index: number | null;
  /** The same for every player shown the same runs, whatever the seats. */
  content_key: string;
  task_id: string;
  task_category: Category;
  /** True when the task has no right answer and was scored by constraint checks. */
  open_ended: boolean;
  /** True when both letters were written by one model. */
  trap: boolean;
  answer: Answer;
  confidence: Confidence;
  letters: LetterRecord[];
  outcome: Outcome;
  points: number;
  created_at: string;
}

// --------------------------------------------------------- official scores

export interface OfficialScore {
  model: string;
  value: number;
  display: string;
  source: string;
  note?: string;
}

export interface OfficialBenchmark {
  id: string;
  name: string;
  area: string;
  scores: OfficialScore[];
}

export interface OfficialSource {
  title: string;
  url: string;
  published: string;
  conditions: string;
}

export interface OfficialBenchmarks {
  checked: string;
  note: string;
  sources: Record<string, OfficialSource>;
  benchmarks: OfficialBenchmark[];
}

// -------------------------------------------------------------- responses

/**
 * A letter before the decision: what was written, nothing else. How it was
 * written (the trace) waits for the reveal, because the number of steps and
 * tool calls tells the models apart.
 */
export interface BlindLetter {
  seat: Seat;
  guest: GuestId;
  final_answer: string | null;
}

export interface WeekendState {
  type: "weekend";
  game: string;
  seed: string;
  total: number;
  /** Index of the next round to play. */
  next: number;
  candles: number;
  points: number;
  results: Outcome[];
  over: boolean;
  survived: boolean;
}

export interface MorningPostState {
  type: "morning_post";
  game: string;
  number: number;
  date: string;
  total: number;
  next: number;
  results: Outcome[];
  over: boolean;
  /** The shareable result, once all five rounds are played. */
  share_text: string | null;
}

export type GameState = WeekendState | MorningPostState;

export interface AuthorOption {
  model: string;
  label: string;
}

export interface BlindRound {
  round_id: string;
  mode: Mode;
  kind: RoundKind;
  decided: false;
  task: PublicTask;
  letters: BlindLetter[];
  /** The three possible authors, in a fixed order. The same in every round. */
  authors: AuthorOption[];
  game: GameState | null;
}

/** A figure measured once per run of the whole bank: its mean, and how far it moved between runs. */
export interface Spread {
  mean: number;
  min: number;
  max: number;
}

/** One model's totals over the 30 tasks, across every recorded run of them. */
export interface ModelTotals {
  /** How many times the bank was run (takes). */
  takes: number;
  /** Tasks with a right answer, and how many of them each run passed. */
  scored_tasks: number;
  passes: Spread;
  /** Constraint checks on the open-ended tasks, and how many each run met. */
  checks_total: number;
  checks_met: Spread;
  mean_answer_words: number;
  mean_reference_cost_usd: number;
}

export interface RevealedLetter {
  seat: Seat;
  guest: GuestId;
  expression: Expression;
  model: string;
  display_name: string;
  run_id: string;
  take: number;
  holds: boolean;
  score: {
    passed: boolean | null;
    score: number;
    scorer_type: ScorerType;
    explanation: string;
    checks: ConstraintCheck[];
  } | null;
  answer_words: number;
  reference_cost_usd: number;
  cost_usd: number;
  steps: number;
  total_tokens: number;
  latency_ms: number;
  stop_reason: StopReason;
  /** This model's totals over its first run of all 30 tasks. */
  totals: ModelTotals;
  final_answer: string | null;
  events: TraceEvent[];
}

export interface Distinction {
  id: string;
  name: string;
  rule: string;
}

export interface Crowd {
  /** Players who trusted one letter or the other in this pairing, this player included. */
  votes: number;
  /** Share who trusted the same letter. Null below the threshold, or when this player trusted neither. */
  same_share: number | null;
}

export interface RevealedRound {
  round_id: string;
  mode: Mode;
  kind: RoundKind;
  decided: true;
  task: PublicTask;
  letters: RevealedLetter[];
  authors: AuthorOption[];
  trap: boolean;
  your_answer: Answer;
  confidence: Confidence;
  outcome: Outcome;
  points: number;
  /** Set only in the response to the decision itself. */
  progress: { points_total: number; rank: string; unlocked: Distinction[] } | null;
  crowd: Crowd | null;
  official: OfficialBenchmarks;
  game: GameState | null;
}

export type RoundResponse = BlindRound | RevealedRound;
