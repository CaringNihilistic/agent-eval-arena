"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { OfficialBenchmarksPanel } from "@/components/game/official-panel";
import { Parchment } from "@/components/theme/ornament";
import { Button } from "@/components/ui/button";
import { fetchLeaderboard, type LeaderboardResponse } from "@/lib/client-api";
import { guest as guestById } from "@/lib/guests";
import type { PickRate } from "@/lib/leaderboard";
import type { Interval } from "@/lib/stats";
import { CATEGORIES, CATEGORY_LABELS, MODE_NAMES, type Category, type Mode } from "@/lib/types";

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function range(interval: Interval | null): string {
  return interval === null
    ? ""
    : ` (${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%)`;
}

function rank(value: number | null): string {
  return value === null ? "—" : `No. ${value}`;
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {head.map((label) => (
              <th key={label} scope="col" className="deco-label py-2 pr-4 text-muted-foreground">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index} className="border-b border-border align-top">
              {cells.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row" className="py-2 pr-4 font-bold">
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

function Entry({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Parchment as="section" className="flex flex-col gap-3">
      <h2 className="deco-title text-2xl">{title}</h2>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {children}
    </Parchment>
  );
}

function rateLine(rate: PickRate): string {
  return rate.votes === 0
    ? "no votes yet"
    : `${percent(rate.rate)}${range(rate.ci)} of ${rate.votes} votes`;
}

function Entries({ board }: { board: LeaderboardResponse }) {
  const name = (config: string) =>
    board.headline.find((row) => row.config === config)?.model ?? config;
  const agreement = board.agreement;
  const byMode = Object.entries(board.votes_by_mode)
    .map(([mode, count]) => `${count} from ${MODE_NAMES[mode as Mode]}`)
    .join(", ");
  return (
    <>
      <Entry
        title="Three rankings"
        note="Players' blind preferences, Anthropic's published benchmarks, and this site's automatic scorer. Where they disagree is the interesting part."
      >
        <Table
          caption="Rank of each author by player votes, official benchmarks, and our scorer"
          head={["Author", "Players (Elo)", "Official benchmarks", "Our scorer"]}
          rows={board.headline.map((row) => [
            row.model,
            row.votes === 0 ? "— (no votes yet)" : `${rank(row.elo_rank)} · ${Math.round(row.elo)}`,
            row.official_rank === null ? "— (no shared benchmark)" : rank(row.official_rank),
            row.mean_score === null ? "—" : `${rank(row.scorer_rank)} · ${percent(row.mean_score)}`,
          ])}
        />
        <p className="text-xs text-muted-foreground">
          Official rank compares two models only on benchmarks Anthropic reports for both. Our
          scorer counts a pass as 1, a fail as 0, and an open-ended letter as the share of stated
          rules it met. The official rank does not change with the category.
        </p>
      </Entry>

      <Entry
        title="Players' preference"
        note={`Elo from ${board.votes} blind comparisons${byMode ? ` (${byMode})` : ""}: K=32, start 1000, replayed in order. Only preferences from The Drawing Room and The Library Gathering count, and never a round where one author held both seats. The range is a 95% bootstrap interval.`}
      >
        <Table
          caption="Elo ratings from players' preferences"
          head={["Author", "Elo", "95% interval", "Comparisons", "Won", "Lost", "Tied"]}
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
      </Entry>

      <Entry
        title="Our scorer"
        note="First run of each author on each task. Pass rate covers code and agent tasks, which have a right answer. Rules met covers the open-ended tasks and says only that stated limits were respected, not that the letter was good."
      >
        <Table
          caption="Automatic scores and costs per author"
          head={[
            "Author",
            "Pass rate",
            "Rules met",
            "Mean letter",
            "Mean steps",
            "Mean time",
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
            row.runs === 0 ? "—" : `${Math.round(row.mean_answer_words)} words`,
            row.mean_steps === null ? "—" : row.mean_steps.toFixed(1),
            row.mean_latency_ms === null ? "—" : `${(row.mean_latency_ms / 1000).toFixed(1)} s`,
            row.runs === 0 ? "—" : `$${row.mean_reference_cost_usd.toFixed(4)}`,
          ])}
        />
        <p className="text-xs text-muted-foreground">
          Every run cost $0: they ran on a subscription. The cost column applies Anthropic&apos;s
          list prices to the measured tokens.
        </p>
      </Entry>

      <OfficialBenchmarksPanel
        official={board.official_data}
        models={board.headline.map((row) => row.model)}
      />

      <Entry
        title="Is the game fair?"
        note="Guests and seats are dealt at random, so neither should sway a vote. These figures check that."
      >
        {board.costume_bias && board.position_bias ? (
          <>
            <Table
              caption="How often each guest's letter was trusted"
              head={["Guest", "Letter trusted", "Of votes with this guest"]}
              rows={board.costume_bias.map((row) => [
                guestById(row.guest).name,
                `${percent(row.rate)}${range(row.ci)}`,
                row.votes,
              ])}
            />
            <p className="text-sm">
              <span className="font-bold">Costume bias:</span> every guest should sit near 50%. A
              guest well above it is being trusted for the costume, whoever wrote the letter.
            </p>
            <p className="text-sm">
              <span className="font-bold">Position bias:</span> the first letter shown was trusted
              in {rateLine(board.position_bias)}. 50% means none.
            </p>
          </>
        ) : (
          <p className="text-sm" data-testid="bias-pending">
            Costume bias and position bias are reported after {board.bias_votes_needed} two-letter
            votes. There are {board.bias_votes} so far.
          </p>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-bold">Votes agree with the scorer</dt>
            <dd>
              {agreement.decisive_votes === 0
                ? "No votes yet on a round where exactly one letter passed."
                : `${percent(agreement.agreement_rate)}${range(agreement.ci)} of ${agreement.decisive_votes} votes trusted the letter that passed.`}{" "}
              <span className="text-muted-foreground">Code and agent tasks only.</span>
            </dd>
          </div>
          <div>
            <dt className="font-bold">Longer letter trusted</dt>
            <dd>
              {rateLine(board.length_bias.overall)}.{" "}
              <span className="text-muted-foreground">
                Open-ended tasks; 50% means no bias. {board.length_bias.excluded} left out (equal,
                neither, or the same length).
              </span>
            </dd>
          </div>
        </dl>
      </Entry>
    </>
  );
}

export function RecordClient() {
  const [category, setCategory] = useState<Category | null>(null);
  const board = useQuery({
    queryKey: ["leaderboard", category],
    queryFn: () => fetchLeaderboard(category),
  });
  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="deco-label mb-2 text-muted-foreground">Kind of task</legend>
        <div className="flex flex-wrap gap-2">
          {[null, ...CATEGORIES].map((option) => (
            <Button
              key={option ?? "all"}
              variant="outline"
              aria-pressed={option === category}
              onClick={() => setCategory(option)}
            >
              {option === null ? "All" : CATEGORY_LABELS[option]}
            </Button>
          ))}
        </div>
      </fieldset>
      {board.isPending ? <p role="status">Fetching the record…</p> : null}
      {board.isError ? <p role="alert">{board.error.message}</p> : null}
      {board.data ? <Entries board={board.data} /> : null}
    </div>
  );
}
