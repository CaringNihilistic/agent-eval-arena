// Realistic recorded runs for tests, typed against the generated trace schema so
// they cannot drift from it.

import type { ConfigSnapshot, StopReason, TraceEvent } from "@arena/schema";

export interface FixtureRun {
  runId: string;
  config: ConfigSnapshot;
  events: TraceEvent[];
}

interface RunOptions {
  runId: string;
  configName: string;
  displayName: string;
  model: string;
  provider: string;
  modelFamily: string;
  systemPrompt: string;
  passed: boolean;
  stopReason?: StopReason;
  withError?: boolean;
}

export function recordedRun(options: RunOptions): FixtureRun {
  const config: ConfigSnapshot = {
    id: `${options.configName}@v1`,
    family_id: options.configName,
    version: 1,
    display_name: options.displayName,
    backend: "litellm",
    model: options.model,
    provider: options.provider,
    model_family: options.modelFamily,
    system_prompt: options.systemPrompt,
    enabled_tools: ["calculator", "python_exec", "search_docs", "read_file"],
    max_steps: 10,
    temperature: null,
  };
  let seq = 0;
  const envelope = () => ({
    run_id: options.runId,
    side: null,
    seq: seq++,
    timestamp: "2026-10-02T12:00:00+00:00",
    redacted: false,
  });

  const events: TraceEvent[] = [
    { ...envelope(), type: "run_started", payload: { config, task_id: "math-01" } },
    { ...envelope(), type: "step_started", payload: { step: 1 } },
    {
      ...envelope(),
      type: "llm_call",
      payload: {
        step: 1,
        model: options.model,
        input_upto: 2,
        input_preview: [
          { role: "system", content: options.systemPrompt, truncated: false },
          { role: "user", content: "What is 37 boxes at $4.85 each?", truncated: false },
        ],
        output: {
          content: "I will compute it.",
          tool_calls: [{ call_id: "c1", tool: "calculator", arguments: { expression: "37*4.85" } }],
          truncated: false,
        },
        prompt_tokens: 412,
        completion_tokens: 38,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_usd: 0,
        reference_cost_usd: 0.000452,
        latency_ms: 840,
      },
    },
    {
      ...envelope(),
      type: "tool_call",
      payload: { step: 1, call_id: "c1", tool: "calculator", arguments: { expression: "37*4.85" } },
    },
    {
      ...envelope(),
      type: "tool_result",
      payload: {
        step: 1,
        call_id: "c1",
        tool: "calculator",
        output: "179.45",
        truncated: false,
        success: true,
        latency_ms: 2,
        error: null,
      },
    },
    {
      ...envelope(),
      type: "step_finished",
      payload: { step: 1, total_tokens: 450, cost_usd: 0, reference_cost_usd: 0.000452 },
    },
  ];
  if (options.withError) {
    events.push({
      ...envelope(),
      type: "error",
      payload: {
        message: `the model call failed: ${options.model} returned HTTP 500`,
        recoverable: false,
        step: 2,
      },
    });
  }
  events.push(
    {
      ...envelope(),
      type: "run_finished",
      payload: {
        final_answer: options.passed ? "179.45" : "180",
        cost_usd: 0,
        reference_cost_usd: 0.000871,
        total_tokens: 903,
        steps: 2,
        latency_ms: 1730,
        stop_reason: options.stopReason ?? "answered",
      },
    },
    {
      ...envelope(),
      type: "score_computed",
      payload: {
        passed: options.passed,
        score: options.passed ? 1 : 0,
        scorer_type: "numeric_tolerance",
        explanation: options.passed ? "Within tolerance." : "Expected 179.45.",
        checks: [],
      },
    },
  );
  return { runId: options.runId, config, events };
}

export const leftRun = recordedRun({
  runId: "01JRUNLEFT0000000000000000",
  configName: "gemini-full",
  displayName: "Gemini 3.8 Flash, full prompt",
  model: "gemini/gemini-3.8-flash",
  provider: "gemini",
  modelFamily: "gemini",
  systemPrompt: "You are an agent that solves one task using the tools you are given.",
  passed: true,
});

export const rightRun = recordedRun({
  runId: "01JRUNRIGHT000000000000000",
  configName: "qwen-two-tools",
  displayName: "Qwen 3.8 27B, two tools",
  model: "groq/qwen/qwen3.8-27b",
  provider: "groq",
  modelFamily: "qwen",
  systemPrompt: "Answer the question.",
  passed: false,
  stopReason: "max_cost",
  withError: true,
});

/** Every string that would tell a voter which config a side is. */
export function identifyingStrings(run: FixtureRun): string[] {
  return [
    run.runId,
    run.config.id,
    run.config.family_id,
    run.config.display_name,
    run.config.model,
    run.config.model_family,
    run.config.system_prompt,
  ];
}
