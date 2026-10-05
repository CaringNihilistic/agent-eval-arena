import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ACCUSE_LABEL, DecisionPanel } from "@/components/game/decision-panel";
import type { RoundKind, Seat } from "@/lib/types";

const AUTHORS = [
  { model: "claude-haiku-4-5", label: "Haiku 4.5" },
  { model: "claude-opus-5-5", label: "Opus 5.5" },
  { model: "claude-sonnet-5-5", label: "Sonnet 5.5" },
];

function setup(kind: RoundKind, seats: Seat[] = ["A", "B"]) {
  const onSubmit = vi.fn();
  render(
    <DecisionPanel
      kind={kind}
      seats={seats}
      authors={AUTHORS}
      pending={false}
      error={null}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

const submit = () => screen.getByRole("button", { name: "Give your verdict" });

describe("the verdict panel", () => {
  it("offers the four Drawing Room answers and the accusation", () => {
    setup("duel");

    for (const name of [
      "Trust letter A",
      "Equally good",
      "Neither",
      "Trust letter B",
      ACCUSE_LABEL,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(ACCUSE_LABEL).toBe("Accuse: the same model wrote both");
    expect(
      screen.getByRole("heading", { name: "Which letter answers the task better?" }),
    ).toBeInTheDocument();
  });

  it("asks how sure the player is, with three levels, in every kind of round", () => {
    for (const kind of ["duel", "ranking", "author", "timetable"] as const) {
      const { unmount } = render(
        <DecisionPanel
          kind={kind}
          seats={kind === "ranking" ? ["A", "B", "C"] : ["A"]}
          authors={AUTHORS}
          pending={false}
          error={null}
          onSubmit={() => {}}
        />,
      );
      for (const name of ["A hunch", "Fairly sure", "Certain"]) {
        expect(screen.getByRole("button", { name })).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("sends nothing until both an answer and a confidence are chosen", async () => {
    const { onSubmit, user } = setup("duel");

    expect(submit()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Trust letter B" }));
    expect(submit()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Certain" }));
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ type: "trust", choice: "B" }, "certain");
  });

  it("sends an accusation in place of a preference", async () => {
    const { onSubmit, user } = setup("duel");

    await user.click(screen.getByRole("button", { name: "Trust letter A" }));
    await user.click(screen.getByRole("button", { name: ACCUSE_LABEL }));
    await user.click(screen.getByRole("button", { name: "A hunch" }));
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ type: "accuse" }, "hunch");
    expect(screen.getByRole("button", { name: ACCUSE_LABEL })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Trust letter A" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("takes a ranking one letter at a time, and can start again", async () => {
    const { onSubmit, user } = setup("ranking", ["A", "B", "C"]);

    await user.click(screen.getByRole("button", { name: "Letter C" }));
    await user.click(screen.getByRole("button", { name: "Letter A" }));
    await user.click(screen.getByRole("button", { name: "Fairly sure" }));
    expect(submit()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Letter B" }));
    expect(screen.getByText("Your order: C, A, B.")).toBeInTheDocument();
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      { type: "ranking", order: ["C", "A", "B"] },
      "fairly",
    );

    await user.click(screen.getByRole("button", { name: "Start again" }));
    expect(submit()).toBeDisabled();
  });

  it("offers no accusation in the Library, where all three authors are always present", () => {
    setup("ranking", ["A", "B", "C"]);

    expect(screen.queryByRole("button", { name: ACCUSE_LABEL })).not.toBeInTheDocument();
  });

  it("offers the three authors, and no accusation, in a single-letter round", async () => {
    const { onSubmit, user } = setup("author", ["A"]);

    expect(
      screen.getByRole("heading", { name: "Which AI model wrote this letter?" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCUSE_LABEL })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sonnet 5.5" }));
    await user.click(screen.getByRole("button", { name: "A hunch" }));
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      { type: "author", model: "claude-sonnet-5-5" },
      "hunch",
    );
  });

  it("offers 'It holds' and 'It falls apart' for the timetable, and no accusation", async () => {
    const { onSubmit, user } = setup("timetable", ["A"]);

    expect(screen.queryByRole("button", { name: ACCUSE_LABEL })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "It falls apart" }));
    await user.click(screen.getByRole("button", { name: "Fairly sure" }));
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ type: "call", holds: false }, "fairly");
  });
});
