import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "A Weekend at Wrenfield · Poison Pen" };

export default async function WeekendPage({ searchParams }: PageProps<"/weekend">) {
  const { seed } = await searchParams;
  return (
    <ModePage mode="weekend" seed={typeof seed === "string" ? seed : null}>
      Ten rounds, three candles. Guess which AI model wrote a letter, spot the same model writing
      two letters, and call whether an answer passed its checks. A wrong answer blows a candle out;
      lose all three and the weekend ends.
    </ModePage>
  );
}
