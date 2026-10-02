// How rounds are dealt. The only implementation of pairing, trap selection,
// difficulty, seeding, and seat assignment in the project.
//
// A round is rebuilt from its id on every request: nothing is stored until the
// player decides it. Seeded rounds (a Weekend, a Morning Post) come out the same
// for every player; free-play rounds also depend on the voter.

import { GUEST_IDS, type GuestId } from "@/lib/guests";
import { hashId, pick, randomFor, shuffled } from "@/lib/seed";
import type { Mode, RoundKind, RunHeader, Seat } from "@/lib/types";
import { holds, SEATS } from "@/lib/types";

/** Share of Drawing Room rounds that show one model twice. */
export const TRAP_RATE = 1 / 8;
/** Two letters are "close" when their lengths are within this share of the longer one. */
export const CLOSE_LENGTH = 0.25;

export const WEEKEND_KINDS: readonly RoundKind[] = [
  "author",
  "author",
  "duel",
  "timetable",
  "author",
  "duel",
  "timetable",
  "author",
  "duel",
  "timetable",
];
/** Weekend rounds from this index on use close matches and may be traps. */
export const WEEKEND_HARD_FROM = 4;
/** Chance that a later Weekend duel is a trap. Two such duels make about 1 round in 8. */
export const WEEKEND_TRAP_RATE = 5 / 8;

export const MORNING_POST_KINDS: readonly RoundKind[] = [
  "author",
  "timetable",
  "duel",
  "author",
  "timetable",
];
export const MORNING_POST_TRAP_RATE = 1 / 2;
/** The date of Morning Post No. 1, in UTC. */
export const MORNING_POST_EPOCH = "2026-10-02";

const FREE_PREFIX = { drawing_room: "dr", library: "lib", timetable: "tt" } as const;
type FreeMode = keyof typeof FREE_PREFIX;

/** A set of runs that can be shown as one round. */
export interface Content {
  kind: RoundKind;
  /** The same for every player and every seat order. */
  key: string;
  task_id: string;
  run_ids: string[];
  /** True when every run is by the same model. */
  trap: boolean;
  /** True when the runs are hard to tell apart by score and length. */
  close: boolean;
  /** For a timetable round: whether the run held up. Null for every other kind. */
  holds: boolean | null;
}

export interface Catalog {
  duels: Content[];
  traps: Content[];
  rankings: Content[];
  timetables: Content[];
  authors: Content[];
  /** Free-play round id to its content. */
  byId: Map<string, { mode: FreeMode; content: Content }>;
}

type Comparable = Pick<RunHeader, "score" | "answer_words">;

/** Same score, and lengths within a quarter of the longer letter. */
export function isClose(a: Comparable, b: Comparable): boolean {
  const longer = Math.max(a.answer_words, b.answer_words, 1);
  return a.score === b.score && Math.abs(a.answer_words - b.answer_words) / longer <= CLOSE_LENGTH;
}

function freeId(mode: FreeMode, content: Content): string {
  return `${FREE_PREFIX[mode]}.${hashId(content.key)}`;
}

/** Everything that can be dealt, from the recorded runs. */
export function buildCatalog(runs: readonly RunHeader[]): Catalog {
  const byTask = new Map<string, RunHeader[]>();
  for (const run of runs) {
    byTask.set(run.task_id, [...(byTask.get(run.task_id) ?? []), run]);
  }
  const catalog: Catalog = {
    duels: [],
    traps: [],
    rankings: [],
    timetables: [],
    authors: [],
    byId: new Map(),
  };

  for (const taskId of [...byTask.keys()].sort()) {
    const all = byTask.get(taskId) ?? [];
    const first = all
      .filter((run) => run.take === 1)
      .sort((a, b) => a.config_id.localeCompare(b.config_id));

    for (let i = 0; i < first.length; i += 1) {
      for (let j = i + 1; j < first.length; j += 1) {
        const ids = [first[i].run_id, first[j].run_id].sort();
        catalog.duels.push({
          kind: "duel",
          key: `duel|${taskId}|${ids.join("|")}`,
          task_id: taskId,
          run_ids: ids,
          trap: false,
          close: isClose(first[i], first[j]),
          holds: null,
        });
      }
    }

    for (const run of first) {
      // An impostor round: any two of this author's runs on the task.
      const takes = all
        .filter((other) => other.config_id === run.config_id)
        .sort((x, y) => x.take - y.take);
      for (let i = 0; i < takes.length; i += 1) {
        for (let j = i + 1; j < takes.length; j += 1) {
          const ids = [takes[i].run_id, takes[j].run_id].sort();
          catalog.traps.push({
            kind: "duel",
            key: `duel|${taskId}|${ids.join("|")}`,
            task_id: taskId,
            run_ids: ids,
            trap: true,
            close: true,
            holds: null,
          });
        }
      }
      const others = first.filter((other) => other !== run);
      catalog.authors.push({
        kind: "author",
        key: `author|${run.run_id}`,
        task_id: taskId,
        run_ids: [run.run_id],
        trap: false,
        // Hard to place when it resembles another author's letter on this task.
        close: others.some((other) => isClose(run, other)),
        holds: null,
      });
    }

    if (first.length >= 3) {
      catalog.rankings.push({
        kind: "ranking",
        key: `ranking|${taskId}`,
        task_id: taskId,
        run_ids: first.map((run) => run.run_id).sort(),
        trap: false,
        close: false,
        holds: null,
      });
    }

    // Every run can be put to the question "does it hold?".
    for (const run of all) {
      catalog.timetables.push({
        kind: "timetable",
        key: `timetable|${run.run_id}`,
        task_id: taskId,
        run_ids: [run.run_id],
        trap: false,
        close: false,
        holds: holds(run),
      });
    }
  }

  const register = (mode: FreeMode, contents: readonly Content[]) => {
    for (const content of contents) {
      const id = freeId(mode, content);
      if (catalog.byId.has(id)) throw new Error(`Two rounds share the id ${id}`);
      catalog.byId.set(id, { mode, content });
    }
  };
  register("drawing_room", catalog.duels);
  register("drawing_room", catalog.traps);
  register("library", catalog.rankings);
  register("timetable", catalog.timetables);
  return catalog;
}

/**
 * The guests for a round's seats. It is given a count and a seed and nothing
 * else, so a guest can never depend on which model wrote the letter.
 */
export function assignGuests(count: number, seed: string): GuestId[] {
  return shuffled(GUEST_IDS, randomFor(`guests|${seed}`)).slice(0, count);
}

/** The order the runs sit in, from seat A. */
export function orderRuns(runIds: readonly string[], seed: string): string[] {
  return shuffled(runIds, randomFor(`order|${seed}`));
}

export interface SeatPlan {
  seat: Seat;
  run_id: string;
  guest: GuestId;
}

export interface RoundPlan {
  id: string;
  mode: Mode;
  kind: RoundKind;
  /** "wk.<seed>" or "mp.<day>" for a seeded game, null in free play. */
  game: string | null;
  index: number | null;
  content: Content;
  seats: SeatPlan[];
}

function seat(content: Content, seed: string): SeatPlan[] {
  const guests = assignGuests(content.run_ids.length, seed);
  return orderRuns(content.run_ids, seed).map((runId, index) => ({
    seat: SEATS[index],
    run_id: runId,
    guest: guests[index],
  }));
}

/** Pick from a pool, avoiding tasks already used in this game when it can. */
function draw(
  pool: readonly Content[],
  fallback: readonly Content[],
  usedTasks: Set<string>,
  random: () => number,
): Content {
  const candidates = [pool, fallback]
    .map((contents) => contents.filter((content) => !usedTasks.has(content.task_id)))
    .find((contents) => contents.length > 0);
  const chosen = pick(candidates ?? (pool.length > 0 ? pool : fallback), random);
  usedTasks.add(chosen.task_id);
  return chosen;
}

/** Chance that a timetable round is dealt from the runs that held up. */
export const TIMETABLE_HOLDS_RATE = 1 / 2;

/**
 * The timetable rounds to draw from, chosen by outcome first so that "it holds"
 * and "it falls apart" are each right about half the time, although far more
 * runs hold than fall.
 */
function timetablePool(contents: readonly Content[], random: () => number): Content[] {
  const wanted = random() < TIMETABLE_HOLDS_RATE;
  const pool = contents.filter((content) => content.holds === wanted);
  return pool.length > 0 ? pool : [...contents];
}

/** The ten rounds of a Weekend for a seed. Early rounds are clear, later ones close. */
export function weekendContents(catalog: Catalog, seed: string): Content[] {
  const random = randomFor(`weekend|${seed}`);
  const used = new Set<string>();
  return WEEKEND_KINDS.map((kind, index) => {
    const hard = index >= WEEKEND_HARD_FROM;
    if (kind === "author") {
      return draw(
        catalog.authors.filter((content) => content.close === hard),
        catalog.authors,
        used,
        random,
      );
    }
    if (kind === "timetable") {
      return draw(timetablePool(catalog.timetables, random), catalog.timetables, used, random);
    }
    const different = catalog.duels.filter((content) => content.close === hard);
    // Drawn even when not used, so the same seed gives the same later rounds.
    const trap = random() < WEEKEND_TRAP_RATE;
    if (hard && trap && catalog.traps.length > 0) {
      return draw(catalog.traps, catalog.traps, used, random);
    }
    return draw(different, catalog.duels, used, random);
  });
}

/** Morning Post number for a date: No. 1 on the epoch, one more each UTC day. */
export function morningPostNumber(now: Date): number {
  const epoch = Date.parse(`${MORNING_POST_EPOCH}T00:00:00Z`);
  return Math.max(1, Math.floor((now.getTime() - epoch) / 86_400_000) + 1);
}

/** The UTC date of a Morning Post number, as YYYY-MM-DD. */
export function morningPostDate(number: number): string {
  const epoch = Date.parse(`${MORNING_POST_EPOCH}T00:00:00Z`);
  return new Date(epoch + (number - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** The five rounds of a Morning Post. The same for everyone on that day. */
export function morningPostContents(catalog: Catalog, number: number): Content[] {
  const random = randomFor(`post|${number}`);
  const used = new Set<string>();
  return MORNING_POST_KINDS.map((kind) => {
    if (kind === "author") return draw(catalog.authors, catalog.authors, used, random);
    if (kind === "timetable") {
      return draw(timetablePool(catalog.timetables, random), catalog.timetables, used, random);
    }
    const trap = random() < MORNING_POST_TRAP_RATE;
    if (trap && catalog.traps.length > 0) return draw(catalog.traps, catalog.traps, used, random);
    return draw(catalog.duels, catalog.duels, used, random);
  });
}

const FREE_ID = /^(dr|lib|tt)\.[0-9a-f]{16}$/;
const WEEKEND_ID = /^wk\.([a-z0-9]{6,16})\.(\d)$/;
const MORNING_POST_ID = /^mp\.([1-9]\d{0,5})\.([0-4])$/;
export const SEED = /^[a-z0-9]{6,16}$/;

export function weekendRoundId(seed: string, index: number): string {
  return `wk.${seed}.${index}`;
}

export function morningPostRoundId(number: number, index: number): string {
  return `mp.${number}.${index}`;
}

/** A new Weekend seed. */
export function newSeed(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 10 }, () => alphabet[Math.floor(random() * alphabet.length)]).join(
    "",
  );
}

/**
 * Rebuild a round from its id, or null if the id is not one this catalog can
 * deal. Free-play seats also depend on the voter; seeded seats do not.
 */
export function resolveRound(catalog: Catalog, id: string, voterId: string): RoundPlan | null {
  if (FREE_ID.test(id)) {
    const entry = catalog.byId.get(id);
    if (!entry) return null;
    return {
      id,
      mode: entry.mode,
      kind: entry.content.kind,
      game: null,
      index: null,
      content: entry.content,
      seats: seat(entry.content, `${id}|${voterId}`),
    };
  }
  const weekend = WEEKEND_ID.exec(id);
  if (weekend) {
    const index = Number(weekend[2]);
    const content = weekendContents(catalog, weekend[1])[index];
    return {
      id,
      mode: "weekend",
      kind: content.kind,
      game: `wk.${weekend[1]}`,
      index,
      content,
      seats: seat(content, id),
    };
  }
  const post = MORNING_POST_ID.exec(id);
  if (post) {
    const index = Number(post[2]);
    const content = morningPostContents(catalog, Number(post[1]))[index];
    return {
      id,
      mode: "morning_post",
      kind: content.kind,
      game: `mp.${post[1]}`,
      index,
      content,
      seats: seat(content, id),
    };
  }
  return null;
}

/**
 * A free-play round this player has not decided, or null when none is left.
 * In the Drawing Room about one round in eight is a trap.
 */
export function pickFree(
  catalog: Catalog,
  mode: FreeMode,
  decided: ReadonlySet<string>,
  random: () => number = Math.random,
): string | null {
  const open = (contents: readonly Content[]) =>
    contents.map((content) => freeId(mode, content)).filter((id) => !decided.has(id));
  if (mode === "library") {
    const ids = open(catalog.rankings);
    return ids.length > 0 ? pick(ids, random) : null;
  }
  if (mode === "timetable") {
    const left = catalog.timetables.filter((content) => !decided.has(freeId(mode, content)));
    if (left.length === 0) return null;
    return freeId(mode, pick(timetablePool(left, random), random));
  }
  const traps = open(catalog.traps);
  const duels = open(catalog.duels);
  const wantTrap = random() < TRAP_RATE;
  const pools = wantTrap ? [traps, duels] : [duels, traps];
  const pool = pools.find((ids) => ids.length > 0);
  return pool ? pick(pool, random) : null;
}

export function isFreeMode(mode: Mode): mode is FreeMode {
  return mode in FREE_PREFIX;
}
