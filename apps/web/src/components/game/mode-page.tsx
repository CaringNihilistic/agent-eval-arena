import type { ReactNode } from "react";

import { RoundTable } from "@/components/game/round-table";
import { Title } from "@/components/theme/ornament";
import { MODE_NAMES, type Mode } from "@/lib/types";

/** The page of one mode: its name, how it is played, and its table. */
export function ModePage({
  mode,
  seed,
  children,
}: {
  mode: Mode;
  seed?: string | null;
  /** How the mode is played, in a sentence or two. */
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <Title>{MODE_NAMES[mode]}</Title>
      <p className="max-w-3xl text-text-secondary">{children}</p>
      <RoundTable mode={mode} seed={seed} />
    </main>
  );
}
