import { isMode } from "@/lib/types";
import { jsonBody, respond } from "@/server/http";
import { nextRound, requireVoterId, ServiceError } from "@/server/round-service";
import { recordings } from "@/server/recordings";
import { store } from "@/server/store";

/** Deal the next round of a mode, blind, with the state of the game it belongs to. */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    const { mode, seed } = await jsonBody(request);
    if (!isMode(mode)) throw new ServiceError(400, "Unknown mode.");
    if (seed !== undefined && seed !== null && typeof seed !== "string") {
      throw new ServiceError(400, "That is not a game seed.");
    }
    return nextRound(recordings(), store(), { voterId, mode, seed: seed ?? null });
  });
}
