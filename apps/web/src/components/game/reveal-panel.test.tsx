import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { LetterCard } from "@/components/game/letter-card";
import { RevealPanel } from "@/components/game/reveal-panel";
import { blindView } from "@/lib/blind-view";
import type { RevealedLetter, RevealedRound } from "@/lib/types";
import { leftRun, rightRun, type FixtureRun } from "@/test/trace-fixtures";

vi.mock("@/lib/client-api", () => ({ fetchArt: async () => ({}) }));

function show(ui: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

function letter(
  run: FixtureRun,
  seat: "A" | "B",
  changes: Partial<RevealedLetter> = {},
): RevealedLetter {
  return {
    seat,
    guest: seat === "A" ? "pike" : "ivy",
    expression: seat === "A" ? "happy" : "shocked",
    model: run.config.model,
    display_name: run.config.display_name,
    run_id: run.runId,
    take: 1,
    holds: seat === "A",
    score:
      seat === "A"
        ? {
            passed: true,
            score: 1,
            scorer_type: "numeric_tolerance",
            explanation: "ok",
            checks: [],
          }
        : {
            passed: null,
            score: 0.5,
            scorer_type: "constraints",
            explanation: "Constraints met: 1 of 2.",
            checks: [
              { name: "at most 60 words", passed: true, detail: "53 words." },
              { name: "starts with 'Subject:'", passed: false, detail: "It does not." },
            ],
          },
    answer_words: 53,
    reference_cost_usd: 0.0042,
    cost_usd: 0,
    steps: 2,
    total_tokens: 903,
    latency_ms: 1730,
    stop_reason: "answered",
    totals: {
      runs: 30,
      scored_runs: 10,
      passes: 9,
      checks_met: 85,
      checks_total: 101,
      mean_answer_words: 79,
      mean_reference_cost_usd: 0.006,
    },
    final_answer: "179.45",
    events: run.events,
    ...changes,
  };
}

function round(changes: Partial<RevealedRound> = {}): RevealedRound {
  return {
    round_id: "dr.0123456789abcdef",
    mode: "drawing_room",
    kind: "duel",
    decided: true,
    task: {
      id: "t",
      title: "T",
      category: "agent",
      difficulty: "easy",
      prompt: "p",
      required_tools: [],
    },
    letters: [letter(leftRun, "A"), letter(rightRun, "B")],
    authors: [
      { model: "claude-haiku-4-5", label: "Haiku 4.5" },
      { model: "claude-opus-5-5", label: "Opus 5.5" },
      { model: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    ],
    trap: false,
    your_answer: { type: "trust", choice: "A" },
    confidence: "fairly",
    outcome: "none",
    points: 0,
    progress: { points_total: 140, rank: "Guest", unlocked: [] },
    crowd: { votes: 2, same_share: null },
    official: {
      checked: "2026-10-02",
      note: "n",
      sources: {
        s: {
          title: "Introducing Claude Opus 5.5",
          url: "https://www.anthropic.com/claude-opus-5-5",
          published: "2026-09-22",
          conditions: "Max effort.",
        },
      },
      benchmarks: [
        {
          id: "b",
          name: "CursorBench 4.0",
          area: "Agentic coding",
          scores: [{ model: "claude-opus-5-5", value: 57.8, display: "57.8%", source: "s" }],
        },
      ],
    },
    game: null,
    ...changes,
  };
}

describe("The Gathering in the Library", () => {
  it("unmasks each letter's author and shows the round's figures and the 30-task totals", () => {
    show(<RevealPanel round={round()} />);
    const first = screen.getByRole("article", { name: "Letter A" });

    expect(
      screen.getByRole("heading", { name: "The Gathering in the Library" }),
    ).toBeInTheDocument();
    expect(within(first).getByText("claude-opus-5-5")).toBeInTheDocument();
    expect(within(first).getByText(/53 words/)).toBeInTheDocument();
    expect(within(first).getByText(/\$0\.0042 at API rates/)).toBeInTheDocument();
    expect(
      within(first).getByText(/passed 9 of 10 with a right answer, met 85 of 101 rules/),
    ).toBeInTheDocument();
    expect(screen.getByText("Rules met 1/2")).toBeInTheDocument();
  });

  it("changes the guests' expressions: trusted happy, the other shocked", () => {
    show(<RevealPanel round={round()} />);

    expect(screen.getByAltText("Colonel Archibald Pike, pleased")).toHaveAttribute(
      "data-expression",
      "happy",
    );
    expect(screen.getByAltText("Miss Ivy Hartley, shocked")).toHaveAttribute(
      "data-expression",
      "shocked",
    );
  });

  it("says a preference earns no points", () => {
    show(<RevealPanel round={round()} />);

    expect(screen.getByTestId("points-gained")).toHaveTextContent("0 points · 140 in all · Guest");
    expect(screen.getByText(/no points are given for a preference/)).toBeInTheDocument();
  });

  it("tells the first few players they are among the first, and gives no percentage", () => {
    show(<RevealPanel round={round({ crowd: { votes: 4, same_share: null } })} />);

    expect(screen.getByText("You're among the first to dine here.")).toBeInTheDocument();
    expect(screen.queryByText(/of sleuths trusted/)).not.toBeInTheDocument();
  });

  it("gives the share who trusted the same letter once five have voted", () => {
    show(<RevealPanel round={round({ crowd: { votes: 5, same_share: 0.6 } })} />);

    expect(screen.getByText("60% of sleuths trusted the same letter.")).toBeInTheDocument();
    expect(screen.queryByText(/among the first/)).not.toBeInTheDocument();
  });

  it("announces a trap, the points for catching it, and a distinction unlocked", () => {
    const caught = round({
      trap: true,
      your_answer: { type: "accuse" },
      outcome: "right",
      points: 50,
      crowd: null,
      letters: [
        letter(leftRun, "A", { expression: "flustered" }),
        letter(leftRun, "B", { expression: "flustered", take: 2 }),
      ],
      progress: {
        points_total: 50,
        rank: "Guest",
        unlocked: [{ id: "spotted_the_impostor", name: "Spotted the Impostor", rule: "r" }],
      },
    });
    show(<RevealPanel round={caught} />);

    expect(screen.getByText("One author, two seats!")).toBeInTheDocument();
    expect(screen.getByTestId("points-gained")).toHaveTextContent("+50 points");
    expect(screen.getByText("Distinction: Spotted the Impostor")).toBeInTheDocument();
    expect(screen.getAllByAltText(/flustered/)).toHaveLength(2);
  });

  it("says so when the player was fooled or accused falsely", () => {
    const { unmount } = show(<RevealPanel round={round({ trap: true, outcome: "wrong" })} />);
    expect(screen.getByText(/You were fooled: one author wrote both letters/)).toBeInTheDocument();
    unmount();

    show(
      <RevealPanel
        round={round({ your_answer: { type: "accuse" }, outcome: "wrong", points: -30 })}
      />,
    );
    expect(screen.getByText(/A false accusation: two different authors/)).toBeInTheDocument();
    expect(screen.getByTestId("points-gained")).toHaveTextContent("-30 points");
  });

  it("shows the official benchmarks with their source, date, and the different-tasks note", () => {
    show(<RevealPanel round={round()} />);

    expect(screen.getByText("57.8%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Introducing Claude Opus 5.5" })).toHaveAttribute(
      "href",
      "https://www.anthropic.com/claude-opus-5-5",
    );
    expect(screen.getByText("Checked 2026-10-02.")).toBeInTheDocument();
    expect(screen.getByText(/These measure different tasks from ours/)).toBeInTheDocument();
  });
});

describe("a letter before the decision", () => {
  const blind = blindView(leftRun.events, "dr.x:A");

  it("shows the guest with a neutral face, and nothing about the author", () => {
    const { container } = show(
      <LetterCard
        seat="A"
        guest="pell"
        answer="179.45"
        events={blind}
        steps={2}
        category="agent"
      />,
    );

    expect(screen.getByAltText("Mrs. Dorcas Pell")).toHaveAttribute("data-expression", "neutral");
    expect(screen.getByRole("article", { name: "Letter A" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/claude|opus|haiku|sonnet|words|tokens|\$/i);
    expect(container.textContent).not.toContain("Thinking");
  });

  it("sets the letter's own words in the letter hand", () => {
    show(
      <LetterCard
        seat="B"
        guest="ivy"
        answer="Dear Sir"
        events={blind}
        steps={2}
        category="writing"
      />,
    );

    expect(screen.getByLabelText("Letter B, as written")).toHaveClass("letter-hand");
  });

  it("keeps a sealed letter sealed, and lays the writing of it open", () => {
    show(
      <LetterCard
        seat="A"
        guest="pike"
        answer={null}
        events={blind}
        steps={2}
        category="agent"
        sealed
        shown={3}
      />,
    );

    expect(screen.getByText("Sealed")).toBeInTheDocument();
    expect(screen.getByText("I will compute it.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Letter A, as written")).not.toBeInTheDocument();
  });
});
