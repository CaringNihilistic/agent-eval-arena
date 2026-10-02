// Shapes of the recorded data and the vote log, shared by server and browser code.

import type { ConstraintCheck, ScorerType, StopReason, TraceEvent } from "@arena/schema";

import type { BlindSide, MatchSide } from "@/lib/blind-view";
import type { Choice } from "@/lib/elo";

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

export const CHOICES = ["left", "right", "tie", "both_bad"] as const;

export function isChoice(value: unknown): value is Choice {
  return typeof value === "string" && (CHOICES as readonly string[]).includes(value);
}

/** The first line of a recorded run file, as the recorder wrote it. */
export interface RunHeader {
  run_id: string;
  config_id: string;
  config_name: string;
  display_name: string;
  model: string;
  task_id: string;
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

export interface MatchRecord {
  id: string;
  task_id: string;
  category: Category;
  left_run_id: string;
  right_run_id: string;
}

export interface PublicTask {
  id: string;
  title: string;
  category: Category;
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  required_tools: string[];
}

/** One row of the vote log. Self-contained: no join is needed to use it. */
export interface VoteRecord {
  match_id: string;
  voter_id: string;
  choice: Choice;
  left_config_id: string;
  right_config_id: string;
  left_passed: boolean | null;
  right_passed: boolean | null;
  left_answer_words: number;
  right_answer_words: number;
  task_id: string;
  task_category: Category;
  /** True when the task has no right answer and was scored by constraint checks. */
  open_ended: boolean;
  created_at: string;
}

export interface Tallies {
  left: number;
  right: number;
  tie: number;
  both_bad: number;
}

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

export interface RevealedSide {
  config: { id: string; display_name: string; model: string };
  run_id: string;
  metrics: Pick<
    RunHeader,
    | "steps"
    | "tool_calls"
    | "total_tokens"
    | "prompt_tokens"
    | "completion_tokens"
    | "cost_usd"
    | "reference_cost_usd"
    | "latency_ms"
    | "answer_words"
    | "stop_reason"
  >;
  score: {
    passed: boolean | null;
    score: number;
    scorer_type: ScorerType;
    explanation: string;
    checks: ConstraintCheck[];
  } | null;
  final_answer: string | null;
  events: TraceEvent[];
}

export interface BlindMatchResponse {
  match_id: string;
  voted: false;
  task: PublicTask;
  sides: Record<MatchSide, BlindSide>;
}

export interface RevealedMatchResponse {
  match_id: string;
  voted: true;
  your_vote: Choice;
  task: PublicTask;
  sides: Record<MatchSide, RevealedSide>;
  tallies: Tallies;
  official: OfficialBenchmarks;
}

export type MatchResponse = BlindMatchResponse | RevealedMatchResponse;
