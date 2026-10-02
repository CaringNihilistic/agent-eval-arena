// Points, ranks, distinctions, candles. The only implementation in the project.
//
// The rule that shapes all of it: points come only from answers that can be
// right or wrong. A preference earns nothing, and nothing here ever looks at
// what other players chose.

import type {
  Answer,
  DecisionRecord,
  Distinction,
  MorningPostState,
  Outcome,
  RoundKind,
  Seat,
  WeekendState,
} from "@/lib/types";
import { SEATS } from "@/lib/types";

export const POINTS = {
  author: 100,
  timetable: 40,
  accusation_right: 50,
  accusation_wrong: -30,
} as const;

export const WEEKEND_ROUNDS = 10;
export const WEEKEND_CANDLES = 3;
export const MORNING_POST_ROUNDS = 5;

export interface Verdict {
  outcome: Outcome;
  points: number;
}

/** Is this answer one the round kind accepts? */
export function answerFits(kind: RoundKind, answer: Answer, authors: readonly string[]): boolean {
  switch (answer.type) {
    case "trust":
      return kind === "duel";
    case "accuse":
      return kind === "duel" || kind === "ranking";
    case "ranking": {
      const seats: readonly Seat[] = SEATS;
      return (
        kind === "ranking" &&
        answer.order.length === seats.length &&
        seats.every((seat) => answer.order.includes(seat))
      );
    }
    case "author":
      return kind === "author" && authors.includes(answer.model);
    case "call":
      return kind === "timetable";
  }
}

/**
 * Judge an answer against the facts of the round. `trap` is whether one model
 * wrote every letter; `model` and `holds` describe the single letter of an
 * author or timetable round.
 */
export function judge(
  kind: RoundKind,
  answer: Answer,
  facts: { trap: boolean; model: string; holds: boolean },
): Verdict {
  switch (answer.type) {
    case "accuse":
      return facts.trap
        ? { outcome: "right", points: POINTS.accusation_right }
        : { outcome: "wrong", points: POINTS.accusation_wrong };
    case "trust":
      // Trusting one of two letters by the same author is being fooled: wrong,
      // but it costs no points. Otherwise a preference has no right answer.
      return { outcome: facts.trap ? "wrong" : "none", points: 0 };
    case "ranking":
      return { outcome: "none", points: 0 };
    case "author":
      return answer.model === facts.model
        ? { outcome: "right", points: POINTS.author }
        : { outcome: "wrong", points: 0 };
    case "call":
      return answer.holds === facts.holds
        ? { outcome: "right", points: POINTS.timetable }
        : { outcome: "wrong", points: 0 };
  }
}

export const RANKS = [
  { name: "Guest", from: 0 },
  { name: "Amateur Sleuth", from: 200 },
  { name: "Private Inquiry Agent", from: 600 },
  { name: "Celebrated Detective", from: 1500 },
] as const;

/** A player's points. Never shown below zero. */
export function totalPoints(decisions: readonly DecisionRecord[]): number {
  return Math.max(
    0,
    decisions.reduce((sum, decision) => sum + decision.points, 0),
  );
}

export function rankFor(points: number): {
  name: string;
  next: { name: string; at: number } | null;
} {
  let index = 0;
  for (let i = 0; i < RANKS.length; i += 1) if (points >= RANKS[i].from) index = i;
  const next = RANKS[index + 1];
  return { name: RANKS[index].name, next: next ? { name: next.name, at: next.from } : null };
}

const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-4-5";

/** The model behind the letter a player trusted, or null if they trusted none or both. */
export function trustedModel(decision: DecisionRecord): string | null {
  if (decision.answer.type === "trust") {
    const choice = decision.answer.choice;
    return decision.letters.find((letter) => letter.seat === choice)?.model ?? null;
  }
  if (decision.answer.type === "ranking") {
    const top = decision.answer.order[0];
    return decision.letters.find((letter) => letter.seat === top)?.model ?? null;
  }
  return null;
}

/** Candles blown out in a Weekend's rounds, in order, stopping when all are out. */
function playedWeekend(decisions: readonly DecisionRecord[], game: string): DecisionRecord[] {
  return decisions
    .filter((decision) => decision.game === game && decision.round_index !== null)
    .sort((a, b) => (a.round_index ?? 0) - (b.round_index ?? 0));
}

export function weekendState(decisions: readonly DecisionRecord[], seed: string): WeekendState {
  const game = `wk.${seed}`;
  const played = playedWeekend(decisions, game);
  const results = played.map((decision) => decision.outcome);
  const lost = results.filter((outcome) => outcome === "wrong").length;
  const candles = Math.max(0, WEEKEND_CANDLES - lost);
  const finished = played.length >= WEEKEND_ROUNDS;
  return {
    type: "weekend",
    game,
    seed,
    total: WEEKEND_ROUNDS,
    next: played.length,
    candles,
    points: played.reduce((sum, decision) => sum + decision.points, 0),
    results,
    over: finished || candles === 0,
    survived: finished && candles > 0,
  };
}

/** The Morning Post result as squares: filled unless the answer was wrong. */
export function shareSquares(results: readonly Outcome[]): string {
  return results.map((outcome) => (outcome === "wrong" ? "□" : "■")).join("");
}

export function morningPostState(
  decisions: readonly DecisionRecord[],
  number: number,
  date: string,
): MorningPostState {
  const game = `mp.${number}`;
  const played = playedWeekend(decisions, game);
  const results = played.map((decision) => decision.outcome);
  const over = played.length >= MORNING_POST_ROUNDS;
  return {
    type: "morning_post",
    game,
    number,
    date,
    total: MORNING_POST_ROUNDS,
    next: played.length,
    results,
    over,
    share_text: over ? `Poison Pen · Morning Post No. ${number} ${shareSquares(results)}` : null,
  };
}

export const EXPENSIVE_TASTE_ROUNDS = 5;
export const EAR_FOR_HAIKU_NAMINGS = 3;
export const FOOLED_TRAPS = 2;
export const LIBRARY_RANKINGS = 10;

export const DISTINCTIONS: readonly Distinction[] = [
  {
    id: "spotted_the_impostor",
    name: "Spotted the Impostor",
    rule: "Accuse correctly once: one author, two seats.",
  },
  {
    id: "an_ear_for_haiku",
    name: "An Ear for Haiku",
    rule: `Name Haiku as the author correctly ${EAR_FOR_HAIKU_NAMINGS} times.`,
  },
  {
    id: "expensive_taste",
    name: "Expensive Taste",
    rule: `Trust Opus every time it is at the table, over at least ${EXPENSIVE_TASTE_ROUNDS} rounds.`,
  },
  {
    id: "thoroughly_fooled",
    name: "Thoroughly Fooled",
    rule: `Trust a letter in ${FOOLED_TRAPS} rounds where one author held both seats.`,
  },
  {
    id: "master_of_the_library",
    name: "Master of the Library",
    rule: `Rank ${LIBRARY_RANKINGS} Library Gatherings.`,
  },
  {
    id: "survived_the_weekend",
    name: "Survived the Weekend",
    rule: "Finish all ten rounds of a Weekend with a candle still lit.",
  },
];

/** The ids of the distinctions a player's decisions have earned. */
export function earnedDistinctions(decisions: readonly DecisionRecord[]): Set<string> {
  const earned = new Set<string>();

  if (decisions.some((d) => d.answer.type === "accuse" && d.outcome === "right")) {
    earned.add("spotted_the_impostor");
  }

  const haikuNamed = decisions.filter(
    (d) => d.answer.type === "author" && d.answer.model === HAIKU && d.outcome === "right",
  );
  if (haikuNamed.length >= EAR_FOR_HAIKU_NAMINGS) earned.add("an_ear_for_haiku");

  // Preference rounds with Opus among different authors, whatever the mode.
  const withOpus = decisions.filter(
    (d) =>
      !d.trap &&
      (d.answer.type === "trust" || d.answer.type === "ranking") &&
      d.letters.some((letter) => letter.model === OPUS),
  );
  if (
    withOpus.length >= EXPENSIVE_TASTE_ROUNDS &&
    withOpus.every((d) => trustedModel(d) === OPUS)
  ) {
    earned.add("expensive_taste");
  }

  const fooled = decisions.filter((d) => d.trap && d.answer.type === "trust");
  if (fooled.length >= FOOLED_TRAPS) earned.add("thoroughly_fooled");

  const ranked = decisions.filter((d) => d.mode === "library" && d.answer.type === "ranking");
  if (ranked.length >= LIBRARY_RANKINGS) earned.add("master_of_the_library");

  const weekends = new Set(
    decisions.filter((d) => d.mode === "weekend" && d.game).map((d) => d.game as string),
  );
  for (const game of weekends) {
    if (weekendState(decisions, game.slice(3)).survived) earned.add("survived_the_weekend");
  }
  return earned;
}

/** Distinctions earned by the latest decision: those held after it and not before. */
export function newlyEarned(
  before: readonly DecisionRecord[],
  after: readonly DecisionRecord[],
): Distinction[] {
  const had = earnedDistinctions(before);
  const has = earnedDistinctions(after);
  return DISTINCTIONS.filter((distinction) => has.has(distinction.id) && !had.has(distinction.id));
}
