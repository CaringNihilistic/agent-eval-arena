"use client";

import type { TraceEvent } from "@arena/schema";

import { SUBMIT_ANSWER } from "@/lib/blind-view";

function seconds(ms: number | null): string | null {
  return ms === null ? null : `${(ms / 1000).toFixed(1)} s`;
}

function Collapsible({ summary, text }: { summary: string; text: string }) {
  return (
    <details className="border border-border bg-muted text-xs">
      <summary className="cursor-pointer px-2 py-1 font-bold">{summary}</summary>
      <pre className="max-h-80 overflow-auto px-2 pb-2 font-mono whitespace-pre-wrap">{text}</pre>
    </details>
  );
}

function EventRow({ event }: { event: TraceEvent }) {
  switch (event.type) {
    case "step_started":
      return <h5 className="deco-label mt-2 text-muted-foreground">Step {event.payload.step}</h5>;
    case "llm_call": {
      const { output, latency_ms: latency, prompt_tokens: input } = event.payload;
      const meta = [
        seconds(latency),
        input === null ? null : `${input} in / ${event.payload.completion_tokens} out tokens`,
      ].filter(Boolean);
      return (
        <div className="flex flex-col gap-1.5">
          {output.thinking ? <Collapsible summary="Thinking" text={output.thinking} /> : null}
          {output.content ? (
            <p className="text-sm whitespace-pre-wrap">
              {output.content}
              {output.truncated ? " …" : ""}
            </p>
          ) : null}
          {meta.length > 0 ? (
            <p className="text-xs text-muted-foreground">Model call: {meta.join(", ")}</p>
          ) : null}
        </div>
      );
    }
    case "tool_call":
      // The submitted answer is the letter itself; repeating it here is noise.
      if (event.payload.tool === SUBMIT_ANSWER) {
        return <p className="text-xs text-muted-foreground">Sealed the letter.</p>;
      }
      return (
        <div className="border border-border bg-muted px-2 py-1.5 font-mono text-xs break-words">
          <span className="font-bold">{event.payload.tool}</span>
          <span className="text-muted-foreground"> called with </span>
          <span className="whitespace-pre-wrap">{JSON.stringify(event.payload.arguments)}</span>
        </div>
      );
    case "tool_result": {
      const { tool, success, output, truncated } = event.payload;
      if (tool === SUBMIT_ANSWER && success) return null;
      const label = `${tool} ${success ? "returned" : "failed"}${truncated ? " (cut short)" : ""}`;
      return output.length > 240 ? (
        <Collapsible summary={label} text={output} />
      ) : (
        <div className="border border-border px-2 py-1.5 text-xs">
          <span className="font-bold">{label}: </span>
          <span className="font-mono whitespace-pre-wrap">{output}</span>
        </div>
      );
    }
    case "error":
      return (
        <p role="alert" className="border border-destructive px-2 py-1.5 text-xs">
          Error: {event.payload.message}
        </p>
      );
    case "run_finished": {
      const stop = event.payload.stop_reason;
      return stop !== null && stop !== "answered" ? (
        <p className="text-xs text-muted-foreground">
          The writing stopped before a letter was finished ({stop.replace("_", " ")}).
        </p>
      ) : null;
    }
    case "run_started":
    case "step_finished":
    case "score_computed":
      return null;
  }
}

/** What an agent did, step by step: what it said, the tools it called, what came back. */
export function TraceList({
  events,
  shown,
}: {
  events: readonly TraceEvent[];
  /** How many events to show. Omit to show all. */
  shown?: number;
}) {
  const visible = shown === undefined ? events : events.slice(0, shown);
  return (
    <div className="flex flex-col gap-2">
      {visible.map((event) => (
        <EventRow key={event.seq} event={event} />
      ))}
    </div>
  );
}

/** True when a trace holds anything worth opening: more than the sealing of the letter. */
export function hasSomethingToShow(events: readonly TraceEvent[]): boolean {
  return events.some(
    (event) =>
      (event.type === "tool_call" && event.payload.tool !== SUBMIT_ANSWER) ||
      (event.type === "llm_call" && Boolean(event.payload.output.content)) ||
      (event.type === "llm_call" && Boolean(event.payload.output.thinking)) ||
      event.type === "error",
  );
}
