import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Reveal } from "@/components/arena/reveal";
import { TracePane } from "@/components/arena/trace-pane";
import { blindView } from "@/lib/blind-view";
import type { RevealedMatchResponse, RevealedSide } from "@/lib/types";
import { leftRun, rightRun, type FixtureRun } from "@/test/trace-fixtures";

describe("the trace pane", () => {
  const blind = blindView(leftRun.events, "m", "left");

  it("shows only the events the playback has reached", () => {
    render(<TracePane side="left" events={blind} shown={3} steps={2} category="agent" />);

    expect(screen.getByText("I will compute it.")).toBeInTheDocument();
    expect(screen.queryByText("Final answer")).not.toBeInTheDocument();
    expect(screen.getByText("working…")).toBeInTheDocument();
  });

  it("shows the tool calls, their results, and the final answer once finished", () => {
    render(
      <TracePane side="left" events={blind} shown={blind.length} steps={2} category="agent" />,
    );

    expect(screen.getByText("calculator")).toBeInTheDocument();
    expect(screen.getByText("calculator returned:")).toBeInTheDocument();
    expect(screen.getByText("Final answer")).toBeInTheDocument();
    expect(screen.getByText("2 steps")).toBeInTheDocument();
  });

  it("names each pane with a letter and a shape, not with colour alone", () => {
    render(<TracePane side="right" events={blind} shown={0} steps={0} category="agent" />);

    expect(screen.getByRole("region", { name: "Agent B" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent B" })).toHaveTextContent("■ Agent B");
  });

  it("shows no thinking, timing, or tokens before the vote, and all three after", () => {
    const { container, unmount } = render(
      <TracePane side="left" events={blind} shown={blind.length} steps={2} category="agent" />,
    );
    expect(container.textContent).not.toContain("Thinking");
    expect(container.textContent).not.toContain("Model call");
    unmount();

    render(
      <TracePane
        side="left"
        events={leftRun.events}
        shown={leftRun.events.length}
        steps={2}
        category="agent"
        title={leftRun.config.display_name}
      />,
    );
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("Model call: 0.8 s, 412 in / 38 out tokens")).toBeInTheDocument();
    expect(screen.getByText(/Claude Opus 5\.5, full prompt/)).toBeInTheDocument();
  });
});

function side(run: FixtureRun, passed: boolean): RevealedSide {
  return {
    config: { id: run.config.id, display_name: run.config.display_name, model: run.config.model },
    run_id: run.runId,
    metrics: {
      steps: 2,
      tool_calls: 1,
      total_tokens: 903,
      prompt_tokens: 800,
      completion_tokens: 103,
      cost_usd: 0,
      reference_cost_usd: 0.000871,
      latency_ms: 1730,
      answer_words: 1,
      stop_reason: "answered",
    },
    score: passed
      ? { passed: true, score: 1, scorer_type: "numeric_tolerance", explanation: "ok", checks: [] }
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
    final_answer: "179.45",
    events: run.events,
  };
}

describe("the reveal", () => {
  const match: RevealedMatchResponse = {
    match_id: "m",
    voted: true,
    your_vote: "left",
    task: {
      id: "t",
      title: "T",
      category: "agent",
      difficulty: "easy",
      prompt: "p",
      required_tools: [],
    },
    sides: { left: side(leftRun, true), right: side(rightRun, false) },
    tallies: { left: 3, right: 1, tie: 0, both_bad: 0 },
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
  };

  it("names both models and shows the vote tallies", () => {
    render(<Reveal match={match} />);

    expect(
      screen.getByRole("heading", {
        name: "Agent A was claude-opus-5-5. Agent B was claude-haiku-4-5.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/All 4 votes on this match: A 3, B 1/)).toBeInTheDocument();
  });

  it("shows pass or fail where there is a right answer and constraints met otherwise", () => {
    render(<Reveal match={match} />);

    expect(screen.getByText("✓ Passed")).toBeInTheDocument();
    expect(screen.getByText("Constraints met 1/2")).toBeInTheDocument();
    expect(screen.getByText(/Not a measure of quality/)).toBeInTheDocument();
  });

  it("shows official scores with their source link, date, and the different-tasks note", () => {
    render(<Reveal match={match} />);

    expect(screen.getByText("57.8%")).toBeInTheDocument();
    expect(screen.getByText("not published")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Introducing Claude Opus 5.5" })).toHaveAttribute(
      "href",
      "https://www.anthropic.com/claude-opus-5-5",
    );
    expect(screen.getByText("Checked 2026-10-02.")).toBeInTheDocument();
    expect(screen.getByText(/These measure different tasks from ours/)).toBeInTheDocument();
  });
});
