import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "The Library Gathering · Poison Pen" };

export default function LibraryPage() {
  return (
    <ModePage mode="library">
      All three authors answer the same matter. Rank their letters: the one you trust most first.
      Your ranking goes on the Official Record as three comparisons.
    </ModePage>
  );
}
