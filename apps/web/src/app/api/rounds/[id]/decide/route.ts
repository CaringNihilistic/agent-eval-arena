import { clientIp, jsonBody, respond } from "@/server/http";
import { decide, parseAnswer, parseConfidence, requireVoterId } from "@/server/round-service";
import { recordings } from "@/server/recordings";
import { store } from "@/server/store";

/** Record an answer and how sure the player was. Returns the reveal. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    const { id } = await params;
    const body = await jsonBody(request);
    return decide(recordings(), store(), {
      roundId: id,
      voterId,
      answer: parseAnswer(body.answer),
      confidence: parseConfidence(body.confidence),
      ip: clientIp(request),
    });
  }, 201);
}
