// Elo ratings from the vote log. The only implementation in the project.
// Ratings are always recomputed from the log, never stored.

import { percentile, seededRandom } from "@/lib/stats";

export type Choice = "left" | "right" | "tie" | "both_bad";

export interface EloVote {
  left: string;
  right: string;
  choice: Choice;
}

export const ELO_START = 1000;
export const ELO_K = 32;
export const BOOTSTRAP_RESAMPLES = 1000;
export const BOOTSTRAP_SEED = 20261002;

/** The left side's score: 1 for a win, 0 for a loss, 0.5 for a tie or "both bad". */
function leftScore(choice: Choice): number {
  if (choice === "left") return 1;
  if (choice === "right") return 0;
  return 0.5;
}

/** Replay the votes in the order given. Every player starts at 1000. */
export function eloRatings(
  votes: readonly EloVote[],
  players: readonly string[] = [],
): Map<string, number> {
  const ratings = new Map<string, number>(players.map((player) => [player, ELO_START]));
  for (const vote of votes) {
    const left = ratings.get(vote.left) ?? ELO_START;
    const right = ratings.get(vote.right) ?? ELO_START;
    const expectedLeft = 1 / (1 + 10 ** ((right - left) / 400));
    const change = ELO_K * (leftScore(vote.choice) - expectedLeft);
    ratings.set(vote.left, left + change);
    ratings.set(vote.right, right - change);
  }
  return ratings;
}

export interface EloRow {
  config: string;
  elo: number;
  /** Null until the config has a vote. */
  ci_low: number | null;
  ci_high: number | null;
  votes: number;
  wins: number;
  losses: number;
  ties: number;
}

function tally(votes: readonly EloVote[], player: string) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const vote of votes) {
    if (vote.left !== player && vote.right !== player) continue;
    const mine = vote.left === player ? "left" : "right";
    if (vote.choice === "tie" || vote.choice === "both_bad") ties += 1;
    else if (vote.choice === mine) wins += 1;
    else losses += 1;
  }
  return { votes: wins + losses + ties, wins, losses, ties };
}

/**
 * The preference table. The headline rating replays the votes in the order
 * given (chronological). The 95% interval is a percentile bootstrap: the votes
 * are resampled with replacement, which also shuffles their order.
 */
export function eloTable(
  votes: readonly EloVote[],
  players: readonly string[],
  options: { resamples?: number; seed?: number } = {},
): EloRow[] {
  const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES;
  const random = seededRandom(options.seed ?? BOOTSTRAP_SEED);
  const headline = eloRatings(votes, players);
  const samples = new Map<string, number[]>(players.map((player) => [player, []]));

  if (votes.length > 0) {
    for (let round = 0; round < resamples; round += 1) {
      const resampled = votes.map(() => votes[Math.floor(random() * votes.length)]);
      const ratings = eloRatings(resampled, players);
      for (const player of players) {
        samples.get(player)?.push(ratings.get(player) ?? ELO_START);
      }
    }
  }

  return players
    .map((player) => {
      const counts = tally(votes, player);
      const sorted = [...(samples.get(player) ?? [])].sort((a, b) => a - b);
      const hasInterval = counts.votes > 0 && sorted.length > 0;
      return {
        config: player,
        elo: headline.get(player) ?? ELO_START,
        ci_low: hasInterval ? percentile(sorted, 0.025) : null,
        ci_high: hasInterval ? percentile(sorted, 0.975) : null,
        ...counts,
      };
    })
    .sort((a, b) => b.elo - a.elo || a.config.localeCompare(b.config));
}
