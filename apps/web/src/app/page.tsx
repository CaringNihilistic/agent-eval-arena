import Link from "next/link";

import { RankCard } from "@/components/game/rank-card";
import { Label, Ornament, Title } from "@/components/theme/ornament";
import { Portrait } from "@/components/theme/portrait";
import { GUESTS } from "@/lib/guests";
import { MODE_NAMES, type Mode } from "@/lib/types";

const MODES: { mode: Mode; href: string; blurb: string; note: string }[] = [
  {
    mode: "weekend",
    href: "/weekend",
    blurb:
      "Ten rounds and three candles. Name the author, spot the impostor, call the timetable. A wrong answer blows a candle out.",
    note: "The main game",
  },
  {
    mode: "drawing_room",
    href: "/drawing-room",
    blurb:
      "Two letters on one matter. Trust one, both, or neither, or accuse them of sharing an author.",
    note: "Counts toward the Official Record",
  },
  {
    mode: "library",
    href: "/library",
    blurb: "All three authors answer the same matter. Rank their letters first, second, third.",
    note: "Counts toward the Official Record",
  },
  {
    mode: "timetable",
    href: "/timetable",
    blurb:
      "Watch a letter being written, up to the moment it is sealed. Will it hold up, or fall apart?",
    note: "A right or wrong answer",
  },
  {
    mode: "morning_post",
    href: "/morning-post",
    blurb: "Five rounds, the same for every reader today. Share your squares.",
    note: "Daily",
  },
];

export default function LobbyPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-12 px-4 py-10">
      <section className="flex flex-col items-center gap-5 text-center">
        <Title centered kicker="Wrenfield Hall, 1934">
          Poison Pen
        </Title>
        <p className="max-w-2xl text-lg text-pretty text-text-secondary">
          Every evening an unsigned letter appears at dinner. Six guests sit at the table, but only
          three hands wrote the letters. Decide which to trust, and unmask the author.
        </p>
        <Link
          href="/weekend"
          className="deco-label border border-primary bg-primary px-6 py-3 text-primary-foreground hover:bg-sage-hover"
        >
          Begin a weekend
        </Link>
      </section>

      <section aria-labelledby="modes" className="flex flex-col gap-5">
        <Title as="h2">
          <span id="modes">The rooms of the Hall</span>
        </Title>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {MODES.map((item) => (
            <li key={item.mode} className="parchment flex flex-col gap-2">
              <p className="deco-label text-muted-foreground">{item.note}</p>
              <h3 className="deco-title text-2xl">
                <Link href={item.href} className="underline-offset-4 hover:underline">
                  {MODE_NAMES[item.mode]}
                </Link>
              </h3>
              <p className="text-sm">{item.blurb}</p>
              <Link href={item.href} className="deco-label mt-auto pt-2 underline">
                Enter
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="standing" className="flex flex-col gap-5">
        <Title as="h2">
          <span id="standing">Your standing</span>
        </Title>
        <RankCard />
      </section>

      <section aria-labelledby="guests" className="flex flex-col gap-5">
        <Title as="h2">
          <span id="guests">At the table</span>
        </Title>
        <p className="max-w-3xl text-text-secondary">
          A guest is only the seat a letter was found at. Seats are dealt at random each round and
          tell you nothing about who wrote the letter.
        </p>
        <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          {GUESTS.map((guest) => (
            <li key={guest.id} className="flex flex-col items-center gap-2 text-center">
              <Portrait guest={guest.id} size="lg" />
              <p className="deco-title text-lg">{guest.name}</p>
              <Label>{guest.role}</Label>
            </li>
          ))}
        </ul>
        <div className="flex justify-center">
          <Ornament />
        </div>
        <Link href="/guests" className="deco-label self-center underline">
          The Guest List
        </Link>
      </section>
    </main>
  );
}
