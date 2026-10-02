import type { Metadata } from "next";

import { LeaderboardClient } from "@/components/leaderboard/leaderboard-client";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Leaderboard · Agent Eval Arena" };

export default function LeaderboardPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        <LeaderboardClient />
      </main>
    </>
  );
}
