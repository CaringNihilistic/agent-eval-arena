"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Label, Parchment } from "@/components/theme/ornament";
import { fetchProfile } from "@/lib/client-api";

/** The player's rank and distinctions, from their own decisions. */
export function RankCard() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  if (profile.isPending) return <p role="status">Consulting the visitors&apos; book…</p>;
  if (profile.isError) return <p role="alert">{profile.error.message}</p>;
  const casebook = profile.data;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Parchment as="section" aria-label="Your rank" className="flex flex-col gap-2">
        <p className="deco-label text-muted-foreground">Your standing</p>
        <p className="deco-title text-3xl" data-testid="rank">
          {casebook.rank}
        </p>
        <p data-testid="points">{casebook.points} points</p>
        <p className="text-sm text-muted-foreground">
          {casebook.next_rank
            ? `${casebook.next_rank.at - casebook.points} more to become ${casebook.next_rank.name}.`
            : "There is no higher rank."}{" "}
          Points come only from answers that can be right or wrong.
        </p>
        <Link href="/casebook" className="deco-label underline">
          {casebook.ready
            ? "Open my Casebook"
            : `My Casebook opens after ${casebook.needed} more ${casebook.needed === 1 ? "decision" : "decisions"}`}
        </Link>
      </Parchment>
      <section aria-label="Distinctions" className="border border-line bg-panel p-5">
        <Label className="mb-3">Distinctions</Label>
        <ul className="grid gap-3 sm:grid-cols-2">
          {casebook.distinctions.map((distinction) => (
            <li key={distinction.id} className="flex flex-col gap-0.5">
              <span className={distinction.earned ? "font-bold" : "text-muted-foreground"}>
                {distinction.name}
                <span className="deco-label ml-2 text-accusation">
                  {distinction.earned ? "Earned" : ""}
                </span>
              </span>
              <span className="text-sm text-muted-foreground">{distinction.rule}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
