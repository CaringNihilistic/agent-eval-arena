import { respond } from "@/server/http";
import { requireVoterId } from "@/server/round-service";
import { store } from "@/server/store";

/** The public id of this player's Casebook. It is random and is not the browser id. */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    return { share_id: await store().shareIdFor(voterId) };
  });
}
