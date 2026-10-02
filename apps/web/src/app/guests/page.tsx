import type { Metadata } from "next";

import { Label, Title } from "@/components/theme/ornament";
import { Portrait } from "@/components/theme/portrait";
import { EXPRESSIONS, GUESTS } from "@/lib/guests";

export const metadata: Metadata = { title: "The Guest List · Poison Pen" };

export default function GuestListPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <Title kicker="Wrenfield Hall">The Guest List</Title>
      <p className="max-w-3xl text-text-secondary">
        Six guests, three authors. A guest is a costume: the seat a letter was found at. Seats are
        dealt at random every round, so no guest belongs to any author. Before you decide, every
        guest keeps a straight face.
      </p>
      <ul className="flex flex-col gap-5">
        {GUESTS.map((guest) => (
          <li key={guest.id} className="parchment flex flex-col gap-4 sm:flex-row sm:items-center">
            <Portrait guest={guest.id} size="lg" />
            <div className="flex flex-1 flex-col gap-2">
              <p className="deco-label text-muted-foreground">{guest.role}</p>
              <h2 className="deco-title text-2xl">{guest.name}</h2>
              <p>{guest.description}</p>
              <blockquote className="letter-hand border-l-2 border-ornament pl-3">
                &ldquo;{guest.quote}&rdquo;
              </blockquote>
              <div className="flex flex-wrap gap-3 pt-2">
                {EXPRESSIONS.filter((expression) => expression !== "neutral").map((expression) => (
                  <figure key={expression} className="flex flex-col items-center gap-1">
                    <Portrait guest={guest.id} expression={expression} size="sm" />
                    <figcaption>
                      <Label>{expression}</Label>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
