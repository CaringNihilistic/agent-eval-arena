"use client";

import { PANE } from "@/components/arena/trace-pane";
import type { MatchSide } from "@/lib/blind-view";
import type { Choice } from "@/lib/elo";
import type { OfficialBenchmarks, RevealedMatchResponse, RevealedSide } from "@/lib/types";

const CHOICE_LABELS: Record<Choice, string> = {
  left: "Agent A was better",
  right: "Agent B was better",
  tie: "Tie",
  both_bad: "Both were bad",
};

function usd(value: number): string {
  return value === 0 ? "$0" : `$${value.toFixed(4)}`;
}

/** What our scorer found. Pass or fail where there is a right answer; otherwise the checks. */
export function ScoreSummary({ side }: { side: RevealedSide }) {
  const score = side.score;
  if (!score) return <p>Not scored.</p>;
  if (score.passed !== null) {
    return (
      <div>
        <p className="font-semibold">{score.passed ? "✓ Passed" : "✗ Failed"}</p>
        <p className="text-xs text-muted-foreground">{score.explanation}</p>
      </div>
    );
  }
  const met = score.checks.filter((check) => check.passed).length;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">
        Constraints met {met}/{score.checks.length}
      </p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {score.checks.map((check) => (
          <li key={check.name} title={check.detail}>
            <span aria-hidden="true">{check.passed ? "✓" : "✗"} </span>
            <span className="sr-only">{check.passed ? "Met: " : "Not met: "}</span>
            {check.name}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Limits the task stated, checked automatically. Not a measure of quality.
      </p>
    </div>
  );
}

function Scorecard({ sides }: { sides: Record<MatchSide, RevealedSide> }) {
  const rows: { label: string; value: (side: RevealedSide) => React.ReactNode }[] = [
    { label: "Model", value: (side) => <span className="font-semibold">{side.config.model}</span> },
    { label: "Our scorer", value: (side) => <ScoreSummary side={side} /> },
    { label: "Steps", value: (side) => side.metrics.steps },
    { label: "Tool calls", value: (side) => side.metrics.tool_calls },
    { label: "Tokens", value: (side) => side.metrics.total_tokens.toLocaleString("en-US") },
    {
      label: "Active time",
      value: (side) => `${(side.metrics.latency_ms / 1000).toFixed(1)} s`,
    },
    { label: "Answer length", value: (side) => `${side.metrics.answer_words} words` },
    {
      label: "Cost",
      value: (side) =>
        `${usd(side.metrics.cost_usd)} actual, ${usd(side.metrics.reference_cost_usd)} at API rates`,
    },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Measured results for both agents in this match</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">
              Measured here
            </th>
            {(["left", "right"] as const).map((side) => (
              <th key={side} scope="col" className="py-2 pr-3">
                <span aria-hidden="true">{PANE[side].shape} </span>Agent {PANE[side].letter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b align-top">
              <th scope="row" className="py-2 pr-3 font-medium text-muted-foreground">
                {row.label}
              </th>
              <td className="py-2 pr-3">{row.value(sides.left)}</td>
              <td className="py-2 pr-3">{row.value(sides.right)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Anthropic's published scores for the models in view, with where each came from. */
export function OfficialBenchmarksPanel({
  official,
  models,
}: {
  official: OfficialBenchmarks;
  models: readonly string[];
}) {
  const usedSources = new Set(
    official.benchmarks.flatMap((benchmark) => benchmark.scores.map((score) => score.source)),
  );
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h3 className="text-base font-semibold">Official benchmarks</h3>
      <p className="text-sm text-muted-foreground">
        Published by Anthropic. These measure different tasks from ours, at different settings.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Anthropic&apos;s published benchmark scores</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">
                Benchmark
              </th>
              {models.map((model) => (
                <th key={model} scope="col" className="py-2 pr-3">
                  {model}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {official.benchmarks.map((benchmark) => (
              <tr key={benchmark.id} className="border-b align-top">
                <th scope="row" className="py-2 pr-3 font-normal">
                  {benchmark.name}
                  <span className="block text-xs text-muted-foreground">{benchmark.area}</span>
                </th>
                {models.map((model) => {
                  const score = benchmark.scores.find((item) => item.model === model);
                  return (
                    <td key={model} className="py-2 pr-3">
                      {score ? (
                        <>
                          {score.display}
                          {score.note ? (
                            <span className="block text-xs text-muted-foreground">
                              {score.note}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">not published</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {Object.entries(official.sources)
          .filter(([id]) => usedSources.has(id))
          .map(([id, source]) => (
            <li key={id}>
              Source:{" "}
              <a href={source.url} target="_blank" rel="noreferrer noopener" className="underline">
                {source.title}
              </a>{" "}
              (published {source.published}). {source.conditions}
            </li>
          ))}
        <li>Checked {official.checked}.</li>
      </ul>
    </section>
  );
}

/** Shown after the vote: who was who, what we measured, and what Anthropic publishes. */
export function Reveal({ match }: { match: RevealedMatchResponse }) {
  const { sides, tallies } = match;
  const total = tallies.left + tallies.right + tallies.tie + tallies.both_bad;
  const models = [...new Set([sides.left.config.model, sides.right.config.model])];
  return (
    <section aria-label="Results" className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-xl font-semibold">
          Agent A was {sides.left.config.model}. Agent B was {sides.right.config.model}.
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You voted: {CHOICE_LABELS[match.your_vote]}. All {total} {total === 1 ? "vote" : "votes"}{" "}
          on this match: A {tallies.left}, B {tallies.right}, tie {tallies.tie}, both bad{" "}
          {tallies.both_bad}.
        </p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <Scorecard sides={sides} />
      </div>
      <OfficialBenchmarksPanel official={match.official} models={models} />
    </section>
  );
}
