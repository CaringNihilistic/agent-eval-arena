// @vitest-environment node
// Every mode, played through the service against the real recordings.
import { describe, expect, it } from "vitest";

import { BLIND_TIMESTAMP } from "@/lib/blind-view";
import { morningPostNumber, morningPostRoundId, weekendRoundId } from "@/lib/rounds";
import { randomFor } from "@/lib/seed";
import type { Answer, BlindRound, Mode, RevealedRound } from "@/lib/types";
import {
  casebookFor,
  challengeView,
  createChallenge,
  decide,
  DECISION_LIMITS,
  expressionsFor,
  hashIp,
  nextRound,
  parseAnswer,
  parseConfidence,
  requireVoterId,
  roundView,
  ServiceError,
  sharedCasebook,
} from "@/server/round-service";
import { loadRecordings } from "@/server/recordings";
import { findLeaks } from "@/test/leak-scan";
import { memoryStore, type MemoryStore } from "@/test/memory-store";

const recordings = loadRecordings();
const { catalog, runs } = recordings;
const ME = "11111111-2222-4333-8444-555555555555";
const FRIEND = "99999999-2222-4333-8444-555555555555";
const NOW = new Date("2026-10-16T09:00:00Z");

async function status(action: Promise<unknown>): Promise<number | null> {
  try {
    await action;
    return null;
  } catch (error) {
    if (error instanceof ServiceError) return error.status;
    throw error;
  }
}

/** Everything that would identify the runs behind a round. */
function secretsOf(runIds: readonly string[]): string[] {
  return runIds.flatMap((runId) => {
    const run = runs.get(runId)!;
    const started = recordings.events(runId).find((event) => event.type === "run_started");
    const prompt = started?.type === "run_started" ? started.payload.config?.system_prompt : "";
    return [run.run_id, run.config_id, run.config_name, run.display_name, run.model, prompt ?? ""];
  });
}

const NAMES = /claude|haiku|sonnet|\bopus\b|anthropic/i;

/** The checks every blind round must pass, whatever its mode. */
function expectBlind(round: BlindRound, runIds: readonly string[]): void {
  expect(Object.keys(round).sort()).toEqual(
    ["authors", "decided", "game", "kind", "letters", "mode", "round_id", "task"].sort(),
  );
  for (const letter of round.letters) {
    expect(Object.keys(letter).sort()).toEqual([
      "events",
      "final_answer",
      "guest",
      "seat",
      "steps",
    ]);
    expect(new Set(letter.events.map((event) => event.timestamp))).toEqual(
      new Set([BLIND_TIMESTAMP]),
    );
  }
  expect(findLeaks(round.letters, secretsOf(runIds))).toEqual([]);
  expect(JSON.stringify(round.letters)).not.toMatch(NAMES);
  expect(round.round_id).not.toMatch(NAMES);
  // The author options are the same three in every round, so they give nothing away.
  expect(round.authors.map((author) => author.label)).toEqual([
    "Haiku 4.5",
    "Opus 5.5",
    "Sonnet 5.5",
  ]);
}

let plays = 0;
/** Decide a round. Each call comes from a new address, so rate limits stay out of the way. */
function play(store: MemoryStore, roundId: string, answer: Answer, voterId = ME, now = NOW) {
  plays += 1;
  return decide(recordings, store, {
    roundId,
    voterId,
    answer,
    confidence: "fairly",
    ip: `10.0.${Math.floor(plays / 250)}.${plays % 250}`,
    now,
  });
}

/** An answer that fits the round, right or wrong as asked. */
function answerFor(round: BlindRound, right: boolean): Answer {
  const plan = catalog.byId.get(round.round_id);
  if (round.kind === "author") {
    const truth = runs.get(seatedRuns(round)[0])!.model;
    const other = round.authors.find((author) => author.model !== truth)!.model;
    return { type: "author", model: right ? truth : other };
  }
  if (round.kind === "timetable") {
    const run = runs.get(seatedRuns(round)[0])!;
    const holds = run.passed ?? run.checks_met === run.checks_total;
    return { type: "call", holds: right ? holds : !holds };
  }
  if (round.kind === "ranking") return { type: "ranking", order: ["B", "A", "C"] };
  const trap = plan ? plan.content.trap : isTrap(round);
  return trap === right ? { type: "accuse" } : { type: "trust", choice: "A" };
}

/** The runs behind a round's seats, read from the plan (tests may look; players cannot). */
function seatedRuns(round: BlindRound, voterId = ME): string[] {
  return planOf(round.round_id, voterId).seats.map((seat) => seat.run_id);
}

function planOf(roundId: string, voterId = ME) {
  // Imported lazily to keep the helper next to its use.
  return resolve(roundId, voterId);
}
import { resolveRound } from "@/lib/rounds";
function resolve(roundId: string, voterId: string) {
  const plan = resolveRound(catalog, roundId, voterId);
  if (!plan) throw new Error(`No round ${roundId}`);
  return plan;
}
function isTrap(round: BlindRound): boolean {
  return planOf(round.round_id).content.trap;
}

describe("redaction in every mode", () => {
  it("serves every free-play round blind: Drawing Room, Library, and Timetable", async () => {
    const store = memoryStore();
    const counts = { drawing_room: 0, library: 0, timetable: 0 };
    for (const [id, entry] of catalog.byId) {
      const view = await roundView(recordings, store, id, ME);
      expect(view.decided).toBe(false);
      expectBlind(view as BlindRound, entry.content.run_ids);
      counts[entry.mode] += 1;
    }
    expect(counts.drawing_room).toBe(180);
    expect(counts.library).toBe(30);
    expect(counts.timetable).toBeGreaterThan(20);
  });

  it("serves the rounds of many Weekends and Morning Posts blind", async () => {
    const store = memoryStore();
    const ids = [
      ...Array.from({ length: 25 }, (_, game) =>
        Array.from({ length: 10 }, (_, index) => weekendRoundId(`seed${game}abc`, index)),
      ).flat(),
      ...Array.from({ length: 40 }, (_, day) =>
        Array.from({ length: 5 }, (_, index) => morningPostRoundId(day + 1, index)),
      ).flat(),
    ];
    for (const id of ids) {
      const view = await roundView(recordings, store, id, ME);
      expectBlind(view as BlindRound, planOf(id).content.run_ids);
    }
  });

  it("pauses a timetable round before the answer, in all three places it appears", async () => {
    const store = memoryStore();
    for (const [id, entry] of catalog.byId) {
      if (entry.mode !== "timetable") continue;
      const view = (await roundView(recordings, store, id, ME)) as BlindRound;
      const [letter] = view.letters;
      const calls = letter.events.filter((event) => event.type === "llm_call");
      const last = calls[calls.length - 1];

      expect(letter.final_answer).toBeNull();
      expect(last.type === "llm_call" && last.payload.output.content).toBeNull();
      for (const event of letter.events) {
        if (event.type === "tool_call" && event.payload.tool === "submit_answer") {
          expect(event.payload.arguments).toEqual({});
        }
        if (event.type === "llm_call") {
          for (const call of event.payload.output.tool_calls) {
            if (call.tool === "submit_answer") expect(call.arguments).toEqual({});
          }
        }
        if (event.type === "run_finished") expect(event.payload.final_answer).toBeNull();
      }
      // There is still something to watch.
      expect(letter.events.some((event) => event.type === "tool_call")).toBe(true);
    }
  });

  it("does not let a trap round be told from an ordinary one before the decision", async () => {
    const store = memoryStore();
    const shapes = new Set<string>();
    for (const [id, entry] of catalog.byId) {
      if (entry.mode !== "drawing_room") continue;
      const view = (await roundView(recordings, store, id, ME)) as BlindRound;
      shapes.add(
        JSON.stringify({
          keys: Object.keys(view).sort(),
          letters: view.letters.map((letter) => Object.keys(letter).sort()),
          kind: view.kind,
          mode: view.mode,
          idShape: view.round_id.replace(/[0-9a-f]{16}/, "x"),
        }),
      );
    }
    // Trap and ordinary rounds have exactly the same shape.
    expect(shapes.size).toBe(1);
  });

  it("stays blind for a player after someone else has decided the same round", async () => {
    const store = memoryStore();
    const id = [...catalog.byId.keys()].find((key) => key.startsWith("dr."))!;
    await play(store, id, { type: "trust", choice: "A" }, FRIEND);

    const view = await roundView(recordings, store, id, ME);

    expect(view.decided).toBe(false);
    expectBlind(view as BlindRound, catalog.byId.get(id)!.content.run_ids);
  });
});

describe("The Drawing Room", () => {
  const duel = [...catalog.byId].find(
    ([, entry]) => entry.mode === "drawing_room" && !entry.content.trap,
  )![0];
  const trap = [...catalog.byId].find(([, entry]) => entry.content.trap)![0];

  it("deals a duel, takes a preference for no points, and reveals the authors", async () => {
    const store = memoryStore();
    const dealt = await nextRound(recordings, store, { voterId: ME, mode: "drawing_room" });
    expect(dealt.round?.kind).toBe("duel");
    expect(dealt.round?.letters).toHaveLength(2);
    expect(dealt.game).toBeNull();

    const reveal = await play(store, duel, { type: "trust", choice: "A" });

    expect(reveal).toMatchObject({ decided: true, trap: false, outcome: "none", points: 0 });
    expect(reveal.letters.map((letter) => letter.expression)).toEqual(["happy", "shocked"]);
    expect(new Set(reveal.letters.map((letter) => letter.model)).size).toBe(2);
    expect(reveal.letters[0].totals.runs).toBe(30);
    expect(reveal.letters[0].events.some((event) => event.type === "score_computed")).toBe(true);
    expect(reveal.progress).toMatchObject({ points_total: 0, rank: "Guest" });
    expect(reveal.official.benchmarks.length).toBeGreaterThan(0);
    expect(reveal.official.sources).toBeDefined();
  });

  it("stores the decision with mode, guests, positions, confidence, trap flag, and lengths", async () => {
    const store = memoryStore();
    await decide(recordings, store, {
      roundId: duel,
      voterId: ME,
      answer: { type: "trust", choice: "B" },
      confidence: "certain",
      ip: "203.0.113.9",
      now: NOW,
    });
    const [row] = store.rows;

    expect(row).toMatchObject({
      mode: "drawing_room",
      kind: "duel",
      trap: false,
      confidence: "certain",
      game: null,
    });
    expect(row.letters.map((letter) => letter.position)).toEqual([0, 1]);
    expect(row.letters.map((letter) => letter.seat)).toEqual(["A", "B"]);
    for (const letter of row.letters) {
      expect(letter.guest).toBeTruthy();
      expect(letter.answer_words).toBe(runs.get(letter.run_id)!.answer_words);
      expect(letter.model).toBe(runs.get(letter.run_id)!.model);
    }
    // The address is stored only as a keyed hash.
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    expect(row.ip_hash).toBe(hashIp("203.0.113.9"));
  });

  it("rewards a correct accusation and announces the trap", async () => {
    const store = memoryStore();
    const reveal = await play(store, trap, { type: "accuse" });

    expect(reveal).toMatchObject({ trap: true, outcome: "right", points: 50 });
    expect(reveal.letters.map((letter) => letter.expression)).toEqual(["flustered", "flustered"]);
    expect(new Set(reveal.letters.map((letter) => letter.model)).size).toBe(1);
    expect(reveal.letters.map((letter) => letter.take).sort()).toEqual([1, 2]);
    expect(reveal.progress?.unlocked.map((d) => d.id)).toEqual(["spotted_the_impostor"]);
  });

  it("takes thirty points for a false accusation and gives none for being fooled", async () => {
    const store = memoryStore();
    const falsely = await play(store, duel, { type: "accuse" });
    const fooled = await play(store, trap, { type: "trust", choice: "A" });

    expect(falsely).toMatchObject({ trap: false, outcome: "wrong", points: -30 });
    expect(fooled).toMatchObject({ trap: true, outcome: "wrong", points: 0 });
    expect(fooled.progress?.points_total).toBe(0);
  });

  it("deals about one trap in eight, and never a round already decided", async () => {
    const store = memoryStore();
    const random = randomFor("deals");
    let traps = 0;
    for (let deal = 0; deal < 800; deal += 1) {
      const { round } = await nextRound(recordings, store, {
        voterId: ME,
        mode: "drawing_room",
        random,
      });
      if (isTrap(round!)) traps += 1;
    }
    expect(traps / 800).toBeGreaterThan(0.08);
    expect(traps / 800).toBeLessThan(0.17);

    const seen = new Set<string>();
    for (let deal = 0; deal < 180; deal += 1) {
      const { round } = await nextRound(recordings, store, {
        voterId: ME,
        mode: "drawing_room",
        random,
      });
      expect(seen.has(round!.round_id)).toBe(false);
      seen.add(round!.round_id);
      await play(store, round!.round_id, { type: "trust", choice: "equal" });
    }
    expect(
      (await nextRound(recordings, store, { voterId: ME, mode: "drawing_room" })).round,
    ).toBeNull();
  });

  it("shows the share who trusted the same letter only from the fifth vote", async () => {
    const store = memoryStore();
    const voters = Array.from({ length: 5 }, (_, i) => `0000000${i}-2222-4333-8444-555555555555`);
    const reveals: RevealedRound[] = [];
    for (const voter of voters) {
      // Each player trusts the same underlying letter, whichever seat it is in for them.
      const target = catalog.byId.get(duel)!.content.run_ids[0];
      const seat = resolve(duel, voter).seats.find((item) => item.run_id === target)!.seat;
      reveals.push(await play(store, duel, { type: "trust", choice: seat as "A" | "B" }, voter));
    }

    expect(reveals[3].crowd).toEqual({ votes: 4, same_share: null });
    expect(reveals[4].crowd).toEqual({ votes: 5, same_share: 1 });
    // The crowd never changes anyone's points.
    expect(reveals.every((reveal) => reveal.points === 0)).toBe(true);
  });

  it("rejects a second decision, an answer that does not fit, and an unknown round", async () => {
    const store = memoryStore();
    await play(store, duel, { type: "trust", choice: "A" });

    expect(await status(play(store, duel, { type: "trust", choice: "B" }))).toBe(409);
    expect(await status(play(store, trap, { type: "call", holds: true }))).toBe(400);
    expect(await status(play(store, "dr.0000000000000000", { type: "accuse" }))).toBe(404);
    expect(store.rows).toHaveLength(1);
    const again = await roundView(recordings, store, duel, ME);
    expect(again.decided && again.your_answer).toEqual({ type: "trust", choice: "A" });
    expect(again.decided && again.progress).toBeNull();
  });
});

describe("The Library Gathering", () => {
  it("deals all three authors' letters and takes a ranking for no points", async () => {
    const store = memoryStore();
    const { round } = await nextRound(recordings, store, { voterId: ME, mode: "library" });
    expect(round).toMatchObject({ kind: "ranking", mode: "library" });
    expect(round!.letters.map((letter) => letter.seat)).toEqual(["A", "B", "C"]);
    expect(new Set(round!.letters.map((letter) => letter.guest)).size).toBe(3);

    const reveal = await play(store, round!.round_id, { type: "ranking", order: ["C", "A", "B"] });

    expect(reveal).toMatchObject({ outcome: "none", points: 0, trap: false, crowd: null });
    expect(new Set(reveal.letters.map((letter) => letter.model)).size).toBe(3);
    const expressions = Object.fromEntries(reveal.letters.map((l) => [l.seat, l.expression]));
    expect(expressions).toEqual({ A: "neutral", B: "shocked", C: "happy" });
    expect(reveal.official.benchmarks.some((b) => b.scores.length === 2)).toBe(true);
  });

  it("treats an accusation as wrong, since all three authors are present", async () => {
    const store = memoryStore();
    const { round } = await nextRound(recordings, store, { voterId: ME, mode: "library" });

    expect(await play(store, round!.round_id, { type: "accuse" })).toMatchObject({
      outcome: "wrong",
      points: -30,
    });
  });

  it("rejects a ranking that is not each letter once", async () => {
    const store = memoryStore();
    const { round } = await nextRound(recordings, store, { voterId: ME, mode: "library" });

    expect(
      await status(play(store, round!.round_id, { type: "ranking", order: ["A", "A", "B"] })),
    ).toBe(400);
    expect(await status(play(store, round!.round_id, { type: "trust", choice: "A" }))).toBe(400);
  });
});

describe("Does the Timetable Hold?", () => {
  it("deals one paused run and scores the call", async () => {
    const store = memoryStore();
    const { round } = await nextRound(recordings, store, { voterId: ME, mode: "timetable" });
    expect(round).toMatchObject({ kind: "timetable", mode: "timetable" });
    expect(round!.letters).toHaveLength(1);
    expect(round!.letters[0].final_answer).toBeNull();

    const right = await play(store, round!.round_id, answerFor(round!, true));

    expect(right).toMatchObject({ outcome: "right", points: 40 });
    expect(right.letters[0].final_answer).not.toBeNull();
    expect(right.letters[0].expression).toBe(right.letters[0].holds ? "happy" : "shocked");
  });

  it("gives nothing for the wrong call, and does not offer an accusation", async () => {
    const store = memoryStore();
    const { round } = await nextRound(recordings, store, { voterId: ME, mode: "timetable" });

    expect(await status(play(store, round!.round_id, { type: "accuse" }))).toBe(400);
    expect(await play(store, round!.round_id, answerFor(round!, false))).toMatchObject({
      outcome: "wrong",
      points: 0,
    });
  });
});

describe("A Weekend at Wrenfield", () => {
  async function playWeekend(
    store: MemoryStore,
    seed: string,
    voterId: string,
    right: (index: number) => boolean,
  ) {
    for (;;) {
      const dealt = await nextRound(recordings, store, { voterId, mode: "weekend", seed });
      if (dealt.round === null) return dealt.game;
      const index = dealt.round.game!.next;
      await play(
        store,
        dealt.round.round_id,
        answerForVoter(dealt.round, right(index), voterId),
        voterId,
      );
    }
  }
  function answerForVoter(round: BlindRound, right: boolean, voterId: string): Answer {
    // Seeded rounds seat everyone alike, so the helper's view of the seats holds for any voter.
    void voterId;
    return answerFor(round, right);
  }

  it("starts a new game with a seed, ten rounds, and three candles", async () => {
    const store = memoryStore();
    const dealt = await nextRound(recordings, store, {
      voterId: ME,
      mode: "weekend",
      random: randomFor("w"),
    });

    expect(dealt.game).toMatchObject({
      type: "weekend",
      total: 10,
      next: 0,
      candles: 3,
      over: false,
    });
    expect(dealt.round?.round_id).toBe(`wk.${dealt.game?.type === "weekend" && dealt.game.seed}.0`);
    expect(dealt.round?.kind).toBe("author");
  });

  it("is survived by answering well, and earns the distinction", async () => {
    const store = memoryStore();
    const game = await playWeekend(store, "survivor01", ME, () => true);

    expect(game).toMatchObject({ over: true, survived: true, candles: 3, next: 10 });
    expect(store.rows).toHaveLength(10);
    expect(store.rows.every((row) => row.mode === "weekend" && row.game === "wk.survivor01")).toBe(
      true,
    );
    const casebook = await casebookFor(store, ME);
    expect(casebook.distinctions.find((d) => d.id === "survived_the_weekend")?.earned).toBe(true);
    expect(casebook.weekends_survived).toBe(1);
    expect(casebook.ready).toBe(true);
  });

  it("ends when the third candle goes out", async () => {
    const store = memoryStore();
    const game = await playWeekend(store, "doomed0001", ME, () => false);

    // A duel between different authors, answered "wrong" by the helper, is a false accusation.
    expect(game).toMatchObject({ over: true, survived: false, candles: 0 });
    expect(store.rows.length).toBeLessThan(10);
    expect(store.rows.filter((row) => row.outcome === "wrong")).toHaveLength(3);
    const next = (await roundView(
      recordings,
      store,
      weekendRoundId("doomed0001", store.rows.length),
      ME,
    )) as BlindRound;
    expect(await status(play(store, next.round_id, answerFor(next, true)))).toBe(409);
  });

  it("blows out a candle for being fooled by a trap", async () => {
    // Find a seed whose sixth round is a trap.
    let seed = "";
    for (let attempt = 0; seed === "" && attempt < 200; attempt += 1) {
      const candidate = `trapseed${String(attempt).padStart(2, "0")}`;
      if (resolve(weekendRoundId(candidate, 5), ME).content.trap) seed = candidate;
    }
    expect(seed).not.toBe("");
    const store = memoryStore();
    for (let index = 0; index < 5; index += 1) {
      const view = (await roundView(
        recordings,
        store,
        weekendRoundId(seed, index),
        ME,
      )) as BlindRound;
      await play(store, view.round_id, answerFor(view, true));
    }

    const fooled = await play(store, weekendRoundId(seed, 5), { type: "trust", choice: "B" });

    expect(fooled).toMatchObject({ trap: true, outcome: "wrong", points: 0 });
    expect(fooled.game).toMatchObject({ candles: 2, next: 6 });
  });

  it("must be played in order", async () => {
    const store = memoryStore();

    expect(
      await status(play(store, weekendRoundId("inorder001", 3), { type: "call", holds: true })),
    ).toBe(409);
    expect(
      await status(
        play(store, weekendRoundId("inorder001", 1), { type: "author", model: "claude-opus-5-5" }),
      ),
    ).toBe(409);
  });

  it("gives a challenged friend the same ten rounds, then both scores and a compatibility figure", async () => {
    const store = memoryStore();
    const seed = "challenge1";
    expect(await status(createChallenge(store, ME, seed))).toBe(409);
    await playWeekend(store, seed, ME, () => true);
    const { id } = await createChallenge(store, ME, seed);
    expect((await createChallenge(store, ME, seed)).id).toBe(id);

    const before = await challengeView(store, id, FRIEND);
    expect(before).toMatchObject({
      seed,
      you_are_challenger: false,
      challenger: null,
      compatibility: null,
    });
    expect(before.you).toMatchObject({ next: 0, over: false });

    const mine = store.rows.filter((row) => row.voter_id === ME);
    await playWeekend(store, seed, FRIEND, (index) => index !== 0);
    const theirs = store.rows.filter((row) => row.voter_id === FRIEND);
    // The same rounds, the same letters, the same guests in the same seats.
    expect(theirs.slice(0, 3).map((row) => [row.round_id, row.letters])).toEqual(
      mine.slice(0, 3).map((row) => [row.round_id, row.letters]),
    );

    const after = await challengeView(store, id, FRIEND);
    expect(after.challenger).toMatchObject({ survived: true, candles: 3 });
    expect(after.you.over).toBe(true);
    expect(after.compatibility).toMatchObject({ shared: 10, same: 9, percent: 90 });
    // The challenger sees their own link, not a comparison with themselves.
    expect(await challengeView(store, id, ME)).toMatchObject({
      you_are_challenger: true,
      challenger: null,
    });
    expect(await status(challengeView(store, "nope", ME))).toBe(404);
  });
});

describe("The Morning Post", () => {
  it("deals today's five rounds, the same for everyone, and ends with a share text", async () => {
    const store = memoryStore();
    const number = morningPostNumber(NOW);
    const mine: string[] = [];
    for (;;) {
      const dealt = await nextRound(recordings, store, {
        voterId: ME,
        mode: "morning_post",
        now: NOW,
      });
      if (dealt.round === null) {
        expect(dealt.game).toMatchObject({ over: true, number });
        break;
      }
      mine.push(dealt.round.round_id);
      const index = dealt.round.game!.next;
      await play(store, dealt.round.round_id, answerFor(dealt.round, index !== 2));
    }
    const friend = await nextRound(recordings, store, {
      voterId: FRIEND,
      mode: "morning_post",
      now: NOW,
    });
    const state = (
      await nextRound(recordings, store, { voterId: ME, mode: "morning_post", now: NOW })
    ).game;

    expect(mine).toEqual([0, 1, 2, 3, 4].map((index) => morningPostRoundId(number, index)));
    expect(friend.round?.round_id).toBe(mine[0]);
    expect(friend.round?.letters.map((l) => l.guest)).toEqual(
      ((await roundView(recordings, memoryStore(), mine[0], ME)) as BlindRound).letters.map(
        (l) => l.guest,
      ),
    );
    expect(state?.type === "morning_post" && state.share_text).toBe(
      `Poison Pen · Morning Post No. ${number} ■■□■■`,
    );
  });

  it("refuses yesterday's edition and a round out of order", async () => {
    const store = memoryStore();
    const number = morningPostNumber(NOW);

    expect(
      await status(
        play(store, morningPostRoundId(number - 1, 0), {
          type: "author",
          model: "claude-opus-5-5",
        }),
      ),
    ).toBe(409);
    expect(await status(play(store, morningPostRoundId(number, 2), { type: "accuse" }))).toBe(409);
  });

  it("deals a different edition the next day", async () => {
    const store = memoryStore();
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    const today = await nextRound(recordings, store, {
      voterId: ME,
      mode: "morning_post",
      now: NOW,
    });
    const next = await nextRound(recordings, store, {
      voterId: ME,
      mode: "morning_post",
      now: tomorrow,
    });

    expect(next.round?.round_id).not.toBe(today.round?.round_id);
  });
});

describe("expressions", () => {
  const letters = [
    { seat: "A" as const, holds: true },
    { seat: "B" as const, holds: false },
  ];
  const faces = (answer: Answer, facts: { trap: boolean; outcome: "right" | "wrong" | "none" }) => [
    ...expressionsFor(answer, facts, letters).values(),
  ];

  it("follow the decision: trusted happy, the other shocked, a caught impostor flustered", () => {
    expect(faces({ type: "trust", choice: "B" }, { trap: false, outcome: "none" })).toEqual([
      "shocked",
      "happy",
    ]);
    expect(faces({ type: "trust", choice: "equal" }, { trap: false, outcome: "none" })).toEqual([
      "happy",
      "happy",
    ]);
    expect(faces({ type: "trust", choice: "neither" }, { trap: false, outcome: "none" })).toEqual([
      "shocked",
      "shocked",
    ]);
    expect(faces({ type: "accuse" }, { trap: true, outcome: "right" })).toEqual([
      "flustered",
      "flustered",
    ]);
    expect(faces({ type: "accuse" }, { trap: false, outcome: "wrong" })).toEqual([
      "shocked",
      "shocked",
    ]);
    expect(faces({ type: "author", model: "x" }, { trap: false, outcome: "right" })[0]).toBe(
      "flustered",
    );
    expect(faces({ type: "call", holds: true }, { trap: false, outcome: "right" })).toEqual([
      "happy",
      "shocked",
    ]);
  });
});

describe("requests", () => {
  it("accepts only well-formed answers and confidence", () => {
    expect(parseAnswer({ type: "trust", choice: "A", extra: 1 })).toEqual({
      type: "trust",
      choice: "A",
    });
    expect(parseAnswer({ type: "ranking", order: ["A", "C", "B"] })).toEqual({
      type: "ranking",
      order: ["A", "C", "B"],
    });
    expect(parseAnswer({ type: "call", holds: false })).toEqual({ type: "call", holds: false });
    for (const bad of [
      null,
      "accuse",
      {},
      { type: "trust", choice: "C" },
      { type: "ranking", order: "ABC" },
      { type: "call", holds: "yes" },
      { type: "author" },
    ]) {
      expect(() => parseAnswer(bad)).toThrow(ServiceError);
    }
    expect(parseConfidence("hunch")).toBe("hunch");
    expect(() => parseConfidence(undefined)).toThrow(ServiceError);
    expect(() => parseConfidence("sure")).toThrow(ServiceError);
  });

  it("accepts only a UUID as the voter id", () => {
    expect(requireVoterId(ME.toUpperCase())).toBe(ME);
    for (const bad of [null, "", "me", "' OR 1=1 --"]) {
      expect(() => requireVoterId(bad)).toThrow(ServiceError);
    }
  });

  it("refuses decisions past the limit for one address, and keeps counting after a restart", async () => {
    const store = memoryStore();
    const ids = [...catalog.byId.keys()].filter((id) => id.startsWith("dr."));
    const limit = DECISION_LIMITS[0].max;
    const fromOneAddress = (roundId: string, source = recordings) =>
      decide(source, store, {
        roundId,
        voterId: ME,
        answer: { type: "trust", choice: "equal" },
        confidence: "hunch",
        ip: "1.1.1.1",
        now: NOW,
      });
    for (const id of ids.slice(0, limit)) await fromOneAddress(id);

    // The counters live in the store, so a fresh server process still sees them.
    const restarted = loadRecordings();
    const blocked = decide(restarted, store, {
      roundId: ids[limit],
      voterId: ME,
      answer: { type: "trust", choice: "equal" },
      confidence: "hunch",
      ip: "1.1.1.1",
      now: NOW,
    });

    expect(await status(blocked)).toBe(429);
    expect(store.rows).toHaveLength(limit);
    const elsewhere = decide(recordings, store, {
      roundId: ids[limit],
      voterId: ME,
      answer: { type: "trust", choice: "equal" },
      confidence: "hunch",
      ip: "2.2.2.2",
      now: NOW,
    });
    expect(await status(elsewhere)).toBeNull();
  });
});

describe("the Casebook link", () => {
  it("uses a share id that is not the browser id", async () => {
    const store = memoryStore();
    const id = [...catalog.byId.keys()][0];
    await play(store, id, { type: "trust", choice: "A" });
    const shareId = await store.shareIdFor(ME);

    expect(shareId).not.toContain(ME);
    expect(await store.shareIdFor(ME)).toBe(shareId);
    expect((await sharedCasebook(store, shareId)).decisions).toBe(1);
    expect(JSON.stringify(await sharedCasebook(store, shareId))).not.toContain(ME);
    expect(await status(sharedCasebook(store, "nope"))).toBe(404);
  });
});

const MODES_COVERED: Mode[] = ["drawing_room", "library", "weekend", "timetable", "morning_post"];
it("covers every mode", () => {
  expect(MODES_COVERED).toHaveLength(5);
});
