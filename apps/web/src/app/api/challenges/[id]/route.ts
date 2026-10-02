import { respond } from "@/server/http";
import { challengeView, requireVoterId } from "@/server/round-service";
import { store } from "@/server/store";

/** A challenge: the seed to play, and both results once this player has finished. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    return challengeView(store(), (await params).id, voterId);
  });
}
