import { isCategory } from "@/lib/types";
import { jsonBody, respond } from "@/server/http";
import { pickMatch, requireVoterId, ServiceError } from "@/server/match-service";
import { recordings } from "@/server/recordings";
import { voteStore } from "@/server/store";

/** Pick a recorded match this voter has not voted on yet. */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    const body = await jsonBody(request);
    const category = body.category ?? null;
    if (category !== null && !isCategory(category)) {
      throw new ServiceError(400, "Unknown category.");
    }
    const matchId = await pickMatch(recordings(), voteStore(), voterId, category);
    if (matchId === null) {
      throw new ServiceError(404, "You have voted on every match in this selection.");
    }
    return { match_id: matchId };
  });
}
