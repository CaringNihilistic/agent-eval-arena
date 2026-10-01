import type { TraceEvent } from "@arena/schema";
import { describe, expect, it } from "vitest";

import {
  blindMatchView,
  blindView,
  REDACTED_ERROR_MESSAGE,
  redactEvent,
  sideAlias,
  summarizeBlindSide,
} from "@/lib/blind-view";
import { findLeaks } from "@/test/leak-scan";
import { identifyingStrings, leftRun, recordedRun, rightRun } from "@/test/trace-fixtures";

const MATCH_ID = "01JMATCH000000000000000000";
const secrets = [...identifyingStrings(leftRun), ...identifyingStrings(rightRun)];

const baseOptions = {
  runId: "01JRUNOTHER000000000000000",
  configName: "qwen-full",
  displayName: "Qwen 3.8 27B, full prompt",
  model: "groq/qwen/qwen3.8-27b",
  provider: "groq",
  modelFamily: "qwen",
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
  const blind = blindView(leftRun.events, MATCH_ID, "left");

  it("leaks nothing", () => {
    expect(findLeaks(blind, secrets)).toEqual([]);
  });

  it("drops the score event and keeps every other event in order", () => {
    expect(blind.map((event) => event.type)).toEqual(
      leftRun.events.map((event) => event.type).filter((type) => type !== "score_computed"),
    );
    expect(blind.map((event) => event.seq)).toEqual(blind.map((_, index) => index));
  });

  it("marks every event as redacted and replaces the run id with a match-scoped alias", () => {
    for (const event of blind) {
      expect(event.redacted).toBe(true);
      expect(event.side).toBe("left");
      expect(event.run_id).toBe(sideAlias(MATCH_ID, "left"));
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
    expect(call.payload.latency_ms).toBe(840);
    expect(result.payload.output).toBe("179.45");
    expect(finished.payload.final_answer).toBe("179.45");
    expect(finished.payload.steps).toBe(2);
    expect(finished.payload.latency_ms).toBe(1730);
    expect(finished.payload.stop_reason).toBe("answered");
  });

  it("does not modify the stored events", () => {
    const before = JSON.stringify(leftRun.events);

    blindView(leftRun.events, MATCH_ID, "left");

    expect(JSON.stringify(leftRun.events)).toBe(before);
  });
});

describe("redaction rules", () => {
  it.each(["max_tokens", "max_cost"] as const)("hides the %s stop reason", (stopReason) => {
    const run = recordedRun({ ...baseOptions, stopReason });
    const [finished] = only(blindView(run.events, MATCH_ID, "right"), "run_finished");

    expect(finished.payload.stop_reason).toBeNull();
  });

  it.each(["answered", "max_steps", "timeout", "error"] as const)(
    "keeps the %s stop reason",
    (stopReason) => {
      const run = recordedRun({ ...baseOptions, stopReason });
      const [finished] = only(blindView(run.events, MATCH_ID, "right"), "run_finished");

      expect(finished.payload.stop_reason).toBe(stopReason);
    },
  );

  it("replaces an error's text, which can name the model", () => {
    const blind = blindView(rightRun.events, MATCH_ID, "right");
    const [error] = only(blind, "error");

    expect(error.payload.message).toBe(REDACTED_ERROR_MESSAGE);
    expect(error.payload.recoverable).toBe(false);
    expect(findLeaks(blind, secrets)).toEqual([]);
  });

  it("never sends a score event", () => {
    const score = leftRun.events.find((event) => event.type === "score_computed");

    expect(score).toBeDefined();
    expect(redactEvent(score!, MATCH_ID, "left")).toBeNull();
  });
});

describe("the replay payload sent before a vote", () => {
  const payload = blindMatchView(MATCH_ID, { left: leftRun.events, right: rightRun.events });
  const serialized = JSON.stringify(payload);

  it("never contains model names, config names, cost, tokens, or pass/fail", () => {
    expect(findLeaks(payload, secrets)).toEqual([]);
  });

  it("does not contain the identifying strings anywhere in the serialized JSON", () => {
    for (const secret of secrets) {
      expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(serialized).not.toContain("score_computed");
    expect(serialized).not.toContain('"passed"');
  });

  it("carries only steps, elapsed time, and the answer as the summary", () => {
    expect(payload.voted).toBe(false);
    expect(payload.sides.left.summary).toEqual({
      finished: true,
      steps: 2,
      elapsed_ms: 1730,
      final_answer: "179.45",
    });
    expect(Object.keys(payload.sides.right.summary).sort()).toEqual([
      "elapsed_ms",
      "final_answer",
      "finished",
      "steps",
    ]);
  });

  it("keeps the two sides apart", () => {
    expect(new Set(payload.sides.left.events.map((event) => event.run_id))).toEqual(
      new Set([sideAlias(MATCH_ID, "left")]),
    );
    expect(new Set(payload.sides.right.events.map((event) => event.run_id))).toEqual(
      new Set([sideAlias(MATCH_ID, "right")]),
    );
  });
});

describe("summary of a run still in progress", () => {
  it("reports the step reached and no answer", () => {
    const partial = blindView(leftRun.events.slice(0, 4), MATCH_ID, "left");

    expect(summarizeBlindSide(partial)).toEqual({
      finished: false,
      steps: 1,
      elapsed_ms: null,
      final_answer: null,
    });
  });
});
