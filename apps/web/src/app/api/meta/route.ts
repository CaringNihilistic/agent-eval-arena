import { CATEGORIES } from "@/lib/types";
import { respond } from "@/server/http";
import { recordings } from "@/server/recordings";

/** What the site holds: how many runs, matches, and tasks were recorded. */
export async function GET(): Promise<Response> {
  return respond(async () => {
    const data = recordings();
    return {
      categories: CATEGORIES,
      runs: data.runs.size,
      matches: data.matches.size,
      tasks: data.tasks.size,
      configs: data.configs.length,
    };
  });
}
