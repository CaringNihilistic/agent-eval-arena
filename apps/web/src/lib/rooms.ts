// The rooms of the Hall that are open: each playable mode, where it lives, and
// how the lobby describes it. The first is the main game.

import type { PlayableMode } from "@/lib/types";

export interface Room {
  mode: PlayableMode;
  href: string;
  blurb: string;
  note: string;
  /** The part of the Hall that leads to it in the lobby's picture. */
  place: string;
}

export const ROOMS: readonly Room[] = [
  {
    mode: "drawing_room",
    href: "/drawing-room",
    blurb:
      "Two AI models answer the same task, with their names hidden. Say which answer is better, then see who wrote each one.",
    note: "The main game · your votes rank the models",
    place: "The front door",
  },
  {
    mode: "weekend",
    href: "/weekend",
    blurb:
      "Ten rounds for points. Guess which model wrote an answer, spot the same model twice, and call whether an answer passed its checks. Three wrong answers end it.",
    note: "A ten-round challenge",
    place: "The west window",
  },
];

export function room(mode: PlayableMode): Room {
  const found = ROOMS.find((item) => item.mode === mode);
  if (!found) throw new Error(`No room for ${mode}`);
  return found;
}
