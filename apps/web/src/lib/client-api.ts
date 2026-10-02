// Browser-side calls to the site's own route handlers.

import type { Casebook } from "@/lib/casebook";
import type { Expression, GuestId } from "@/lib/guests";
import type { Leaderboard } from "@/lib/leaderboard";
import type {
  Answer,
  BlindRound,
  Category,
  Confidence,
  GameState,
  Mode,
  OfficialBenchmarks,
  RevealedRound,
  RoundResponse,
} from "@/lib/types";
import type { ChallengeView } from "@/server/round-service";

const VOTER_KEY = "arena-voter-id";

/** An anonymous id kept in this browser. It only stops one browser deciding a round twice. */
export function voterId(): string {
  let id = window.localStorage.getItem(VOTER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VOTER_KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Voter-Id": voterId(),
      ...init.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body !== null && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `The request failed with ${response.status}.`;
    throw new ApiError(response.status, message);
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export interface NextRoundResponse {
  round: BlindRound | null;
  game: GameState | null;
}

export function fetchNextRound(mode: Mode, seed: string | null): Promise<NextRoundResponse> {
  return call("/api/rounds/next", post({ mode, seed }));
}

export function fetchRound(roundId: string): Promise<RoundResponse> {
  return call(`/api/rounds/${encodeURIComponent(roundId)}`);
}

export function sendDecision(
  roundId: string,
  answer: Answer,
  confidence: Confidence,
): Promise<RevealedRound> {
  return call(`/api/rounds/${encodeURIComponent(roundId)}/decide`, post({ answer, confidence }));
}

export function fetchProfile(): Promise<Casebook> {
  return call("/api/profile");
}

export function createShare(): Promise<{ share_id: string }> {
  return call("/api/casebook/share", post({}));
}

export function fetchSharedCasebook(shareId: string): Promise<Casebook> {
  return call(`/api/casebook/${encodeURIComponent(shareId)}`);
}

export function createChallenge(seed: string): Promise<{ id: string }> {
  return call("/api/challenges", post({ seed }));
}

export function fetchChallenge(id: string): Promise<ChallengeView> {
  return call(`/api/challenges/${encodeURIComponent(id)}`);
}

export type LeaderboardResponse = Leaderboard & { official_data: OfficialBenchmarks };

export function fetchLeaderboard(category: Category | null): Promise<LeaderboardResponse> {
  return call(`/api/leaderboard${category ? `?category=${category}` : ""}`);
}

export type ArtManifest = Record<GuestId, Record<Expression, string | null>>;

export function fetchArt(): Promise<ArtManifest> {
  return call("/api/art");
}
