import { describe, expect, it } from "vitest";

import {
  answerFits,
  DISTINCTIONS,
  earnedDistinctions,
  judge,
  morningPostState,
  newlyEarned,
  POINTS,
  rankFor,
  shareSquares,
  totalPoints,
  weekendState,
} from "@/lib/scoring";
import type { Answer, DecisionRecord, Outcome } from "@/lib/types";
import { authorRound, decision, HAIKU, letter, OPUS, SONNET } from "@/test/decisions";

const AUTHORS = [HAIKU, OPUS, SONNET];
const facts = { trap: false, model: OPUS, holds: true };

describe("judging an answer", () => {
  it("gives a preference no points, whichever letter is trusted", () => {
    const choices = ["A", "B", "equal", "neither"] as const;
    for (const choice of choices) {
      expect(judge("duel", { type: "trust", choice }, facts)).toEqual({
        outcome: "none",
        points: 0,
      });
    }
    expect(judge("ranking", { type: "ranking", order: ["B", "A", "C"] }, facts)).toEqual({
      outcome: "none",
      points: 0,
    });
  });

  it("has no input through which other players' votes could earn points", () => {
    // judge sees the round's facts and the answer, and nothing else.
    expect(judge.length).toBe(3);
    expect(Object.values(POINTS).sort((a, b) => a - b)).toEqual([-30, 40, 50, 100]);
  });

  it("scores an accusation: fifty if one author held both seats, thirty lost if not", () => {
    expect(judge("duel", { type: "accuse" }, { ...facts, trap: true })).toEqual({
      outcome: "right",
      points: 50,
    });
    expect(judge("duel", { type: "accuse" }, facts)).toEqual({ outcome: "wrong", points: -30 });
    // All three authors are present in a ranking, so an accusation there is always wrong.
    expect(judge("ranking", { type: "accuse" }, facts)).toEqual({ outcome: "wrong", points: -30 });
  });

  it("counts trusting a letter in a trap as fooled: wrong, but no points lost", () => {
    const fooled = judge("duel", { type: "trust", choice: "A" }, { ...facts, trap: true });

    expect(fooled).toEqual({ outcome: "wrong", points: 0 });
    expect(judge("duel", { type: "trust", choice: "equal" }, { ...facts, trap: true })).toEqual(
      fooled,
    );
  });

  it("scores naming the author", () => {
    expect(judge("author", { type: "author", model: OPUS }, facts)).toEqual({
      outcome: "right",
      points: 100,
    });
    expect(judge("author", { type: "author", model: HAIKU }, facts)).toEqual({
      outcome: "wrong",
      points: 0,
    });
  });

  it("scores calling the timetable", () => {
    expect(judge("timetable", { type: "call", holds: true }, facts)).toEqual({
      outcome: "right",
      points: 40,
    });
    expect(judge("timetable", { type: "call", holds: true }, { ...facts, holds: false })).toEqual({
      outcome: "wrong",
      points: 0,
    });
    expect(
      judge("timetable", { type: "call", holds: false }, { ...facts, holds: false }).points,
    ).toBe(40);
  });
});

describe("which answers a round accepts", () => {
  const cases: [string, Answer, string[]][] = [
    ["trust", { type: "trust", choice: "A" }, ["duel"]],
    ["accuse", { type: "accuse" }, ["duel", "ranking"]],
    ["ranking", { type: "ranking", order: ["C", "A", "B"] }, ["ranking"]],
    ["author", { type: "author", model: OPUS }, ["author"]],
    ["call", { type: "call", holds: false }, ["timetable"]],
  ];

  it.each(cases)("accepts %s only where it belongs", (_name, answer, kinds) => {
    for (const kind of ["duel", "ranking", "author", "timetable"] as const) {
      expect(answerFits(kind, answer, AUTHORS)).toBe(kinds.includes(kind));
    }
  });

  it("does not offer an accusation in a single-letter round", () => {
    expect(answerFits("author", { type: "accuse" }, AUTHORS)).toBe(false);
    expect(answerFits("timetable", { type: "accuse" }, AUTHORS)).toBe(false);
  });

  it("rejects a ranking that is not each seat once, and an author who is not one of the three", () => {
    expect(answerFits("ranking", { type: "ranking", order: ["A", "A", "B"] }, AUTHORS)).toBe(false);
    expect(answerFits("ranking", { type: "ranking", order: ["A", "B"] }, AUTHORS)).toBe(false);
    expect(answerFits("author", { type: "author", model: "gpt" }, AUTHORS)).toBe(false);
  });
});

describe("points and ranks", () => {
  it("adds up points and never shows a total below zero", () => {
    expect(totalPoints([decision({ points: 100 }), decision({ points: -30 })])).toBe(70);
    expect(totalPoints([decision({ points: -30 }), decision({ points: -30 })])).toBe(0);
    expect(totalPoints([])).toBe(0);
  });

  it("names the rank for a total and the next one up", () => {
    expect(rankFor(0)).toEqual({ name: "Guest", next: { name: "Amateur Sleuth", at: 200 } });
    expect(rankFor(199).name).toBe("Guest");
    expect(rankFor(200).name).toBe("Amateur Sleuth");
    expect(rankFor(600).name).toBe("Private Inquiry Agent");
    expect(rankFor(1500)).toEqual({ name: "Celebrated Detective", next: null });
  });
});

function weekend(seed: string, outcomes: Outcome[]): DecisionRecord[] {
  return outcomes.map((outcome, index) =>
    authorRound(OPUS, outcome === "wrong" ? HAIKU : OPUS, {
      game: `wk.${seed}`,
      round_index: index,
      outcome,
      points: outcome === "right" ? 100 : 0,
    }),
  );
}

describe("a Weekend's candles", () => {
  it("blows one out for each wrong answer and ends the game at the third", () => {
    const state = weekendState(weekend("abcdef", ["right", "wrong", "none", "wrong"]), "abcdef");

    expect(state).toMatchObject({ next: 4, candles: 1, points: 100, over: false, survived: false });

    const dead = weekendState(weekend("abcdef", ["wrong", "wrong", "right", "wrong"]), "abcdef");
    expect(dead).toMatchObject({ candles: 0, over: true, survived: false, next: 4 });
  });

  it("is survived when all ten rounds are played with a candle still lit", () => {
    const rounds: Outcome[] = [
      "right",
      "wrong",
      "right",
      "none",
      "right",
      "wrong",
      "right",
      "right",
      "none",
      "right",
    ];
    const state = weekendState(weekend("abcdef", rounds), "abcdef");

    expect(state).toMatchObject({ next: 10, candles: 1, over: true, survived: true, points: 600 });
  });

  it("counts only the rounds of that seed", () => {
    const mixed = [...weekend("aaaaaa", ["wrong", "wrong"]), ...weekend("bbbbbb", ["right"])];

    expect(weekendState(mixed, "bbbbbb")).toMatchObject({ next: 1, candles: 3 });
    expect(weekendState(mixed, "cccccc")).toMatchObject({ next: 0, candles: 3, over: false });
  });
});

describe("the Morning Post result", () => {
  it("fills a square for every round that was not wrong", () => {
    expect(shareSquares(["right", "right", "wrong", "none", "right"])).toBe("■■□■■");
  });

  it("gives the share text only when all five rounds are played", () => {
    const rounds = (outcomes: Outcome[]) =>
      outcomes.map((outcome, index) =>
        decision({ mode: "morning_post", game: "mp.14", round_index: index, outcome }),
      );
    const done = morningPostState(
      rounds(["right", "right", "wrong", "right", "right"]),
      14,
      "2026-10-16",
    );
    const partial = morningPostState(rounds(["right", "wrong"]), 14, "2026-10-16");

    expect(done.share_text).toBe("Poison Pen · Morning Post No. 14 ■■□■■");
    expect(done.over).toBe(true);
    expect(partial).toMatchObject({ over: false, next: 2, share_text: null });
  });
});

describe("distinctions", () => {
  const accusedRight = decision({
    trap: true,
    answer: { type: "accuse" },
    outcome: "right",
    points: 50,
  });
  const fooled = () =>
    decision({
      trap: true,
      letters: [letter("A", OPUS), letter("B", OPUS)],
      outcome: "wrong",
    });
  const trustOpus = () => decision({ answer: { type: "trust", choice: "A" } });

  it("has six, each with a stated rule", () => {
    expect(DISTINCTIONS.map((distinction) => distinction.name)).toEqual([
      "Spotted the Impostor",
      "An Ear for Haiku",
      "Expensive Taste",
      "Thoroughly Fooled",
      "Master of the Library",
      "Survived the Weekend",
    ]);
    expect(DISTINCTIONS.every((distinction) => distinction.rule.length > 20)).toBe(true);
    expect(earnedDistinctions([])).toEqual(new Set());
  });

  it("Spotted the Impostor: one correct accusation", () => {
    const wrong = decision({ answer: { type: "accuse" }, outcome: "wrong", points: -30 });

    expect(earnedDistinctions([wrong]).has("spotted_the_impostor")).toBe(false);
    expect(earnedDistinctions([wrong, accusedRight]).has("spotted_the_impostor")).toBe(true);
  });

  it("An Ear for Haiku: Haiku named correctly three times", () => {
    const named = [authorRound(HAIKU, HAIKU), authorRound(HAIKU, HAIKU), authorRound(OPUS, HAIKU)];

    expect(earnedDistinctions(named).has("an_ear_for_haiku")).toBe(false);
    expect(earnedDistinctions([...named, authorRound(HAIKU, HAIKU)]).has("an_ear_for_haiku")).toBe(
      true,
    );
  });

  it("Expensive Taste: Opus trusted every time over at least five rounds", () => {
    const five = [trustOpus(), trustOpus(), trustOpus(), trustOpus(), trustOpus()];
    const strayed = decision({ answer: { type: "trust", choice: "B" } });
    const ranking = decision({
      mode: "library",
      kind: "ranking",
      answer: { type: "ranking", order: ["A", "B", "C"] },
      letters: [letter("A", OPUS), letter("B", SONNET), letter("C", HAIKU)],
    });

    expect(earnedDistinctions(five.slice(0, 4)).has("expensive_taste")).toBe(false);
    expect(earnedDistinctions(five).has("expensive_taste")).toBe(true);
    expect(earnedDistinctions([...five, strayed]).has("expensive_taste")).toBe(false);
    expect(earnedDistinctions([...five.slice(0, 4), ranking]).has("expensive_taste")).toBe(true);
    // A round without Opus, or a trap, neither helps nor hurts.
    const noOpus = decision({
      letters: [letter("A", SONNET), letter("B", HAIKU)],
      answer: { type: "trust", choice: "B" },
    });
    expect(earnedDistinctions([...five, noOpus, fooled()]).has("expensive_taste")).toBe(true);
  });

  it("Thoroughly Fooled: trusted a letter in two traps", () => {
    expect(earnedDistinctions([fooled()]).has("thoroughly_fooled")).toBe(false);
    expect(earnedDistinctions([fooled(), fooled()]).has("thoroughly_fooled")).toBe(true);
    expect(earnedDistinctions([fooled(), accusedRight]).has("thoroughly_fooled")).toBe(false);
  });

  it("Master of the Library: ten rankings", () => {
    const ranked = Array.from({ length: 10 }, () =>
      decision({
        mode: "library",
        kind: "ranking",
        answer: { type: "ranking", order: ["A", "B", "C"] },
      }),
    );

    expect(earnedDistinctions(ranked.slice(0, 9)).has("master_of_the_library")).toBe(false);
    expect(earnedDistinctions(ranked).has("master_of_the_library")).toBe(true);
  });

  it("Survived the Weekend: ten rounds with a candle left", () => {
    const survived = weekend(
      "goodgame",
      Array.from({ length: 10 }, (_, i) => (i < 2 ? "wrong" : "right")),
    );
    const died = weekend("badgame1", ["wrong", "wrong", "wrong"]);

    expect(
      earnedDistinctions(died.map((d) => ({ ...d, mode: "weekend" as const }))).has(
        "survived_the_weekend",
      ),
    ).toBe(false);
    expect(earnedDistinctions(survived).has("survived_the_weekend")).toBe(true);
  });

  it("reports only what the latest decision unlocked", () => {
    const before = [fooled()];
    const after = [...before, fooled()];

    expect(newlyEarned(before, after).map((d) => d.id)).toEqual(["thoroughly_fooled"]);
    expect(newlyEarned(after, [...after, fooled()])).toEqual([]);
  });
});
