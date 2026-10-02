import { respond } from "@/server/http";
import { casebookFor, requireVoterId } from "@/server/round-service";
import { store } from "@/server/store";

/** This player's points, rank, distinctions, and Casebook. */
export async function GET(request: Request): Promise<Response> {
  return respond(async () =>
    casebookFor(store(), requireVoterId(request.headers.get("x-voter-id"))),
  );
}
