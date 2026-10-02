import type { Metadata } from "next";

import { ModePage } from "@/components/game/mode-page";

export const metadata: Metadata = { title: "A Weekend at Wrenfield · Poison Pen" };

export default async function WeekendPage({ searchParams }: PageProps<"/weekend">) {
  const { seed } = await searchParams;
  return (
    <ModePage mode="weekend" seed={typeof seed === "string" ? seed : null}>
      Ten rounds, three candles. Name the author of a letter, spot one author in two seats, and call
      whether an answer will hold. A wrong answer blows a candle out; lose all three and the weekend
      ends.
    </ModePage>
  );
}
