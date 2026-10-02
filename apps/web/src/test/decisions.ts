// Builders for decision records in tests.

import type { GuestId } from "@/lib/guests";
import type { Answer, DecisionRecord, LetterRecord } from "@/lib/types";

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";
export const HAIKU = "claude-haiku-4-5";

let counter = 0;

export function letter(
  seat: "A" | "B" | "C",
  model: string,
  changes: Partial<LetterRecord> = {},
): LetterRecord {
  const guests: GuestId[] = ["constance", "pike", "ambrose"];
  const position = ["A", "B", "C"].indexOf(seat);
  return {
    seat,
    position,
    guest: guests[position],
    run_id: `run-${model}-${seat}`,
    config_id: `${model}@v1`,
    model,
    passed: null,
    score: 1,
    answer_words: 50,
    holds: true,
    ...changes,
  };
}

/** A decision with sensible defaults: a Drawing Room duel between Opus and Haiku, trusting A. */
export function decision(changes: Partial<DecisionRecord> = {}): DecisionRecord {
  counter += 1;
  const answer: Answer = changes.answer ?? { type: "trust", choice: "A" };
  return {
    round_id: `dr.${String(counter).padStart(16, "0")}`,
    voter_id: "voter-1",
    mode: "drawing_room",
    kind: "duel",
    game: null,
    round_index: null,
    content_key: `duel|task-${counter}`,
    task_id: `task-${counter}`,
    task_category: "writing",
    open_ended: true,
    trap: false,
    answer,
    confidence: "fairly",
    letters: [letter("A", OPUS), letter("B", HAIKU)],
    outcome: "none",
    points: 0,
    created_at: new Date(1_790_000_000_000 + counter * 1000).toISOString(),
    ...changes,
  };
}

export function authorRound(model: string, named: string, changes: Partial<DecisionRecord> = {}) {
  const right = model === named;
  return decision({
    mode: "weekend",
    kind: "author",
    answer: { type: "author", model: named },
    letters: [letter("A", model)],
    outcome: right ? "right" : "wrong",
    points: right ? 100 : 0,
    ...changes,
  });
}
