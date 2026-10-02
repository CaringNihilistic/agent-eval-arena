import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "The Morning Post · Poison Pen" };

export default function MorningPostPage() {
  return (
    <ModePage mode="morning_post">
      Five rounds, the same for every reader today. When you have finished, share your squares.
    </ModePage>
  );
}
