import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "Does the Timetable Hold? · Poison Pen" };

export default function TimetablePage() {
  return (
    <ModePage mode="timetable">
      You watch one letter being written, and the account stops just before it is sealed. Will the
      finished answer hold up, or fall apart? Forty points for calling it right.
    </ModePage>
  );
}
