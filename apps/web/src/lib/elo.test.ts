import { describe, expect, it } from "vitest";

import { eloRatings, eloTable, type EloVote } from "@/lib/elo";
import { percentile, rankDescending, seededRandom, wilson } from "@/lib/stats";

const vote = (choice: EloVote["choice"], left = "a", right = "b"): EloVote => ({
  left,
  right,
  choice,
});

describe("Elo", () => {
  it("matches a hand-computed win between equal players", () => {
    // Expected score 0.5 each, so the winner gains 32 * 0.5 = 16.
    const ratings = eloRatings([vote("left")]);

    expect(ratings.get("a")).toBe(1016);
    expect(ratings.get("b")).toBe(984);
  });

  it("matches a hand-computed tie after a win", () => {
    // After the win a = 1016, b = 984. Expected score for a:
    // 1 / (1 + 10^((984 - 1016) / 400)) = 0.54592. Change: 32 * (0.5 - 0.54592) = -1.4695.
    const ratings = eloRatings([vote("left"), vote("tie")]);

    expect(ratings.get("a")).toBeCloseTo(1014.5305, 3);
    expect(ratings.get("b")).toBeCloseTo(985.4695, 3);
  });

  it("scores 'both bad' like a tie and a right win as a left loss", () => {
    expect(eloRatings([vote("left"), vote("both_bad")])).toEqual(
      eloRatings([vote("left"), vote("tie")]),
    );
    expect(eloRatings([vote("right")]).get("b")).toBe(1016);
  });

  it("keeps the total rating constant", () => {
    const votes = [vote("left"), vote("right", "b", "c"), vote("tie", "c", "a"), vote("left")];
    const ratings = eloRatings(votes, ["a", "b", "c"]);

    expect([...ratings.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(3000, 6);
  });

  it("depends on vote order, which is why the log is replayed chronologically", () => {
    const forward = eloRatings([vote("left"), vote("right")]);
    const backward = eloRatings([vote("right"), vote("left")]);

    expect(forward.get("a")).not.toBe(backward.get("a"));
  });
});

describe("the preference table", () => {
  const votes = [
    vote("left"),
    vote("left"),
    vote("right"),
    vote("tie", "a", "c"),
    vote("left", "b", "c"),
    vote("both_bad", "c", "a"),
  ];

  it("counts wins, losses, and ties per config and sorts by rating", () => {
    const table = eloTable(votes, ["a", "b", "c"]);
    const a = table.find((row) => row.config === "a");

    expect(a).toMatchObject({ votes: 5, wins: 2, losses: 1, ties: 2 });
    expect(table.map((row) => row.elo)).toEqual(
      [...table.map((row) => row.elo)].sort((x, y) => y - x),
    );
  });

  it("gives the same interval every time for the same seed", () => {
    expect(eloTable(votes, ["a", "b", "c"])).toEqual(eloTable(votes, ["a", "b", "c"]));
    expect(eloTable(votes, ["a", "b", "c"], { seed: 1 })).not.toEqual(
      eloTable(votes, ["a", "b", "c"], { seed: 2 }),
    );
  });

  it("puts the interval around plausible ratings", () => {
    for (const row of eloTable(votes, ["a", "b", "c"])) {
      expect(row.ci_low).not.toBeNull();
      expect(row.ci_low!).toBeLessThanOrEqual(row.ci_high!);
      expect(row.ci_low!).toBeGreaterThan(800);
      expect(row.ci_high!).toBeLessThan(1200);
    }
  });

  it("lists a config with no votes at the starting rating and without an interval", () => {
    const table = eloTable([vote("left")], ["a", "b", "c"]);

    expect(table.find((row) => row.config === "c")).toEqual({
      config: "c",
      elo: 1000,
      ci_low: null,
      ci_high: null,
      votes: 0,
      wins: 0,
      losses: 0,
      ties: 0,
    });
    expect(eloTable([], ["a"])[0]).toMatchObject({ elo: 1000, ci_low: null, votes: 0 });
  });
});

describe("statistics helpers", () => {
  it("computes the Wilson interval", () => {
    // 8 of 10 at 95%: the textbook interval is 0.490 to 0.943.
    const interval = wilson(8, 10);

    expect(interval?.low).toBeCloseTo(0.49, 2);
    expect(interval?.high).toBeCloseTo(0.943, 2);
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(10, 10)?.high).toBe(1);
    expect(wilson(0, 10)?.low).toBe(0);
  });

  it("interpolates percentiles", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40], 1)).toBe(40);
  });

  it("ranks with shared places and leaves out missing values", () => {
    const ranks = rankDescending(
      new Map<string, number | null>([
        ["a", 0.9],
        ["b", 0.9],
        ["c", 0.5],
        ["d", null],
      ]),
    );

    expect(Object.fromEntries(ranks)).toEqual({ a: 1, b: 1, c: 3, d: null });
  });

  it("produces a repeatable sequence in [0, 1)", () => {
    const first = seededRandom(7);
    const second = seededRandom(7);
    const values = Array.from({ length: 50 }, () => first());

    expect(values).toEqual(Array.from({ length: 50 }, () => second()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBe(50);
  });
});
