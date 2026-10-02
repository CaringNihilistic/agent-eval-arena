import { buildLeaderboard } from "@/lib/leaderboard";
import { isCategory } from "@/lib/types";
import { respond } from "@/server/http";
import { ServiceError } from "@/server/round-service";
import { recordings } from "@/server/recordings";
import { store } from "@/server/store";

/** The Official Record: the three rankings and the tables behind them, optionally for one category. */
export async function GET(request: Request): Promise<Response> {
  return respond(async () => {
    const category = new URL(request.url).searchParams.get("category");
    if (category !== null && !isCategory(category)) {
      throw new ServiceError(400, "Unknown category.");
    }
    const data = recordings();
    const decisions = await store().allDecisions();
    return {
      ...buildLeaderboard(
        [...data.runs.values()],
        decisions,
        data.official,
        data.configs,
        category,
      ),
      official_data: data.official,
    };
  });
}
