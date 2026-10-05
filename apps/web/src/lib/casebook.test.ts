import { describe, expect, it } from "vitest";

import {
  buildCasebook,
  CASEBOOK_AFTER,
  casebookText,
  compatibility,
  CROWD_MIN,
  crowdShare,
  methodFor,
} from "@/lib/casebook";
import type { DecisionRecord } from "@/lib/types";
import { authorRound, decision, HAIKU, letter, OPUS, SONNET } from "@/test/decisions";

/** Several players' votes on one pairing. */
function pairing(choices: ("A" | "B" | "equal")[]): DecisionRecord[] {
  return choices.map((choice, index) =>
    decision({
      content_key: "duel|shared",
      voter_id: `voter-${index}`,
      answer: { type: "trust", choice },
    }),
  );
}

describe("the share of players who trusted the same letter", () => {
  it("is withheld until five players have trusted one letter or the other", () => {
    const four = pairing(["A", "A", "B", "A"]);

    expect(crowdShare(four, four[0])).toEqual({ votes: 4, same_share: null });
    expect(CROWD_MIN).toBe(5);
  });

  it("is shown from the fifth vote", () => {
    const five = pairing(["A", "A", "B", "A", "B"]);

    expect(crowdShare(five, five[0])).toEqual({ votes: 5, same_share: 0.6 });
    expect(crowdShare(five, five[2])).toEqual({ votes: 5, same_share: 0.4 });
  });

  it("does not count 'equally good' toward the threshold", () => {
    const votes = pairing(["A", "A", "B", "A", "equal", "equal"]);

    expect(crowdShare(votes, votes[0])).toEqual({ votes: 4, same_share: null });
  });

  it("follows the letter, not the seat, when players saw the letters in different orders", () => {
    const flipped = decision({
      content_key: "duel|shared",
      voter_id: "flipped",
      answer: { type: "trust", choice: "B" },
      letters: [
        letter("A", HAIKU, { run_id: `run-${HAIKU}-B` }),
        letter("B", OPUS, { run_id: `run-${OPUS}-A` }),
      ],
    });
    const votes = [...pairing(["A", "A", "A", "A"]), flipped];

    // All five trusted the Opus letter, whichever seat it was in.
    expect(crowdShare(votes, flipped)).toEqual({ votes: 5, same_share: 1 });
  });

  it("is not given for a ranking, an accusation, or a single letter", () => {
    const votes = pairing(["A", "A", "A", "A", "A"]);

    expect(crowdShare(votes, decision({ answer: { type: "accuse" } }))).toBeNull();
    expect(crowdShare(votes, authorRound(OPUS, OPUS))).toBeNull();
  });
});

describe("a player's method", () => {
  const lengths = (a: number, b: number) => [
    letter("A", OPUS, { answer_words: a }),
    letter("B", HAIKU, { answer_words: b }),
  ];
  const times = (count: number, make: () => DecisionRecord) => Array.from({ length: count }, make);

  it("is The Plain Speaker for mostly trusting the shorter letter", () => {
    const votes = times(5, () => decision({ letters: lengths(40, 90) }));

    expect(methodFor(votes).name).toBe("The Plain Speaker");
  });

  it("is The Completist for mostly trusting the longer letter", () => {
    expect(methodFor(times(5, () => decision({ letters: lengths(90, 40) }))).name).toBe(
      "The Completist",
    );
  });

  it("is The Skeptic, The Diplomat, or The Accuser for those habits", () => {
    const neither = times(5, () => decision({ answer: { type: "trust", choice: "neither" } }));
    const equal = times(5, () => decision({ answer: { type: "trust", choice: "equal" } }));
    const accusing = [
      ...times(2, () => decision({ answer: { type: "accuse" } })),
      ...times(3, () => decision({})),
    ];

    expect(methodFor(neither).name).toBe("The Skeptic");
    expect(methodFor(equal).name).toBe("The Diplomat");
    expect(methodFor(accusing).name).toBe("The Accuser");
  });

  it("is The Even Hand when there is too little to go on", () => {
    expect(methodFor([]).name).toBe("The Even Hand");
    expect(methodFor(times(2, () => decision({ letters: lengths(40, 90) }))).name).toBe(
      "The Even Hand",
    );
  });
});

describe("the Casebook", () => {
  const mine = [
    decision({ answer: { type: "trust", choice: "A" }, content_key: "duel|shared" }),
    decision({ answer: { type: "trust", choice: "A" } }),
    decision({ answer: { type: "trust", choice: "B" } }),
    decision({
      letters: [letter("A", OPUS), letter("B", SONNET)],
      answer: { type: "trust", choice: "B" },
    }),
    decision({
      mode: "library",
      kind: "ranking",
      answer: { type: "ranking", order: ["A", "B", "C"] },
      letters: [letter("A", OPUS), letter("B", SONNET), letter("C", HAIKU)],
    }),
    authorRound(HAIKU, HAIKU, { confidence: "certain" }),
    authorRound(OPUS, SONNET, { confidence: "certain" }),
    authorRound(SONNET, SONNET, { confidence: "hunch" }),
    decision({ trap: true, answer: { type: "accuse" }, outcome: "right", points: 50 }),
    decision({ answer: { type: "accuse" }, outcome: "wrong", points: -30 }),
    decision({
      trap: true,
      letters: [letter("A", OPUS), letter("B", OPUS)],
      outcome: "wrong",
    }),
    decision({
      mode: "morning_post",
      game: "mp.14",
      round_index: 0,
      kind: "timetable",
      answer: { type: "call", holds: true },
      outcome: "right",
      points: 40,
      letters: [letter("A", HAIKU)],
    }),
    decision({
      mode: "morning_post",
      game: "mp.14",
      round_index: 1,
      kind: "timetable",
      answer: { type: "call", holds: true },
      outcome: "wrong",
      letters: [letter("A", HAIKU)],
    }),
  ];
  const others = pairing(["A", "A", "A", "B"]);
  const byContent = new Map([["duel|shared", [...others, mine[0]]]]);
  const casebook = buildCasebook(mine, byContent);

  it("opens after ten decisions", () => {
    expect(CASEBOOK_AFTER).toBe(10);
    expect(casebook).toMatchObject({ decisions: 13, ready: true, needed: 0 });
    expect(buildCasebook(mine.slice(0, 4), new Map())).toMatchObject({ ready: false, needed: 6 });
  });

  it("adds up points and names the rank", () => {
    // 100 + 100 + 50 - 30 + 40
    expect(casebook.points).toBe(260);
    expect(casebook.rank).toBe("Amateur Sleuth");
    expect(casebook.next_rank).toEqual({ name: "Private Inquiry Agent", at: 600 });
  });

  it("reports accuracy only where there is a right answer", () => {
    expect(casebook.author_naming).toEqual({ right: 2, total: 3 });
    expect(casebook.timetable_calls).toEqual({ right: 1, total: 2 });
    expect(casebook).toMatchObject({ impostors_caught: 1, false_accusations: 1, times_fooled: 1 });
    expect(casebook.by_confidence.certain).toEqual({ right: 1, total: 2 });
    expect(casebook.by_confidence.hunch).toEqual({ right: 1, total: 1 });
  });

  it("names the author and the guest trusted most", () => {
    expect(casebook.most_trusted_author).toEqual({ model: OPUS, trusted: 3, seen: 5 });
    expect(casebook.favourite_guest).toMatchObject({ guest: "constance" });
  });

  it("compares the player with other players and with the benchmark order, as information", () => {
    expect(casebook.crowd_agreement).toEqual({ right: 1, total: 1 });
    // Opus and Sonnet met twice: once Sonnet was trusted, once Opus was ranked above it.
    expect(casebook.benchmark_agreement).toEqual({ right: 1, total: 2 });
  });

  it("shows the latest Morning Post", () => {
    expect(casebook.morning_post).toEqual({ game: "mp.14", squares: "■□" });
  });

  it("lists every distinction still on offer, earned or not", () => {
    const earned = casebook.distinctions.filter((d) => d.earned).map((d) => d.id);

    expect(casebook.distinctions).toHaveLength(5);
    expect(earned).toEqual(["spotted_the_impostor"]);
    // The Library has closed, so its distinction is not held out to a player who lacks it.
    expect(casebook.distinctions.map((d) => d.id)).not.toContain("master_of_the_library");
  });

  it("keeps a closed room's distinction for a player who earned it", () => {
    const ranked = Array.from({ length: 10 }, (_, index) =>
      decision({
        round_id: `lib.${index}`,
        mode: "library",
        kind: "ranking",
        answer: { type: "ranking", order: ["A", "B", "C"] },
      }),
    );
    const held = buildCasebook(ranked, new Map()).distinctions;

    expect(held.find((d) => d.id === "master_of_the_library")?.earned).toBe(true);
  });

  it("can be copied as text", () => {
    const text = casebookText(casebook);

    expect(text).toContain("Poison Pen · My Casebook");
    expect(text).toContain("Amateur Sleuth, 260 points");
    expect(text).toContain("Authors named: 2 of 3");
    expect(text).toContain("Morning Post No. 14 ■□");
  });

  it("gives no points for siding with other players", () => {
    const alone = buildCasebook(mine, new Map());

    expect(alone.points).toBe(casebook.points);
    expect(alone.rank).toBe(casebook.rank);
  });
});

describe("taste compatibility", () => {
  const round = (id: string, voter: string, choice: "A" | "B") =>
    decision({ round_id: id, voter_id: voter, answer: { type: "trust", choice } });

  it("is the share of rounds both played that they answered alike", () => {
    const mine = [
      round("wk.s.0", "me", "A"),
      round("wk.s.1", "me", "B"),
      round("wk.s.2", "me", "A"),
    ];
    const theirs = [round("wk.s.0", "you", "A"), round("wk.s.1", "you", "A")];

    expect(compatibility(mine, theirs)).toEqual({ shared: 2, same: 1, percent: 50 });
  });

  it("has no figure when they share no round", () => {
    expect(compatibility([round("wk.s.0", "me", "A")], [])).toEqual({
      shared: 0,
      same: 0,
      percent: null,
    });
  });
});
