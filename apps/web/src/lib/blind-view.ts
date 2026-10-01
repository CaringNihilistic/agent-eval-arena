// The blind view: what a voter may see of a match before voting.
//
// This is the only implementation of redaction in the project. It must run on
// the server; the browser never receives the fields removed here. Any new field
// that reveals the result, the cost, or which config a side is must be handled
// below and added to the leak scan in blind-view.test.ts.

import type { TraceEvent } from "@arena/schema";

export type MatchSide = "left" | "right";

/** Stop reasons that reveal how much of its budget a run spent. */
const BUDGET_STOP_REASONS = new Set(["max_tokens", "max_cost"]);

/** Shown instead of an error's own text, which can name the model or provider. */
export const REDACTED_ERROR_MESSAGE = "The run hit an error.";

/** What replaces a run id, so the unblinded run permalink cannot be found. */
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
  const envelope = { run_id: sideAlias(matchId, side), side, redacted: true };

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
          // The system prompt identifies the config.
          input_preview: event.payload.input_preview.filter((message) => message.role !== "system"),
        },
      };

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
          stop_reason:
            stopReason !== null && BUDGET_STOP_REASONS.has(stopReason) ? null : stopReason,
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
      // Pass or fail is exactly what the voter must not know yet.
      return null;

    case "step_started":
    case "tool_call":
    case "tool_result":
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
  elapsed_ms: number | null;
  final_answer: string | null;
}

/** The only figures shown beside a trace before the vote: steps, elapsed time, the answer. */
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
        elapsed_ms: event.payload.latency_ms,
        final_answer: event.payload.final_answer,
      };
    }
  }
  return { finished: false, steps, elapsed_ms: null, final_answer: null };
}

export interface BlindMatchView {
  match_id: string;
  voted: false;
  sides: Record<MatchSide, { summary: BlindSideSummary; events: TraceEvent[] }>;
}

/** Everything about a match's runs that is sent to a voter who has not voted. */
export function blindMatchView(
  matchId: string,
  runs: Record<MatchSide, readonly TraceEvent[]>,
): BlindMatchView {
  const side = (name: MatchSide) => {
    const events = blindView(runs[name], matchId, name);
    return { summary: summarizeBlindSide(events), events };
  };
  return { match_id: matchId, voted: false, sides: { left: side("left"), right: side("right") } };
}
