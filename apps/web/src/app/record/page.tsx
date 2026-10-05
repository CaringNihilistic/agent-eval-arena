import type { Metadata } from "next";

import { RecordClient } from "@/components/game/record-client";
import { Title } from "@/components/theme/ornament";

export const metadata: Metadata = { title: "The Official Record · Poison Pen" };

export default function RecordPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <Title kicker="The results">The Official Record</Title>
      <p className="max-w-3xl text-text-secondary">
        How the three models compare: by players&apos; blind votes, by Anthropic&apos;s published
        benchmarks, and by this site&apos;s automatic scorer.
      </p>
      <RecordClient />
    </main>
  );
}
