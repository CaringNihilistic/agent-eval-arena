import { respond } from "@/server/http";
import { requireVoterId, roundView } from "@/server/round-service";
import { recordings } from "@/server/recordings";
import { store } from "@/server/store";

/** A round: blind until this player has decided it, the reveal after. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(async () => {
    const voterId = requireVoterId(request.headers.get("x-voter-id"));
    const { id } = await params;
    return roundView(recordings(), store(), id, voterId);
  });
}
