import type { Metadata } from "next";

import { MyCasebook } from "@/components/game/casebook-card";
import { Title } from "@/components/theme/ornament";

export const metadata: Metadata = { title: "My Casebook · Poison Pen" };

export default function CasebookPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <Title>My Casebook</Title>
      <MyCasebook />
    </main>
  );
}
