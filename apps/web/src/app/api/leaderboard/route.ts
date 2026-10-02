import { buildLeaderboard } from "@/lib/leaderboard";
import { isCategory } from "@/lib/types";
import { respond } from "@/server/http";
import { ServiceError } from "@/server/match-service";
import { recordings } from "@/server/recordings";
import { voteStore } from "@/server/store";

/** The three rankings and the supporting tables, optionally for one category. */
export async function GET(request: Request): Promise<Response> {
  return respond(async () => {
    const category = new URL(request.url).searchParams.get("category");
    if (category !== null && !isCategory(category)) {
      throw new ServiceError(400, "Unknown category.");
    }
    const data = recordings();
    const votes = await voteStore().allVotes();
    return {
      ...buildLeaderboard([...data.runs.values()], votes, data.official, data.configs, category),
      official_data: data.official,
    };
  });
}
