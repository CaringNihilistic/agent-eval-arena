import { isChoice } from "@/lib/types";
import { clientIp, jsonBody, respond } from "@/server/http";
import { castVote, requireVoterId, ServiceError } from "@/server/match-service";
import { recordings } from "@/server/recordings";
import { voteStore } from "@/server/store";

/** Record a vote and return the reveal. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    const { id } = await params;
    const { choice } = await jsonBody(request);
    if (!isChoice(choice)) {
      throw new ServiceError(400, "choice must be one of left, right, tie, both_bad.");
    }
    return castVote(recordings(), voteStore(), {
      matchId: id,
      voterId,
      choice,
      ip: clientIp(request),
    });
  }, 201);
}
