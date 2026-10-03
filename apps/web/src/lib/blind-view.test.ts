import type { TraceEvent } from "@arena/schema";
import { describe, expect, it } from "vitest";

import {
  BLIND_TIMESTAMP,
  blindView,
  REDACTED_ERROR_MESSAGE,
  redactEvent,
  seatAlias,
  summarizeBlindSide,
} from "@/lib/blind-view";
import { findLeaks } from "@/test/leak-scan";
import { identifyingStrings, leftRun, recordedRun, rightRun } from "@/test/trace-fixtures";

const ROUND_ID = "dr.0123456789abcdef";
const ALIAS = seatAlias(ROUND_ID, "A");
const secrets = [...identifyingStrings(leftRun), ...identifyingStrings(rightRun)];

const baseOptions = {
  runId: "01JRUNOTHER000000000000000",
  configName: "claude-sonnet-full",
  displayName: "Claude Sonnet 5.5, full prompt",
  model: "claude-sonnet-5-5",
  provider: "anthropic",
  modelFamily: "claude",
  systemPrompt: "Solve the task.",
  passed: false,
};

function only<T extends TraceEvent["type"]>(
  events: TraceEvent[],
  type: T,
): Extract<TraceEvent, { type: T }>[] {
  return events.filter((event): event is Extract<TraceEvent, { type: T }> => event.type === type);
}

describe("the leak scan itself", () => {
  it("finds every kind of leak in an unredacted run", () => {
    const reasons = findLeaks(leftRun.events, identifyingStrings(leftRun)).map((l) => l.reason);

    expect(reasons).toContain('"config" has a value');
    expect(reasons).toContain('"model" has a value');
    expect(reasons).toContain('"cost_usd" has a value');
    expect(reasons).toContain('"reference_cost_usd" has a value');
    expect(reasons).toContain('"prompt_tokens" has a value');
    expect(reasons).toContain('"total_tokens" has a value');
    expect(reasons).toContain('"passed" has a value');
    expect(reasons).toContain('"score" has a value');
    expect(reasons).toContain('"checks" has a value');
    expect(reasons).toContain('"thinking" has a value');
    expect(reasons).toContain('"latency_ms" has a value');
    expect(reasons).toContain("a real timestamp");
    expect(reasons).toContain(`contains "${leftRun.config.model}"`);
    expect(reasons).toContain(`contains "${leftRun.runId}"`);
    expect(reasons).toContain(`contains "${leftRun.config.system_prompt}"`);
  });

  it("treats a zero as a value, not as absent", () => {
    expect(findLeaks({ cost_usd: 0 }, [])).toEqual([
      { path: "$.cost_usd", reason: '"cost_usd" has a value' },
    ]);
    expect(findLeaks({ cost_usd: null }, [])).toEqual([]);
  });
});

describe("blind view of one run", () => {
  const blind = blindView(leftRun.events, ALIAS);

  it("leaks nothing", () => {
    expect(findLeaks(blind, secrets)).toEqual([]);
  });

  it("drops the score event and keeps every other event in order", () => {
    expect(blind.map((event) => event.type)).toEqual(
      leftRun.events.map((event) => event.type).filter((type) => type !== "score_computed"),
    );
    expect(blind.map((event) => event.seq)).toEqual(blind.map((_, index) => index));
  });

  it("marks every event as redacted and replaces the run id with a seat alias", () => {
    for (const event of blind) {
      expect(event.redacted).toBe(true);
      expect(event.side).toBeNull();
      expect(event.run_id).toBe("dr.0123456789abcdef:A");
    }
  });

  it("removes the system prompt from the input preview but keeps the task", () => {
    const [call] = only(blind, "llm_call");

    expect(call.payload.input_preview.map((message) => message.role)).toEqual(["user"]);
    expect(call.payload.input_preview[0].content).toContain("37 boxes");
  });

  it("keeps what the voter is meant to judge", () => {
    const [call] = only(blind, "llm_call");
    const [result] = only(blind, "tool_result");
    const [finished] = only(blind, "run_finished");

    expect(call.payload.output.content).toBe("I will compute it.");
    expect(call.payload.output.tool_calls[0].tool).toBe("calculator");
    expect(result.payload.output).toBe("179.45");
    expect(finished.payload.final_answer).toBe("179.45");
    expect(finished.payload.steps).toBe(2);
    expect(finished.payload.stop_reason).toBe("answered");
  });

  it("hides the thinking block, which only some models produce", () => {
    const [stored] = only(leftRun.events, "llm_call");
    const [call] = only(blind, "llm_call");

    expect(stored.payload.output.thinking).toBe("Multiply the unit price by the quantity.");
    expect(call.payload.output.thinking).toBeNull();
    expect(JSON.stringify(blind)).not.toContain("Multiply the unit price");
  });

  it("hides every measure of speed: latencies and timestamps", () => {
    const [call] = only(blind, "llm_call");
    const [result] = only(blind, "tool_result");
    const [finished] = only(blind, "run_finished");

    expect(call.payload.latency_ms).toBeNull();
    expect(result.payload.latency_ms).toBeNull();
    expect(finished.payload.latency_ms).toBeNull();
    expect(new Set(blind.map((event) => event.timestamp))).toEqual(new Set([BLIND_TIMESTAMP]));
    // The stored run really does have different times to hide.
    expect(new Set(leftRun.events.map((event) => event.timestamp)).size).toBeGreaterThan(1);
  });

  it("does not modify the stored events", () => {
    const before = JSON.stringify(leftRun.events);

    blindView(leftRun.events, ALIAS);

    expect(JSON.stringify(leftRun.events)).toBe(before);
  });
});

describe("redaction rules", () => {
  it.each(["max_tokens", "max_cost", "timeout"] as const)(
    "hides the %s stop reason",
    (stopReason) => {
      const run = recordedRun({ ...baseOptions, stopReason });
      const [finished] = only(blindView(run.events, ALIAS), "run_finished");

      expect(finished.payload.stop_reason).toBeNull();
    },
  );

  it.each(["answered", "max_steps", "error"] as const)("keeps the %s stop reason", (stopReason) => {
    const run = recordedRun({ ...baseOptions, stopReason });
    const [finished] = only(blindView(run.events, ALIAS), "run_finished");

    expect(finished.payload.stop_reason).toBe(stopReason);
  });

  it("replaces an error's text, which can name the model", () => {
    const blind = blindView(rightRun.events, ALIAS);
    const [error] = only(blind, "error");

    expect(error.payload.message).toBe(REDACTED_ERROR_MESSAGE);
    expect(error.payload.recoverable).toBe(false);
    expect(findLeaks(blind, secrets)).toEqual([]);
  });

  it("never sends a score event", () => {
    const score = leftRun.events.find((event) => event.type === "score_computed");

    expect(score).toBeDefined();
    expect(redactEvent(score!, ALIAS)).toBeNull();
  });
});

describe("the agent's working folder", () => {
  it("has its name, which names the harness, replaced wherever an agent wrote it", () => {
    const [call] = only(leftRun.events, "tool_call");
    const [result] = only(leftRun.events, "tool_result");
    const path = "/tmp/arena-claude-6dnni_hc/sensor_readings.csv";
    const events: TraceEvent[] = [
      { ...call, payload: { ...call.payload, arguments: { code: `open('${path}')` } } },
      { ...result, payload: { ...result.payload, output: `No such file: ${path}` } },
    ];

    const blind = JSON.stringify(blindView(events, ALIAS));

    expect(blind).not.toContain("arena-claude");
    expect(blind).toContain("/tmp/workdir/sensor_readings.csv");
    // The stored trace is untouched.
    expect(JSON.stringify(events)).toContain("arena-claude-6dnni_hc");
  });
});

describe("summary sent before the decision", () => {
  it("is the answer alone, with no step count", () => {
    expect(summarizeBlindSide(blindView(leftRun.events, ALIAS))).toEqual({
      finished: true,
      final_answer: "179.45",
    });
  });

  it("has no answer for a run still in progress", () => {
    const partial = blindView(leftRun.events.slice(0, 4), ALIAS);

    expect(summarizeBlindSide(partial)).toEqual({ finished: false, final_answer: null });
  });
});
