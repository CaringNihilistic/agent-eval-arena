"use client";

import type { TraceEvent } from "@arena/schema";

import { AnswerView } from "@/components/answer-view";
import type { MatchSide } from "@/lib/blind-view";
import type { Category } from "@/lib/types";

/** How each pane is told apart without relying on colour: a letter, a shape, a border style. */
export const PANE = {
  left: { letter: "A", shape: "▲", border: "border-solid" },
  right: { letter: "B", shape: "■", border: "border-dashed" },
} as const satisfies Record<MatchSide, { letter: string; shape: string; border: string }>;

/** The control tool an agent ends its run with. */
const SUBMIT_ANSWER = "submit_answer";

function seconds(ms: number | null): string | null {
  return ms === null ? null : `${(ms / 1000).toFixed(1)} s`;
}

function Collapsible({ summary, text }: { summary: string; text: string }) {
  return (
    <details className="rounded-md border bg-muted/40 text-xs">
      <summary className="cursor-pointer px-2 py-1 font-medium">{summary}</summary>
      <pre className="max-h-80 overflow-auto px-2 pb-2 font-mono whitespace-pre-wrap">{text}</pre>
    </details>
  );
}

function EventRow({ event, category }: { event: TraceEvent; category: Category }) {
  switch (event.type) {
    case "step_started":
      return (
        <h4 className="mt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Step {event.payload.step}
        </h4>
      );
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
      // The submitted answer is shown in full below; repeating it here is noise.
      if (event.payload.tool === SUBMIT_ANSWER) {
        return <p className="text-xs text-muted-foreground">Submitted its answer.</p>;
      }
      return (
        <div className="rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs break-words">
          <span className="font-semibold">{event.payload.tool}</span>
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
        <div className="rounded-md border px-2 py-1.5 text-xs">
          <span className="font-medium">{label}: </span>
          <span className="font-mono whitespace-pre-wrap">{output}</span>
        </div>
      );
    }
    case "error":
      return (
        <p role="alert" className="rounded-md border border-destructive/50 px-2 py-1.5 text-xs">
          Error: {event.payload.message}
        </p>
      );
    case "run_finished": {
      const stop = event.payload.stop_reason;
      return (
        <section className="mt-3 flex flex-col gap-2 border-t pt-3">
          <h4 className="text-sm font-semibold">Final answer</h4>
          {stop !== null && stop !== "answered" ? (
            <p className="text-xs text-muted-foreground">
              The run stopped before answering ({stop.replace("_", " ")}).
            </p>
          ) : null}
          <AnswerView answer={event.payload.final_answer} category={category} />
        </section>
      );
    }
    case "run_started":
    case "step_finished":
    case "score_computed":
      return null;
  }
}

/** One side of a match: the run's trace, then its final answer. */
export function TracePane({
  side,
  events,
  shown,
  steps,
  category,
  title,
}: {
  side: MatchSide;
  events: readonly TraceEvent[];
  /** How many events the playback has reached. */
  shown: number;
  steps: number;
  category: Category;
  /** The config's name, known only after the vote. */
  title?: string;
}) {
  const pane = PANE[side];
  const visible = events.slice(0, shown);
  const done = shown >= events.length;
  return (
    <section
      aria-label={`Agent ${pane.letter}`}
      className={`flex min-w-0 flex-col gap-2 rounded-xl border-2 ${pane.border} bg-card p-4`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">
          <span aria-hidden="true">{pane.shape} </span>Agent {pane.letter}
          {title ? <span className="font-normal text-muted-foreground"> · {title}</span> : null}
        </h3>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {done ? `${steps} ${steps === 1 ? "step" : "steps"}` : "working…"}
        </p>
      </header>
      <div className="flex flex-col gap-2">
        {visible.map((event) => (
          <EventRow key={event.seq} event={event} category={category} />
        ))}
      </div>
    </section>
  );
}
