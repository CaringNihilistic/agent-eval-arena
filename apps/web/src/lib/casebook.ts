// A player's Casebook, the crowd figure on the reveal, and the comparison two
// players get from a challenge. All computed from the decision log.
//
// Agreement with other players is reported here as information. It never earns
// anything: see scoring.ts.

import { GUESTS, type GuestId } from "@/lib/guests";
import {
  DISTINCTIONS,
  earnedDistinctions,
  rankFor,
  shareSquares,
  totalPoints,
  trustedModel,
} from "@/lib/scoring";
import type { Confidence, Crowd, DecisionRecord, Distinction, LetterRecord } from "@/lib/types";
import { CONFIDENCES } from "@/lib/types";

/** Decisions a player needs before the Casebook is shown. */
export const CASEBOOK_AFTER = 10;
/** Sided votes a pairing needs before the share who agreed is shown. */
export const CROWD_MIN = 5;

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

/** The letter a player trusted over the other in a two-letter round, if they did. */
export function trustedLetter(decision: DecisionRecord): LetterRecord | null {
  if (decision.kind !== "duel" || decision.answer.type !== "trust") return null;
  const choice = decision.answer.choice;
  return decision.letters.find((letter) => letter.seat === choice) ?? null;
}

/**
 * Of the players who trusted one letter or the other in this pairing, the share
 * who trusted the one this player did. Withheld until enough have voted.
 */
export function crowdShare(
  onContent: readonly DecisionRecord[],
  mine: DecisionRecord,
): Crowd | null {
  if (mine.kind !== "duel" || mine.answer.type !== "trust") return null;
  const sided = onContent.map(trustedLetter).filter((letter) => letter !== null);
  const trusted = trustedLetter(mine);
  if (sided.length < CROWD_MIN || trusted === null) {
    return { votes: sided.length, same_share: null };
  }
  const same = sided.filter((letter) => letter.run_id === trusted.run_id).length;
  return { votes: sided.length, same_share: same / sided.length };
}

export interface Method {
  name: string;
  because: string;
}

const MIN_FOR_METHOD = 5;

/** A name for how a player votes, from their own two-letter rounds. */
export function methodFor(decisions: readonly DecisionRecord[]): Method {
  const duels = decisions.filter((d) => d.kind === "duel");
  const trusts = duels.filter((d) => d.answer.type === "trust");
  const share = (count: number, of: number) => (of === 0 ? 0 : count / of);
  const choice = (name: string) =>
    trusts.filter((d) => d.answer.type === "trust" && d.answer.choice === name).length;

  if (duels.length >= MIN_FOR_METHOD) {
    const accusations = duels.filter((d) => d.answer.type === "accuse").length;
    if (share(accusations, duels.length) >= 0.3) {
      return {
        name: "The Accuser",
        because: "You suspect one author behind two seats more often than most.",
      };
    }
  }
  if (trusts.length >= MIN_FOR_METHOD) {
    if (share(choice("neither"), trusts.length) >= 0.4) {
      return { name: "The Skeptic", because: "You often trust neither letter." };
    }
    if (share(choice("equal"), trusts.length) >= 0.4) {
      return { name: "The Diplomat", because: "You often find both letters equally good." };
    }
  }
  const sided = trusts
    .map((d) => ({ trusted: trustedLetter(d), letters: d.letters }))
    .filter(
      (item): item is { trusted: LetterRecord; letters: LetterRecord[] } =>
        item.trusted !== null &&
        item.letters.length === 2 &&
        item.letters[0].answer_words !== item.letters[1].answer_words,
    );
  if (sided.length >= MIN_FOR_METHOD) {
    const shorter = sided.filter(
      ({ trusted, letters }) =>
        trusted.answer_words < Math.max(...letters.map((letter) => letter.answer_words)),
    ).length;
    if (share(shorter, sided.length) >= 0.6) {
      return { name: "The Plain Speaker", because: "You mostly trust the shorter letter." };
    }
    if (share(shorter, sided.length) <= 0.4) {
      return { name: "The Completist", because: "You mostly trust the longer letter." };
    }
  }
  return { name: "The Even Hand", because: "No single habit shows in your votes yet." };
}

export interface Tally {
  right: number;
  total: number;
}

export interface Casebook {
  decisions: number;
  /** False until the player has made enough decisions for the card to mean anything. */
  ready: boolean;
  needed: number;
  points: number;
  rank: string;
  next_rank: { name: string; at: number } | null;
  distinctions: (Distinction & { earned: boolean })[];
  method: Method;
  /** The model whose letters the player trusted most often, and how often. */
  most_trusted_author: { model: string; trusted: number; seen: number } | null;
  favourite_guest: { guest: GuestId; name: string; trusted: number } | null;
  author_naming: Tally;
  timetable_calls: Tally;
  impostors_caught: number;
  false_accusations: number;
  times_fooled: number;
  /** Of pairings enough players have judged, how often the player sided with most of them. */
  crowd_agreement: Tally;
  /** Of rounds with both Opus and Sonnet, how often the player put Opus first, as the published benchmarks do. */
  benchmark_agreement: Tally;
  by_confidence: Record<Confidence, Tally>;
  morning_post: { game: string; squares: string } | null;
  weekends_survived: number;
}

function preferredOpusOverSonnet(decision: DecisionRecord): boolean | null {
  const models = decision.letters.map((letter) => letter.model);
  if (decision.trap || !models.includes(OPUS) || !models.includes(SONNET)) return null;
  if (decision.answer.type === "trust") {
    const trusted = trustedLetter(decision);
    if (trusted === null) return null;
    return trusted.model === OPUS ? true : trusted.model === SONNET ? false : null;
  }
  if (decision.answer.type === "ranking") {
    const modelAt = (seat: string) => decision.letters.find((l) => l.seat === seat)?.model;
    const order = decision.answer.order.map(modelAt);
    return order.indexOf(OPUS) < order.indexOf(SONNET);
  }
  return null;
}

/**
 * Build a player's Casebook. `byContent` maps a pairing to every player's
 * decisions on it, for the agreement figure; it may include the player's own.
 */
export function buildCasebook(
  mine: readonly DecisionRecord[],
  byContent: ReadonlyMap<string, readonly DecisionRecord[]>,
): Casebook {
  const points = totalPoints(mine);
  const rank = rankFor(points);
  const earned = earnedDistinctions(mine);

  // Trust by author, over preference rounds between different authors.
  const seen = new Map<string, number>();
  const trusted = new Map<string, number>();
  const guestTrusted = new Map<GuestId, number>();
  for (const decision of mine) {
    if (decision.answer.type !== "trust" && decision.answer.type !== "ranking") continue;
    const top =
      decision.answer.type === "ranking"
        ? decision.letters.find(
            (l) => decision.answer.type === "ranking" && l.seat === decision.answer.order[0],
          )
        : trustedLetter(decision);
    if (top) guestTrusted.set(top.guest, (guestTrusted.get(top.guest) ?? 0) + 1);
    if (decision.trap) continue;
    for (const letter of decision.letters)
      seen.set(letter.model, (seen.get(letter.model) ?? 0) + 1);
    const model = trustedModel(decision);
    if (model) trusted.set(model, (trusted.get(model) ?? 0) + 1);
  }
  const topAuthor = [...trusted.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const topGuest = [...guestTrusted.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];

  const tally = (subset: readonly DecisionRecord[]): Tally => ({
    right: subset.filter((d) => d.outcome === "right").length,
    total: subset.length,
  });
  const judged = mine.filter((d) => d.outcome !== "none");

  const crowd: Tally = { right: 0, total: 0 };
  for (const decision of mine) {
    const share = crowdShare(byContent.get(decision.content_key) ?? [], decision);
    if (!share || share.same_share === null) continue;
    crowd.total += 1;
    if (share.same_share >= 0.5) crowd.right += 1;
  }

  const benchmark: Tally = { right: 0, total: 0 };
  for (const decision of mine) {
    const preferred = preferredOpusOverSonnet(decision);
    if (preferred === null) continue;
    benchmark.total += 1;
    if (preferred) benchmark.right += 1;
  }

  const posts = mine.filter((d) => d.mode === "morning_post" && d.game !== null);
  const latestPost = posts
    .map((d) => d.game as string)
    .sort((a, b) => Number(b.slice(3)) - Number(a.slice(3)))[0];
  const postRounds = posts
    .filter((d) => d.game === latestPost)
    .sort((a, b) => (a.round_index ?? 0) - (b.round_index ?? 0));

  const accusations = mine.filter((d) => d.answer.type === "accuse");
  const weekendGames = new Set(mine.filter((d) => d.mode === "weekend").map((d) => d.game));
  const survived = [...weekendGames].filter((game) => {
    const rounds = mine.filter((d) => d.game === game);
    return rounds.length >= 10 && rounds.filter((d) => d.outcome === "wrong").length < 3;
  }).length;

  return {
    decisions: mine.length,
    ready: mine.length >= CASEBOOK_AFTER,
    needed: Math.max(0, CASEBOOK_AFTER - mine.length),
    points,
    rank: rank.name,
    next_rank: rank.next,
    distinctions: DISTINCTIONS.map((distinction) => ({
      ...distinction,
      earned: earned.has(distinction.id),
    })),
    method: methodFor(mine),
    most_trusted_author: topAuthor
      ? { model: topAuthor[0], trusted: topAuthor[1], seen: seen.get(topAuthor[0]) ?? 0 }
      : null,
    favourite_guest: topGuest
      ? {
          guest: topGuest[0],
          name: GUESTS.find((g) => g.id === topGuest[0])?.name ?? topGuest[0],
          trusted: topGuest[1],
        }
      : null,
    author_naming: tally(mine.filter((d) => d.kind === "author")),
    timetable_calls: tally(mine.filter((d) => d.kind === "timetable")),
    impostors_caught: accusations.filter((d) => d.outcome === "right").length,
    false_accusations: accusations.filter((d) => d.outcome === "wrong").length,
    times_fooled: mine.filter((d) => d.trap && d.answer.type === "trust").length,
    crowd_agreement: crowd,
    benchmark_agreement: benchmark,
    by_confidence: Object.fromEntries(
      CONFIDENCES.map((level) => [level, tally(judged.filter((d) => d.confidence === level))]),
    ) as Record<Confidence, Tally>,
    morning_post: latestPost
      ? { game: latestPost, squares: shareSquares(postRounds.map((d) => d.outcome)) }
      : null,
    weekends_survived: survived,
  };
}

/** The Casebook as a few lines of text, for the copy button. */
export function casebookText(casebook: Casebook): string {
  const lines = [
    `Poison Pen · My Casebook`,
    `${casebook.rank}, ${casebook.points} points · ${casebook.method.name}`,
    `Authors named: ${casebook.author_naming.right} of ${casebook.author_naming.total} · Impostors caught: ${casebook.impostors_caught}`,
  ];
  if (casebook.most_trusted_author) {
    lines.push(`Most trusted author: ${casebook.most_trusted_author.model}`);
  }
  if (casebook.morning_post) {
    lines.push(
      `Morning Post No. ${casebook.morning_post.game.slice(3)} ${casebook.morning_post.squares}`,
    );
  }
  return lines.join("\n");
}

export interface Compatibility {
  /** Rounds of the game both players answered. */
  shared: number;
  same: number;
  /** Share answered the same way. Null when they share no round. */
  percent: number | null;
}

/** "Taste compatibility": of the rounds both played, the share they answered alike. */
export function compatibility(
  mine: readonly DecisionRecord[],
  theirs: readonly DecisionRecord[],
): Compatibility {
  const theirAnswers = new Map(theirs.map((d) => [d.round_id, JSON.stringify(d.answer)]));
  const shared = mine.filter((d) => theirAnswers.has(d.round_id));
  const same = shared.filter((d) => theirAnswers.get(d.round_id) === JSON.stringify(d.answer));
  return {
    shared: shared.length,
    same: same.length,
    percent: shared.length > 0 ? Math.round((100 * same.length) / shared.length) : null,
  };
}
