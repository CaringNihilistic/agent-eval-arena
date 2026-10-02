import { CATEGORIES } from "@/lib/types";
import { respond } from "@/server/http";
import { recordings } from "@/server/recordings";

/** What the site holds: how many runs and tasks were recorded, and what can be dealt. */
export async function GET(): Promise<Response> {
  return respond(async () => {
    const data = recordings();
    const { catalog } = data;
    return {
      categories: CATEGORIES,
      runs: data.runs.size,
      tasks: data.tasks.size,
      configs: data.configs.length,
      rounds: {
        duels: catalog.duels.length,
        traps: catalog.traps.length,
        rankings: catalog.rankings.length,
        timetables: catalog.timetables.length,
        authors: catalog.authors.length,
      },
    };
  });
}
