"use client";

import type { TraceEvent } from "@arena/schema";
import type { ReactNode } from "react";

import { AnswerView } from "@/components/answer-view";
import { hasSomethingToShow, TraceList } from "@/components/game/trace-list";
import { Parchment } from "@/components/theme/ornament";
import { Portrait } from "@/components/theme/portrait";
import { guest as guestById, type Expression, type GuestId } from "@/lib/guests";
import type { Category, Seat } from "@/lib/types";

/** How a letter was written. Known only after the decision. */
export interface Working {
  events: readonly TraceEvent[];
  steps: number;
}

/**
 * One letter, as found at a guest's place: the guest and the letter's words.
 * Before the decision that is all there is, because the number of steps and
 * tool calls gives the model away. The reveal adds, folded away, how it was
 * written (`working`), and what was hidden (`children`).
 */
export function LetterCard({
  seat,
  guest,
  expression = "neutral",
  answer,
  working = null,
  category,
  children,
}: {
  seat: Seat;
  guest: GuestId;
  expression?: Expression;
  answer: string | null;
  working?: Working | null;
  category: Category;
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

      <section className="letter-hand" aria-label={`Letter ${seat}, as written`}>
        <AnswerView answer={answer} category={category} />
      </section>
      {working === null ? null : hasSomethingToShow(working.events) ? (
        <details className="text-sm">
          <summary className="deco-label cursor-pointer text-muted-foreground">
            How it was written ({working.steps} {working.steps === 1 ? "step" : "steps"})
          </summary>
          <div className="mt-3">
            <TraceList events={working.events} />
          </div>
        </details>
      ) : (
        <p className="deco-label text-muted-foreground">Written in one sitting</p>
      )}
    </Parchment>
  );
}
