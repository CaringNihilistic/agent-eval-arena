// Reads the recorded runs and Anthropic's published scores from the repository's
// data folder. Server only: the files hold scores and config names, which a
// player must not receive before deciding.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { TraceEvent } from "@arena/schema";

import { hasVisibleWork } from "@/lib/blind-view";
import type { ConfigInfo } from "@/lib/leaderboard";
import { buildCatalog, type Catalog } from "@/lib/rounds";
import type { OfficialBenchmarks, PublicTask, RunHeader } from "@/lib/types";

export interface Recordings {
  runs: ReadonlyMap<string, RunHeader>;
  tasks: ReadonlyMap<string, PublicTask>;
  configs: readonly ConfigInfo[];
  official: OfficialBenchmarks;
  /** Everything that can be dealt as a round. */
  catalog: Catalog;
  events(runId: string): TraceEvent[];
}

/** The repository's `data` folder. The web app runs from `apps/web`. */
export function dataDir(): string {
  return process.env.ARENA_DATA_DIR ?? join(process.cwd(), "..", "..", "data");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** A run file is a header line followed by one trace event per line. */
export function parseRunFile(text: string): TraceEvent[] {
  return text
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TraceEvent);
}

/** Assemble the recordings from their parts. Tests use this with fixtures. */
export function makeRecordings(
  headers: readonly RunHeader[],
  tasks: readonly PublicTask[],
  official: OfficialBenchmarks,
  events: (runId: string) => TraceEvent[],
): Recordings {
  const runs = new Map(headers.map((run) => [run.run_id, run]));
  const configs = new Map<string, ConfigInfo>();
  for (const run of headers) {
    configs.set(run.config_id, {
      id: run.config_id,
      display_name: run.display_name,
      model: run.model,
    });
  }
  const watchable = new Set(
    headers.filter((run) => hasVisibleWork(events(run.run_id))).map((run) => run.run_id),
  );
  return {
    runs,
    tasks: new Map(tasks.map((task) => [task.id, task])),
    configs: [...configs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    official,
    catalog: buildCatalog(headers, watchable),
    events,
  };
}

export function loadRecordings(root: string = dataDir()): Recordings {
  const folder = join(root, "recordings");
  const headers = readJson<RunHeader[]>(join(folder, "runs-index.json")).map((run) => ({
    ...run,
    take: run.take ?? 1,
  }));
  const files = new Map(headers.map((run) => [run.run_id, run.file]));
  const cache = new Map<string, TraceEvent[]>();
  const events = (runId: string): TraceEvent[] => {
    const file = files.get(runId);
    if (!file) throw new Error(`No recorded run ${runId}`);
    let loaded = cache.get(runId);
    if (!loaded) {
      loaded = parseRunFile(readFileSync(join(folder, file), "utf8"));
      cache.set(runId, loaded);
    }
    return loaded;
  };
  return makeRecordings(
    headers,
    readJson<PublicTask[]>(join(folder, "tasks.json")),
    readJson<OfficialBenchmarks>(join(root, "official-benchmarks.json")),
    events,
  );
}

let cached: Recordings | undefined;

/** The recordings, read once per server process. They change only with a deploy. */
export function recordings(): Recordings {
  cached ??= loadRecordings();
  return cached;
}
