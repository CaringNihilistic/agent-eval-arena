"use client";

import type { TraceEvent } from "@arena/schema";
import type { ReactNode } from "react";

import { AnswerView } from "@/components/answer-view";
import { hasSomethingToShow, TraceList } from "@/components/game/trace-list";
import { Parchment } from "@/components/theme/ornament";
import { Portrait } from "@/components/theme/portrait";
import { guest as guestById, type Expression, type GuestId } from "@/lib/guests";
import type { Category, Seat } from "@/lib/types";

/**
 * One letter, as found at a guest's place: the guest, the letter's words, and,
 * folded away, how it was written. Everything here is shown before the
 * decision, so it must come only from the blind view; `children` is where the
 * reveal adds what was hidden.
 */
export function LetterCard({
  seat,
  guest,
  expression = "neutral",
  answer,
  events,
  steps,
  category,
  sealed = false,
  shown,
  children,
}: {
  seat: Seat;
  guest: GuestId;
  expression?: Expression;
  answer: string | null;
  events: readonly TraceEvent[];
  steps: number;
  category: Category;
  /** A timetable round: the letter is not shown, and the writing of it is laid open. */
  sealed?: boolean;
  /** How many trace events the replay has reached, in a sealed round. */
  shown?: number;
  children?: ReactNode;
}) {
  const sitter = guestById(guest);
  return (
    <Parchment as="article" aria-label={`Letter ${seat}`} className="flex min-w-0 flex-col gap-4">
      <header className="flex items-center gap-4">
        <Portrait guest={guest} expression={expression} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="deco-label text-muted-foreground">Letter {seat}</p>
          <h3 className="deco-title text-xl">{sitter.name}</h3>
          <p className="text-sm text-muted-foreground">{sitter.role}</p>
        </div>
      </header>

      {children}

      {sealed ? (
        <section className="flex flex-col gap-2">
          <h4 className="deco-label text-muted-foreground">How it was written</h4>
          <TraceList events={events} shown={shown} />
          <p className="deco-stamp self-start">Sealed</p>
        </section>
      ) : (
        <>
          <section className="letter-hand" aria-label={`Letter ${seat}, as written`}>
            <AnswerView answer={answer} category={category} />
          </section>
          {hasSomethingToShow(events) ? (
            <details className="text-sm">
              <summary className="deco-label cursor-pointer text-muted-foreground">
                How it was written ({steps} {steps === 1 ? "step" : "steps"})
              </summary>
              <div className="mt-3">
                <TraceList events={events} />
              </div>
            </details>
          ) : (
            <p className="deco-label text-muted-foreground">Written in one sitting</p>
          )}
        </>
      )}
    </Parchment>
  );
}
