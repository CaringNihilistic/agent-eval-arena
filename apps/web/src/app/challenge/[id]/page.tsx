import type { Metadata } from "next";

import { ChallengeClient } from "@/components/game/challenge-client";
import { Title } from "@/components/theme/ornament";

export const metadata: Metadata = { title: "A challenge · Poison Pen" };

export default async function ChallengePage({ params }: PageProps<"/challenge/[id]">) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <Title kicker="A Weekend at Wrenfield">A challenge</Title>
      <ChallengeClient id={id} />
    </main>
  );
}
