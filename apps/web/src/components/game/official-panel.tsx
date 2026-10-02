"use client";

import { Parchment } from "@/components/theme/ornament";
import type { OfficialBenchmarks } from "@/lib/types";

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
    <Parchment as="section" className="flex flex-col gap-3">
      <h3 className="deco-title text-xl">Official benchmarks</h3>
      <p className="text-sm text-muted-foreground">
        Published by Anthropic. These measure different tasks from ours, at different settings.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Anthropic&apos;s published benchmark scores</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="deco-label py-2 pr-3 text-muted-foreground">
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
              <tr key={benchmark.id} className="border-b border-border align-top">
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
    </Parchment>
  );
}
