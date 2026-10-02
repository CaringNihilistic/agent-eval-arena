// @vitest-environment node
import { describe, expect, it } from "vitest";

import { GUEST_IDS } from "@/lib/guests";
import {
  assignGuests,
  isClose,
  morningPostContents,
  morningPostDate,
  morningPostNumber,
  morningPostRoundId,
  MORNING_POST_KINDS,
  newSeed,
  orderRuns,
  pickFree,
  resolveRound,
  WEEKEND_HARD_FROM,
  WEEKEND_KINDS,
  weekendContents,
  weekendRoundId,
} from "@/lib/rounds";
import { randomFor } from "@/lib/seed";
import { loadRecordings } from "@/server/recordings";

const recordings = loadRecordings();
const { catalog, runs } = recordings;
const model = (runId: string) => runs.get(runId)!.model;
const VOTER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

describe("the catalog built from the recordings", () => {
  it("pairs every two authors on every task, and each author with its own second run", () => {
    expect(runs.size).toBe(180);
    expect(catalog.duels).toHaveLength(90);
    expect(catalog.traps).toHaveLength(90);
    expect(catalog.rankings).toHaveLength(30);
    expect(catalog.authors).toHaveLength(90);
  });

  it("makes a duel of two different authors and a trap of one author's two runs", () => {
    for (const duel of catalog.duels) {
      expect(new Set(duel.run_ids.map(model)).size).toBe(2);
      expect(duel.run_ids.every((id) => runs.get(id)!.take === 1)).toBe(true);
      expect(duel.trap).toBe(false);
    }
    for (const trap of catalog.traps) {
      expect(new Set(trap.run_ids.map(model)).size).toBe(1);
      expect(trap.run_ids.map((id) => runs.get(id)!.take).sort()).toEqual([1, 2]);
      expect(new Set(trap.run_ids.map((id) => runs.get(id)!.task_id)).size).toBe(1);
      expect(trap.trap).toBe(true);
    }
  });

  it("ranks all three authors' first runs on a task", () => {
    for (const ranking of catalog.rankings) {
      expect(new Set(ranking.run_ids.map(model)).size).toBe(3);
    }
  });

  it("offers a timetable round only for a run that did something before answering", () => {
    expect(catalog.timetables.length).toBeGreaterThan(20);
    for (const content of catalog.timetables) {
      const worked = recordings
        .events(content.run_ids[0])
        .some((event) => event.type === "tool_call" && event.payload.tool !== "submit_answer");
      expect(worked).toBe(true);
    }
  });

  it("gives every free-play round an id that does not name its runs or authors", () => {
    expect(catalog.byId.size).toBe(210 + catalog.timetables.length);
    for (const [id, entry] of catalog.byId) {
      expect(id).toMatch(/^(dr|lib|tt)\.[0-9a-f]{16}$/);
      for (const runId of entry.content.run_ids) expect(id).not.toContain(runId);
      expect(id).not.toMatch(/claude|haiku|sonnet|opus/i);
    }
  });
});

describe("close and clear", () => {
  it("calls two letters close when the score is equal and the lengths are within a quarter", () => {
    expect(isClose({ score: 1, answer_words: 100 }, { score: 1, answer_words: 76 })).toBe(true);
    expect(isClose({ score: 1, answer_words: 100 }, { score: 1, answer_words: 74 })).toBe(false);
    expect(isClose({ score: 1, answer_words: 100 }, { score: 0.5, answer_words: 100 })).toBe(false);
    expect(isClose({ score: 0, answer_words: 0 }, { score: 0, answer_words: 0 })).toBe(true);
  });
});

describe("seats", () => {
  it("are dealt from a count and a seed, with no way to see the author", () => {
    // The signature is the guarantee: nothing about a run can be passed in.
    expect(assignGuests.length).toBe(2);
    expect(assignGuests(3, "x")).toEqual(assignGuests(3, "x"));
    expect(new Set(assignGuests(3, "x")).size).toBe(3);
    for (const guest of assignGuests(6, "y")) expect(GUEST_IDS).toContain(guest);
  });

  it("put every author under every guest, and in every position, across rounds", () => {
    const seen = new Map<string, Set<string>>();
    const firstSeat = new Map<string, number>();
    for (const id of catalog.byId.keys()) {
      for (const voter of [VOTER, OTHER]) {
        const plan = resolveRound(catalog, id, voter)!;
        for (const seat of plan.seats) {
          const author = model(seat.run_id);
          seen.set(author, (seen.get(author) ?? new Set()).add(seat.guest));
        }
        if (plan.kind === "duel") {
          const author = model(plan.seats[0].run_id);
          firstSeat.set(author, (firstSeat.get(author) ?? 0) + 1);
        }
      }
    }
    for (const guests of seen.values()) expect(guests.size).toBe(6);
    // Each author takes the first seat about a third of the time.
    const total = [...firstSeat.values()].reduce((sum, count) => sum + count, 0);
    for (const count of firstSeat.values()) {
      expect(count / total).toBeGreaterThan(0.26);
      expect(count / total).toBeLessThan(0.41);
    }
  });

  it("give each guest about the same share of each author's letters", () => {
    const counts = new Map<string, number>();
    let seats = 0;
    for (const id of catalog.byId.keys()) {
      for (let player = 0; player < 12; player += 1) {
        for (const seat of resolveRound(catalog, id, `voter-${player}`)!.seats) {
          const key = `${model(seat.run_id)}|${seat.guest}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          seats += 1;
        }
      }
    }
    // 18 author-guest cells; each should hold about 1/18 of all seats.
    expect(counts.size).toBe(18);
    for (const count of counts.values()) {
      expect(count / seats).toBeGreaterThan(0.045);
      expect(count / seats).toBeLessThan(0.066);
    }
  });

  it("differ between players in free play, and stay put for one player", () => {
    const ids = [...catalog.byId.keys()].filter((id) => id.startsWith("dr."));
    const differing = ids.filter(
      (id) =>
        JSON.stringify(resolveRound(catalog, id, VOTER)!.seats) !==
        JSON.stringify(resolveRound(catalog, id, OTHER)!.seats),
    );

    expect(differing.length).toBeGreaterThan(ids.length * 0.8);
    expect(resolveRound(catalog, ids[0], VOTER)).toEqual(resolveRound(catalog, ids[0], VOTER));
  });

  it("shuffle the order of the letters", () => {
    const orders = new Set(
      Array.from({ length: 40 }, (_, index) => orderRuns(["a", "b"], `seed-${index}`).join("")),
    );

    expect(orders).toEqual(new Set(["ab", "ba"]));
  });
});

describe("a Weekend", () => {
  const seed = "wrenfield1";

  it("is the same ten rounds, guests, and seats for everyone with the seed", () => {
    const mine = Array.from({ length: 10 }, (_, i) =>
      resolveRound(catalog, weekendRoundId(seed, i), VOTER),
    );
    const theirs = Array.from({ length: 10 }, (_, i) =>
      resolveRound(catalog, weekendRoundId(seed, i), OTHER),
    );

    expect(mine).toEqual(theirs);
    expect(mine.map((plan) => plan!.kind)).toEqual(WEEKEND_KINDS);
    expect(mine.every((plan) => plan!.mode === "weekend" && plan!.game === `wk.${seed}`)).toBe(
      true,
    );
    expect(mine.map((plan) => plan!.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("differs from one seed to the next", () => {
    const key = (s: string) =>
      weekendContents(catalog, s)
        .map((content) => content.key)
        .join(",");

    expect(key("seedaaaa")).not.toBe(key("seedbbbb"));
    expect(key("seedaaaa")).toBe(key("seedaaaa"));
  });

  it("does not use the same task twice", () => {
    for (const s of ["aaaaaa", "bbbbbb", "cccccc", "dddddd"]) {
      const tasks = weekendContents(catalog, s).map((content) => content.task_id);
      expect(new Set(tasks).size).toBe(10);
    }
  });

  it("starts with clear differences and ends with close matches and traps", () => {
    let traps = 0;
    const games = 400;
    for (let game = 0; game < games; game += 1) {
      const contents = weekendContents(catalog, `game${game}xx`);
      contents.forEach((content, index) => {
        const hard = index >= WEEKEND_HARD_FROM;
        if (content.kind === "duel") {
          if (!hard) expect(content.trap).toBe(false);
          if (!content.trap) expect(content.close).toBe(hard);
          if (content.trap) traps += 1;
        }
        if (content.kind === "author") expect(content.close).toBe(hard);
      });
    }
    // About one round in eight is a trap: 1.25 per ten-round game.
    expect(traps / games).toBeGreaterThan(1.05);
    expect(traps / games).toBeLessThan(1.45);
  });

  it("makes seeds that are valid round ids", () => {
    const seed = newSeed(randomFor("test"));

    expect(seed).toMatch(/^[a-z0-9]{10}$/);
    expect(resolveRound(catalog, weekendRoundId(seed, 9), VOTER)).not.toBeNull();
    expect(resolveRound(catalog, `wk.${seed}.10`, VOTER)).toBeNull();
  });
});

describe("the Morning Post", () => {
  it("is numbered by UTC date from the first edition", () => {
    expect(morningPostNumber(new Date("2026-10-03T00:00:00Z"))).toBe(1);
    expect(morningPostNumber(new Date("2026-10-03T23:59:59Z"))).toBe(1);
    expect(morningPostNumber(new Date("2026-10-16T08:00:00Z"))).toBe(14);
    expect(morningPostDate(14)).toBe("2026-10-16");
    expect(morningPostNumber(new Date("2020-01-01T00:00:00Z"))).toBe(1);
  });

  it("is the same five rounds for everyone on a day, and changes the next day", () => {
    const today = Array.from({ length: 5 }, (_, i) =>
      resolveRound(catalog, morningPostRoundId(14, i), VOTER),
    );
    const theirs = Array.from({ length: 5 }, (_, i) =>
      resolveRound(catalog, morningPostRoundId(14, i), OTHER),
    );
    const keys = (number: number) =>
      morningPostContents(catalog, number)
        .map((content) => content.key)
        .join(",");

    expect(today).toEqual(theirs);
    expect(today.map((plan) => plan!.kind)).toEqual(MORNING_POST_KINDS);
    expect(keys(14)).toBe(keys(14));
    expect(keys(14)).not.toBe(keys(15));
    expect(resolveRound(catalog, "mp.14.5", VOTER)).toBeNull();
  });
});

describe("free play", () => {
  it("never deals a round the player has decided", () => {
    const decided = new Set<string>();
    for (let round = 0; round < 30; round += 1) {
      const id = pickFree(catalog, "library", decided);
      expect(id).not.toBeNull();
      expect(decided.has(id!)).toBe(false);
      decided.add(id!);
    }
    expect(pickFree(catalog, "library", decided)).toBeNull();
  });

  it("makes about one Drawing Room round in eight a trap", () => {
    const random = randomFor("drawing-room");
    let traps = 0;
    const deals = 4000;
    for (let deal = 0; deal < deals; deal += 1) {
      const id = pickFree(catalog, "drawing_room", new Set(), random)!;
      if (catalog.byId.get(id)!.content.trap) traps += 1;
    }

    expect(traps / deals).toBeGreaterThan(0.1);
    expect(traps / deals).toBeLessThan(0.15);
  });

  it("falls back to what is left when one kind is used up", () => {
    const allDuels = new Set(
      [...catalog.byId].filter(([, entry]) => !entry.content.trap).map(([id]) => id),
    );
    const id = pickFree(catalog, "drawing_room", allDuels, () => 0.99);

    expect(id).not.toBeNull();
    expect(catalog.byId.get(id!)!.content.trap).toBe(true);
  });

  it("does not resolve an id it did not issue", () => {
    expect(resolveRound(catalog, "dr.0000000000000000", VOTER)).toBeNull();
    expect(resolveRound(catalog, "nonsense", VOTER)).toBeNull();
    expect(resolveRound(catalog, "wk.UPPER.1", VOTER)).toBeNull();
  });
});
