import { respond } from "@/server/http";
import { matchView, requireVoterId } from "@/server/match-service";
import { recordings } from "@/server/recordings";
import { voteStore } from "@/server/store";

/** A match: the blind view until this voter has voted on it, the reveal after. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    const { id } = await params;
    return matchView(recordings(), voteStore(), id, voterId);
  });
}
