// The rooms of the Hall: each mode, where it lives, and how the lobby describes it.

import type { Mode } from "@/lib/types";

export interface Room {
  mode: Mode;
  href: string;
  blurb: string;
  note: string;
  /** The part of the Hall that leads to it in the lobby's picture. */
  place: string;
}

export const ROOMS: readonly Room[] = [
  {
    mode: "weekend",
    href: "/weekend",
    blurb:
      "Ten rounds and three candles. Name the author, spot the impostor, call the timetable. A wrong answer blows a candle out.",
    note: "The main game",
    place: "The front door",
  },
  {
    mode: "drawing_room",
    href: "/drawing-room",
    blurb:
      "Two letters on one matter. Trust one, both, or neither, or accuse them of sharing an author.",
    note: "Counts toward the Official Record",
    place: "The west window",
  },
  {
    mode: "library",
    href: "/library",
    blurb: "All three authors answer the same matter. Rank their letters first, second, third.",
    note: "Counts toward the Official Record",
    place: "The east window",
  },
  {
    mode: "timetable",
    href: "/timetable",
    blurb:
      "One letter, and the verdict withheld. Did it pass its tests or meet every rule? Say whether it holds or falls apart.",
    note: "A right or wrong answer",
    place: "The tower clock",
  },
  {
    mode: "morning_post",
    href: "/morning-post",
    blurb: "Five rounds, the same for every reader today. Share your squares.",
    note: "Daily",
    place: "The post box",
  },
];

export function room(mode: Mode): Room {
  const found = ROOMS.find((item) => item.mode === mode);
  if (!found) throw new Error(`No room for ${mode}`);
  return found;
}
