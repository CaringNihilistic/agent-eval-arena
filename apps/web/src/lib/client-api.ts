// Browser-side calls to the site's own route handlers.

import type { Choice } from "@/lib/elo";
import type { Leaderboard } from "@/lib/leaderboard";
import type {
  Category,
  MatchResponse,
  OfficialBenchmarks,
  RevealedMatchResponse,
} from "@/lib/types";

const VOTER_KEY = "arena-voter-id";

/** An anonymous id kept in this browser. It only stops one browser voting twice. */
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

export function startMatch(category: Category | null): Promise<{ match_id: string }> {
  return call("/api/matches", { method: "POST", body: JSON.stringify({ category }) });
}

export function fetchMatch(matchId: string): Promise<MatchResponse> {
  return call(`/api/matches/${encodeURIComponent(matchId)}`);
}

export function sendVote(matchId: string, choice: Choice): Promise<RevealedMatchResponse> {
  return call(`/api/matches/${encodeURIComponent(matchId)}/vote`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });
}

export type LeaderboardResponse = Leaderboard & { official_data: OfficialBenchmarks };

export function fetchLeaderboard(category: Category | null): Promise<LeaderboardResponse> {
  return call(`/api/leaderboard${category ? `?category=${category}` : ""}`);
}
