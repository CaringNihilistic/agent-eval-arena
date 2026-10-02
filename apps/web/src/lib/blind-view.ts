// The blind view: what a voter may see of a match before voting.
//
// This is the only implementation of redaction in the project. It must run on
// the server; the browser never receives the fields removed here. Any new field
// that reveals the result, the cost, the speed, or which config a side is must
// be handled below and added to the leak scan in src/test/leak-scan.ts.

import type { TraceEvent } from "@arena/schema";

export type MatchSide = "left" | "right";

/**
 * Stop reasons that reveal how much of its budget, or how long, a run took.
 * A voter still sees that the run ended without an answer.
 */
const HIDDEN_STOP_REASONS = new Set(["max_tokens", "max_cost", "timeout"]);

/** Shown instead of an error's own text, which can name the model or provider. */
export const REDACTED_ERROR_MESSAGE = "The run hit an error.";

/**
 * Every event carries this instead of its real time. The gaps between real
 * timestamps are the model's speed, and speed identifies the model.
 */
export const BLIND_TIMESTAMP = "1970-01-01T00:00:00+00:00";

/** What replaces a run id, so the unblinded run cannot be looked up. */
export function sideAlias(matchId: string, side: MatchSide): string {
  return `${matchId}:${side}`;
}

/**
 * One event as a voter who has not voted may see it, or null if the event
 * must not be sent at all.
 */
export function redactEvent(
  event: TraceEvent,
  matchId: string,
  side: MatchSide,
): TraceEvent | null {
  const envelope = {
    run_id: sideAlias(matchId, side),
    side,
    redacted: true,
    timestamp: BLIND_TIMESTAMP,
  };

  switch (event.type) {
    case "run_started":
      return { ...event, ...envelope, payload: { ...event.payload, config: null } };

    case "llm_call":
      return {
        ...event,
        ...envelope,
        payload: {
          ...event.payload,
          model: null,
          prompt_tokens: null,
          completion_tokens: null,
          cache_read_tokens: null,
          cache_write_tokens: null,
          cost_usd: null,
          reference_cost_usd: null,
          latency_ms: null,
          // Only some models think, so a thinking block gives the model away.
          output: { ...event.payload.output, thinking: null },
          // The system prompt identifies the config.
          input_preview: event.payload.input_preview.filter((message) => message.role !== "system"),
        },
      };

    case "tool_result":
      return { ...event, ...envelope, payload: { ...event.payload, latency_ms: null } };

    case "step_finished":
      return {
        ...event,
        ...envelope,
        payload: { ...event.payload, total_tokens: null, cost_usd: null, reference_cost_usd: null },
      };

    case "run_finished": {
      const stopReason = event.payload.stop_reason;
      return {
        ...event,
        ...envelope,
        payload: {
          ...event.payload,
          cost_usd: null,
          reference_cost_usd: null,
          total_tokens: null,
          latency_ms: null,
          stop_reason:
            stopReason !== null && HIDDEN_STOP_REASONS.has(stopReason) ? null : stopReason,
        },
      };
    }

    case "error":
      return {
        ...event,
        ...envelope,
        payload: { ...event.payload, message: REDACTED_ERROR_MESSAGE },
      };

    case "score_computed":
      // Pass or fail, and the constraint checks, are what the voter must not know yet.
      return null;

    case "step_started":
    case "tool_call":
      return { ...event, ...envelope };

    default: {
      // A new event type must be given a redaction rule before it can compile.
      const unhandled: never = event;
      throw new Error(`No redaction rule for event: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A run's events as a voter who has not voted may see them. */
export function blindView(
  events: readonly TraceEvent[],
  matchId: string,
  side: MatchSide,
): TraceEvent[] {
  return events
    .map((event) => redactEvent(event, matchId, side))
    .filter((event): event is TraceEvent => event !== null);
}

export interface BlindSideSummary {
  finished: boolean;
  steps: number;
  final_answer: string | null;
}

/** The only figures shown beside a trace before the vote: the step count and the answer. */
export function summarizeBlindSide(events: readonly TraceEvent[]): BlindSideSummary {
  let steps = 0;
  for (const event of events) {
    if (event.type === "step_started") {
      steps = Math.max(steps, event.payload.step);
    }
    if (event.type === "run_finished") {
      return {
        finished: true,
        steps: event.payload.steps,
        final_answer: event.payload.final_answer,
      };
    }
  }
  return { finished: false, steps, final_answer: null };
}

export interface BlindSide {
  summary: BlindSideSummary;
  events: TraceEvent[];
}

/** Both runs of a match as a voter who has not voted may see them. */
export function blindSides(
  matchId: string,
  runs: Record<MatchSide, readonly TraceEvent[]>,
): Record<MatchSide, BlindSide> {
  const side = (name: MatchSide): BlindSide => {
    const events = blindView(runs[name], matchId, name);
    return { summary: summarizeBlindSide(events), events };
  };
  return { left: side("left"), right: side("right") };
}
