import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "Does the Timetable Hold? · Poison Pen" };

export default function TimetablePage() {
  return (
    <ModePage mode="timetable">
      One letter, and how it was written. The verdict is withheld: did the answer pass its hidden
      tests, or meet every rule the task set? Say whether it holds or falls apart. Forty points for
      calling it right.
    </ModePage>
  );
}
