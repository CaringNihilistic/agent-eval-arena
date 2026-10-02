import { jsonBody, respond } from "@/server/http";
import { createChallenge, requireVoterId } from "@/server/round-service";
import { store } from "@/server/store";

/** Make a challenge link from a Weekend this player has finished. */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    const { seed } = await jsonBody(request);
    return createChallenge(store(), voterId, seed);
  }, 201);
}
