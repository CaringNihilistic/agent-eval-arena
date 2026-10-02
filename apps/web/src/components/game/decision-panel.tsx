"use client";

import { useState } from "react";

import { Panel } from "@/components/theme/ornament";
import { Button } from "@/components/ui/button";
import {
  CONFIDENCE_LABELS,
  CONFIDENCES,
  type Answer,
  type AuthorOption,
  type Confidence,
  type RoundKind,
  type Seat,
} from "@/lib/types";

export const ACCUSE_LABEL = "Accuse: one author, two seats";

const QUESTIONS: Record<RoundKind, string> = {
  duel: "Which letter do you trust?",
  ranking: "Rank the three letters, the one you trust most first.",
  author: "Who wrote this letter?",
  timetable: "Does the timetable hold?",
};

function same(a: Answer | null, b: Answer): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

function Choice({
  answer,
  chosen,
  onChoose,
  label,
  variant = "outline",
}: {
  answer: Answer;
  chosen: Answer | null;
  onChoose: (answer: Answer) => void;
  label: string;
  variant?: "outline" | "accuse";
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      aria-pressed={same(chosen, answer)}
      onClick={() => onChoose(answer)}
    >
      {label}
    </Button>
  );
}

/** Ranking: tap the letters in order of trust. */
function RankingPicker({
  seats,
  onChoose,
}: {
  seats: readonly Seat[];
  onChoose: (answer: Answer | null) => void;
}) {
  const [order, setOrder] = useState<Seat[]>([]);
  const places = ["First", "Second", "Third"];
  const active = order;
  const add = (seat: Seat) => {
    const next = [...active, seat];
    setOrder(next);
    onChoose(next.length === seats.length ? { type: "ranking", order: next } : null);
  };
  const clear = () => {
    setOrder([]);
    onChoose(null);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {seats.map((seat) => {
          const place = active.indexOf(seat);
          return (
            <Button
              key={seat}
              type="button"
              variant="outline"
              size="lg"
              disabled={place >= 0}
              aria-pressed={place >= 0}
              onClick={() => add(seat)}
            >
              Letter {seat}
              {place >= 0 ? ` · ${places[place]}` : ""}
            </Button>
          );
        })}
        {active.length > 0 ? (
          <Button type="button" variant="ghost" size="lg" onClick={clear}>
            Start again
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {active.length === seats.length
          ? `Your order: ${active.join(", ")}.`
          : `Choose the letter you trust ${places[active.length].toLowerCase()}.`}
      </p>
    </div>
  );
}

/**
 * The decision for a round: the answer buttons for its kind, how sure the
 * player is, and the button that seals it. Nothing is sent until both are chosen.
 */
export function DecisionPanel({
  kind,
  seats,
  authors,
  question,
  pending,
  error,
  onSubmit,
}: {
  kind: RoundKind;
  seats: readonly Seat[];
  authors: readonly AuthorOption[];
  /** Replaces the usual question, for a timetable round. */
  question?: string;
  pending: boolean;
  error: string | null;
  onSubmit: (answer: Answer, confidence: Confidence) => void;
}) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  // An accusation needs two seats one author could hold. A ranking always has all three authors.
  const canAccuse = kind === "duel";

  return (
    <Panel aria-label="Your verdict" className="flex flex-col gap-4">
      <h3 className="deco-title text-xl">{question ?? QUESTIONS[kind]}</h3>

      <fieldset disabled={pending} className="flex flex-col gap-3">
        <legend className="sr-only">Your answer</legend>
        {kind === "duel" ? (
          <div className="flex flex-wrap gap-2">
            <Choice
              answer={{ type: "trust", choice: "A" }}
              chosen={answer}
              onChoose={setAnswer}
              label="Trust letter A"
            />
            <Choice
              answer={{ type: "trust", choice: "equal" }}
              chosen={answer}
              onChoose={setAnswer}
              label="Equally good"
            />
            <Choice
              answer={{ type: "trust", choice: "neither" }}
              chosen={answer}
              onChoose={setAnswer}
              label="Neither"
            />
            <Choice
              answer={{ type: "trust", choice: "B" }}
              chosen={answer}
              onChoose={setAnswer}
              label="Trust letter B"
            />
          </div>
        ) : null}
        {kind === "ranking" ? <RankingPicker seats={seats} onChoose={setAnswer} /> : null}
        {kind === "author" ? (
          <div className="flex flex-wrap gap-2">
            {authors.map((author) => (
              <Choice
                key={author.model}
                answer={{ type: "author", model: author.model }}
                chosen={answer}
                onChoose={setAnswer}
                label={author.label}
              />
            ))}
          </div>
        ) : null}
        {kind === "timetable" ? (
          <div className="flex flex-wrap gap-2">
            <Choice
              answer={{ type: "call", holds: true }}
              chosen={answer}
              onChoose={setAnswer}
              label="It holds"
            />
            <Choice
              answer={{ type: "call", holds: false }}
              chosen={answer}
              onChoose={setAnswer}
              label="It falls apart"
            />
          </div>
        ) : null}
        {canAccuse ? (
          <div>
            <Choice
              answer={{ type: "accuse" }}
              chosen={answer}
              onChoose={setAnswer}
              label={ACCUSE_LABEL}
              variant="accuse"
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="deco-label mb-2 text-muted-foreground">How sure are you?</legend>
        <div className="flex flex-wrap gap-2">
          {CONFIDENCES.map((level) => (
            <Button
              key={level}
              type="button"
              variant="outline"
              aria-pressed={confidence === level}
              onClick={() => setConfidence(level)}
            >
              {CONFIDENCE_LABELS[level]}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          disabled={pending || answer === null || confidence === null}
          onClick={() => answer && confidence && onSubmit(answer, confidence)}
        >
          {pending ? "Sealing…" : "Give your verdict"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
