/* eslint-disable */
// GENERATED from trace-event.schema.json. Do not edit by hand; run `pnpm schema:gen`.

/**
 * One structured event in an agent run. This file is the only definition of the trace format; TypeScript and Pydantic types are generated from it.
 */
export type TraceEvent =
  | RunStartedEvent
  | StepStartedEvent
  | LlmCallEvent
  | ToolCallEvent
  | ToolResultEvent
  | StepFinishedEvent
  | RunFinishedEvent
  | ScoreComputedEvent
  | ErrorEvent;
/**
 * Which pane of a match the event belongs to. Null when a run is served outside a match.
 */
export type Side = ("left" | "right") | null;
/**
 * Which agent loop ran the config: our LangGraph loop over LiteLLM, or Claude Code's loop through the Claude Agent SDK.
 */
export type AgentBackend = "litellm" | "agent_sdk";
/**
 * Tools a config can enable.
 */
export type ToolName = "calculator" | "python_exec" | "search_docs" | "read_file";
export type MessageRole = "system" | "user" | "assistant" | "tool";
export type StopReason = "answered" | "max_steps" | "max_tokens" | "max_cost" | "timeout" | "error";
/**
 * How a run was scored. `constraints` checks an open-ended answer against the task's stated limits; it says nothing about quality.
 */
export type ScorerType =
  "exact" | "numeric_tolerance" | "regex" | "python_check" | "llm_judge" | "constraints";

export interface RunStartedEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "run_started";
  timestamp: string;
  redacted: boolean;
  payload: RunStartedPayload;
}
export interface RunStartedPayload {
  /**
   * Null in the blind view.
   */
  config: ConfigSnapshot | null;
  task_id: string;
}
/**
 * The config a run executed with, copied at run start.
 */
export interface ConfigSnapshot {
  id: string;
  family_id: string;
  version: number;
  display_name: string;
  backend: AgentBackend;
  model: string;
  provider: string;
  model_family: string;
  system_prompt: string;
  enabled_tools: ToolName[];
  max_steps: number;
  /**
   * Null means the parameter is omitted from model requests.
   */
  temperature: number | null;
}
export interface StepStartedEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "step_started";
  timestamp: string;
  redacted: boolean;
  payload: StepStartedPayload;
}
export interface StepStartedPayload {
  step: number;
}
export interface LlmCallEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "llm_call";
  timestamp: string;
  redacted: boolean;
  payload: LlmCallPayload;
}
export interface LlmCallPayload {
  step: number;
  /**
   * Null in the blind view.
   */
  model: string | null;
  /**
   * The model saw conversation messages 0 up to, not including, this index.
   */
  input_upto: number;
  /**
   * Messages added to the conversation since the previous model call.
   */
  input_preview: MessagePreview[];
  output: LlmOutput;
  /**
   * All input tokens, including any read from or written to the provider's prompt cache. Null in the blind view.
   */
  prompt_tokens: number | null;
  /**
   * Null in the blind view.
   */
  completion_tokens: number | null;
  /**
   * Input tokens served from the provider's prompt cache, when the provider reports it. Null when not reported, and in the blind view.
   */
  cache_read_tokens: number | null;
  /**
   * Input tokens written to the provider's prompt cache, when the provider reports it. Null when not reported, and in the blind view.
   */
  cache_write_tokens: number | null;
  /**
   * What was actually charged. Zero on free tiers and subscriptions. Null in the blind view.
   */
  cost_usd: number | null;
  /**
   * What the same tokens would cost at the provider's paid list price. Null in the blind view.
   */
  reference_cost_usd: number | null;
  latency_ms: number;
}
/**
 * A message shown in the trace, truncated for display. The full message is stored separately.
 */
export interface MessagePreview {
  role: MessageRole;
  content: string;
  truncated: boolean;
}
export interface LlmOutput {
  content: string | null;
  tool_calls: ToolInvocation[];
  truncated: boolean;
}
/**
 * A tool call requested by the model.
 */
export interface ToolInvocation {
  call_id: string;
  /**
   * Name as the model wrote it. Not restricted to ToolName: it can be the submit_answer control tool or a name that does not exist.
   */
  tool: string;
  arguments: {};
}
export interface ToolCallEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "tool_call";
  timestamp: string;
  redacted: boolean;
  payload: ToolCallPayload;
}
export interface ToolCallPayload {
  step: number;
  call_id: string;
  tool: string;
  arguments: {};
}
export interface ToolResultEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "tool_result";
  timestamp: string;
  redacted: boolean;
  payload: ToolResultPayload;
}
export interface ToolResultPayload {
  step: number;
  call_id: string;
  tool: string;
  /**
   * Truncated for display.
   */
  output: string;
  truncated: boolean;
  success: boolean;
  latency_ms: number;
  error: string | null;
}
export interface StepFinishedEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "step_finished";
  timestamp: string;
  redacted: boolean;
  payload: StepFinishedPayload;
}
export interface StepFinishedPayload {
  step: number;
  /**
   * Cumulative for the run. Null in the blind view.
   */
  total_tokens: number | null;
  /**
   * Actually charged, cumulative for the run. Null in the blind view.
   */
  cost_usd: number | null;
  /**
   * At paid list price, cumulative for the run. Null in the blind view.
   */
  reference_cost_usd: number | null;
}
export interface RunFinishedEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "run_finished";
  timestamp: string;
  redacted: boolean;
  payload: RunFinishedPayload;
}
export interface RunFinishedPayload {
  final_answer: string | null;
  /**
   * Actually charged. Null in the blind view.
   */
  cost_usd: number | null;
  /**
   * At paid list price. Null in the blind view.
   */
  reference_cost_usd: number | null;
  /**
   * Null in the blind view.
   */
  total_tokens: number | null;
  steps: number;
  /**
   * Active time: the sum of model-call and tool-call latencies. Waits for rate limits are excluded.
   */
  latency_ms: number;
  /**
   * Null in the blind view when the run stopped at a token or cost limit.
   */
  stop_reason: StopReason | null;
}
export interface ScoreComputedEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "score_computed";
  timestamp: string;
  redacted: boolean;
  payload: ScoreComputedPayload;
}
/**
 * Never sent in the blind view. For tasks with a right answer, `passed` says whether the answer was right. For open-ended tasks `passed` is null, `checks` lists the constraint checks, and `score` is the share of them that were met.
 */
export interface ScoreComputedPayload {
  /**
   * Null for open-ended tasks, where there is no right answer to check.
   */
  passed: boolean | null;
  score: number;
  scorer_type: ScorerType;
  explanation: string;
  /**
   * Empty for tasks with a right answer.
   */
  checks: ConstraintCheck[];
}
/**
 * One automatic check of an open-ended answer against a limit the task stated.
 */
export interface ConstraintCheck {
  name: string;
  passed: boolean;
  detail: string;
}
export interface ErrorEvent {
  run_id: string;
  side: Side;
  seq: number;
  type: "error";
  timestamp: string;
  redacted: boolean;
  payload: ErrorPayload;
}
export interface ErrorPayload {
  message: string;
  recoverable: boolean;
  step: number | null;
}
