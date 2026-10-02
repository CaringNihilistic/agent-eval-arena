"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { OfficialBenchmarksPanel } from "@/components/arena/reveal";
import { Button } from "@/components/ui/button";
import { fetchLeaderboard, type LeaderboardResponse } from "@/lib/client-api";
import type { PickRate } from "@/lib/leaderboard";
import type { Interval } from "@/lib/stats";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function range(interval: Interval | null): string {
  return interval === null
    ? ""
    : ` (${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%)`;
}

function rank(value: number | null): string {
  return value === null ? "—" : `#${value}`;
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b">
            {head.map((label) => (
              <th key={label} scope="col" className="py-2 pr-4 font-medium text-muted-foreground">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index} className="border-b align-top">
              {cells.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row" className="py-2 pr-4 font-semibold">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex} className="py-2 pr-4">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {children}
    </section>
  );
}

function rateLine(rate: PickRate): string {
  return rate.votes === 0
    ? "no votes yet"
    : `${percent(rate.rate)}${range(rate.ci)} of ${rate.votes} votes`;
}

function Boards({ board }: { board: LeaderboardResponse }) {
  const name = (config: string) =>
    board.headline.find((row) => row.config === config)?.model ?? config;
  const agreement = board.agreement;
  return (
    <>
      <Panel
        title="Three rankings"
        note="Visitors' blind votes, Anthropic's published benchmarks, and this site's automatic scorer. Where they disagree is the interesting part."
      >
        <Table
          caption="Rank of each model by visitor votes, official benchmarks, and our scorer"
          head={["Model", "Visitor votes (Elo)", "Official benchmarks", "Our scorer"]}
          rows={board.headline.map((row) => [
            row.model,
            row.votes === 0 ? "— (no votes yet)" : `${rank(row.elo_rank)} · ${Math.round(row.elo)}`,
            row.official_rank === null ? "— (no shared benchmark)" : rank(row.official_rank),
            row.mean_score === null ? "—" : `${rank(row.scorer_rank)} · ${percent(row.mean_score)}`,
          ])}
        />
        <p className="text-xs text-muted-foreground">
          Official rank compares two models only on benchmarks Anthropic reports for both. Our
          scorer counts a pass as 1, a fail as 0, and an open-ended answer as the share of stated
          limits it respected. The official rank does not change with the category filter.
        </p>
      </Panel>

      <Panel
        title="Visitor preference"
        note={`Elo from ${board.votes} blind ${board.votes === 1 ? "vote" : "votes"}: K=32, start 1000, replayed in vote order. The range is a 95% bootstrap interval.`}
      >
        <Table
          caption="Elo ratings from visitor votes"
          head={["Model", "Elo", "95% interval", "Votes", "Won", "Lost", "Tied"]}
          rows={board.preference.map((row) => [
            name(row.config),
            Math.round(row.elo),
            row.ci_low === null || row.ci_high === null
              ? "—"
              : `${Math.round(row.ci_low)}–${Math.round(row.ci_high)}`,
            row.votes,
            row.wins,
            row.losses,
            row.ties,
          ])}
        />
      </Panel>

      <Panel
        title="Our scorer"
        note="Pass rate covers code and agent tasks, which have a right answer. Constraints met covers the open-ended tasks and says only that stated limits were respected, not that the answer was good."
      >
        <Table
          caption="Automatic scores and costs per model"
          head={[
            "Model",
            "Pass rate",
            "Constraints met",
            "Mean answer",
            "Mean steps",
            "Mean active time",
            "Mean cost at API rates",
          ]}
          rows={board.objective.map((row) => [
            name(row.config),
            row.scored_runs === 0
              ? "—"
              : `${row.passes}/${row.scored_runs} · ${percent(row.pass_rate)}${range(row.pass_ci)}`,
            row.checks_total === 0
              ? "—"
              : `${row.checks_met}/${row.checks_total} · ${percent(row.constraints_met_rate)}`,
            row.mean_answer_words === null ? "—" : `${Math.round(row.mean_answer_words)} words`,
            row.mean_steps === null ? "—" : row.mean_steps.toFixed(1),
            row.mean_latency_ms === null ? "—" : `${(row.mean_latency_ms / 1000).toFixed(1)} s`,
            row.mean_reference_cost_usd === null
              ? "—"
              : `$${row.mean_reference_cost_usd.toFixed(4)}`,
          ])}
        />
        <p className="text-xs text-muted-foreground">
          Every run cost $0: they ran on a subscription. The cost column applies Anthropic&apos;s
          list prices to the measured tokens.
        </p>
      </Panel>

      <OfficialBenchmarksPanel
        official={board.official_data}
        models={board.headline.map((row) => row.model)}
      />

      <Panel title="Checks on the votes">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-medium">Votes agree with the scorer</dt>
            <dd>
              {agreement.decisive_votes === 0
                ? "No votes yet on a match where exactly one side passed."
                : `${percent(agreement.agreement_rate)}${range(agreement.ci)} of ${agreement.decisive_votes} votes picked the side that passed.`}{" "}
              <span className="text-muted-foreground">Code and agent tasks only.</span>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Longer answer picked</dt>
            <dd>
              {rateLine(board.length_bias.overall)}.{" "}
              <span className="text-muted-foreground">
                Open-ended tasks; 50% means no bias. {board.length_bias.excluded} ties or
                equal-length pairs left out.
              </span>
            </dd>
          </div>
          <div>
            <dt className="font-medium">Left pane picked</dt>
            <dd>
              {rateLine(board.position_bias)}.{" "}
              <span className="text-muted-foreground">50% means no position bias.</span>
            </dd>
          </div>
        </dl>
      </Panel>
    </>
  );
}

export function LeaderboardClient() {
  const [category, setCategory] = useState<Category | null>(null);
  const board = useQuery({
    queryKey: ["leaderboard", category],
    queryFn: () => fetchLeaderboard(category),
  });
  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Category</legend>
        <div className="flex flex-wrap gap-2">
          {[null, ...CATEGORIES].map((option) => (
            <Button
              key={option ?? "all"}
              variant={option === category ? "default" : "outline"}
              aria-pressed={option === category}
              onClick={() => setCategory(option)}
            >
              {option === null ? "All" : CATEGORY_LABELS[option]}
            </Button>
          ))}
        </div>
      </fieldset>
      {board.isPending ? <p role="status">Loading the leaderboard…</p> : null}
      {board.isError ? <p role="alert">{board.error.message}</p> : null}
      {board.data ? <Boards board={board.data} /> : null}
    </div>
  );
}
