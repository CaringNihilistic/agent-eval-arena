// Reads the recorded runs and Anthropic's published scores from the repository's
// data folder. Server only: the files hold scores and config names, which a
// voter must not receive before voting.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { TraceEvent } from "@arena/schema";

import type { ConfigInfo } from "@/lib/leaderboard";
import type { MatchRecord, OfficialBenchmarks, PublicTask, RunHeader } from "@/lib/types";

export interface Recordings {
  runs: ReadonlyMap<string, RunHeader>;
  matches: ReadonlyMap<string, MatchRecord>;
  tasks: ReadonlyMap<string, PublicTask>;
  configs: readonly ConfigInfo[];
  official: OfficialBenchmarks;
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

export function loadRecordings(root: string = dataDir()): Recordings {
  const folder = join(root, "recordings");
  const headers = readJson<RunHeader[]>(join(folder, "runs-index.json"));
  const runs = new Map(headers.map((run) => [run.run_id, run]));
  const configs = new Map<string, ConfigInfo>();
  for (const run of headers) {
    configs.set(run.config_id, {
      id: run.config_id,
      display_name: run.display_name,
      model: run.model,
    });
  }
  const eventCache = new Map<string, TraceEvent[]>();
  return {
    runs,
    matches: new Map(
      readJson<MatchRecord[]>(join(folder, "matches.json")).map((match) => [match.id, match]),
    ),
    tasks: new Map(
      readJson<PublicTask[]>(join(folder, "tasks.json")).map((task) => [task.id, task]),
    ),
    configs: [...configs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    official: readJson<OfficialBenchmarks>(join(root, "official-benchmarks.json")),
    events(runId) {
      const run = runs.get(runId);
      if (!run) throw new Error(`No recorded run ${runId}`);
      let events = eventCache.get(runId);
      if (!events) {
        events = parseRunFile(readFileSync(join(folder, run.file), "utf8"));
        eventCache.set(runId, events);
      }
      return events;
    },
  };
}

let cached: Recordings | undefined;

/** The recordings, read once per server process. They change only with a deploy. */
export function recordings(): Recordings {
  cached ??= loadRecordings();
  return cached;
}
