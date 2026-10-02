// How figures that span several runs are written.

import type { Spread } from "@/lib/types";

/** "85–97" when the runs differ, "96" when they agree. */
export function rangeText(spread: Spread): string {
  return spread.min === spread.max ? String(spread.min) : `${spread.min}–${spread.max}`;
}

/** "across 3 runs", or "in 1 run". */
export function acrossRuns(takes: number): string {
  return takes === 1 ? "in 1 run" : `across ${takes} runs`;
}
