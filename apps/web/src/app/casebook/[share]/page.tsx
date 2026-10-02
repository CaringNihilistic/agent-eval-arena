import type { Metadata } from "next";

import { SharedCasebook } from "@/components/game/casebook-card";
import { Title } from "@/components/theme/ornament";

export const metadata: Metadata = { title: "A sleuth's Casebook · Poison Pen" };

export default async function SharedCasebookPage({ params }: PageProps<"/casebook/[share]">) {
  const { share } = await params;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <Title kicker="Shared with you">A sleuth&apos;s Casebook</Title>
      <SharedCasebook shareId={share} />
    </main>
  );
}
