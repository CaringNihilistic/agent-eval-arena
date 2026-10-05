"use client";

import { LetterCard } from "@/components/game/letter-card";
import { OfficialBenchmarksPanel } from "@/components/game/official-panel";
import { Panel, Title } from "@/components/theme/ornament";
import { CROWD_MIN } from "@/lib/casebook";
import { acrossRuns, rangeText } from "@/lib/format";
import { guest as guestById } from "@/lib/guests";
import { ELO_MODES } from "@/lib/leaderboard";
import {
  CONFIDENCE_LABELS,
  type Answer,
  type AuthorOption,
  type RevealedLetter,
  type RevealedRound,
} from "@/lib/types";

function usd(value: number): string {
  return value === 0 ? "$0" : `$${value.toFixed(4)}`;
}

function modelLabel(authors: readonly AuthorOption[], model: string): string {
  return authors.find((author) => author.model === model)?.label ?? model;
}

/** What the player said, in the game's words. */
export function answerText(answer: Answer, authors: readonly AuthorOption[]): string {
  switch (answer.type) {
    case "trust":
      return answer.choice === "equal"
        ? "You found them equally good."
        : answer.choice === "neither"
          ? "You trusted neither."
          : `You trusted letter ${answer.choice}.`;
    case "accuse":
      return "You accused: the same model wrote both.";
    case "ranking":
      return `You ranked them ${answer.order.join(", ")}.`;
    case "author":
      return `You named ${modelLabel(authors, answer.model)}.`;
    case "call":
      return answer.holds ? "You said it holds." : "You said it falls apart.";
  }
}

/** The verdict on the answer, where there is one. */
export function verdictText(round: RevealedRound): string {
  const { your_answer: answer, outcome, trap } = round;
  if (answer.type === "accuse") {
    if (outcome === "right") return "Quite right. One model wrote both.";
    return "A false accusation: two different models wrote these.";
  }
  if (trap) return "You were fooled: one model wrote both letters.";
  if (outcome === "right") return "Quite right.";
  if (outcome === "wrong") return "Not so.";
  return "A matter of taste: no points are given for a preference.";
}

/** What our scorer found for one letter. Pass or fail where there is a right answer; otherwise the rules met. */
function ScoreLine({ letter }: { letter: RevealedLetter }) {
  const score = letter.score;
  if (!score) return <p>Not scored.</p>;
  if (score.passed !== null) {
    return (
      <p>
        <span className="font-bold">{score.passed ? "Passed" : "Failed"}</span>
        <span className="text-muted-foreground"> · {score.explanation}</span>
      </p>
    );
  }
  const met = score.checks.filter((check) => check.passed).length;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-bold">
        Rules met {met}/{score.checks.length}
      </p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {score.checks.map((check) => (
          <li key={check.name} title={check.detail}>
            <span className="font-bold">{check.passed ? "Met" : "Not met"}: </span>
            {check.name}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Limits the task stated, checked automatically. Not a measure of quality.
      </p>
    </div>
  );
}

function Unmasking({
  letter,
  authors,
}: {
  letter: RevealedLetter;
  authors: readonly AuthorOption[];
}) {
  const totals = letter.totals;
  return (
    <section className="flex flex-col gap-2 border-y border-border py-3 text-sm not-italic">
      <p className="deco-stamp self-start">{modelLabel(authors, letter.model)}</p>
      <p>
        Written by <span className="font-bold">{letter.model}</span>, in the seat of{" "}
        {guestById(letter.guest).name}.
      </p>
      <ScoreLine letter={letter} />
      <p>
        {letter.answer_words} {letter.answer_words === 1 ? "word" : "words"} · {letter.steps}{" "}
        {letter.steps === 1 ? "step" : "steps"} · {(letter.latency_ms / 1000).toFixed(1)} s ·{" "}
        {usd(letter.reference_cost_usd)} at API rates ({usd(letter.cost_usd)} actual)
      </p>
      <p className="text-xs text-muted-foreground">
        This author over all 30 tasks, {acrossRuns(totals.takes)}: passed {rangeText(totals.passes)}{" "}
        of {totals.scored_tasks} with a right answer, met {rangeText(totals.checks_met)} of{" "}
        {totals.checks_total} rules, about {Math.round(totals.mean_answer_words)} words and{" "}
        {usd(totals.mean_reference_cost_usd)} a letter.
      </p>
    </section>
  );
}

function CrowdLine({ round }: { round: RevealedRound }) {
  const crowd = round.crowd;
  if (crowd === null) return null;
  if (crowd.votes < CROWD_MIN) return <p>You are among the first to judge this pair.</p>;
  if (crowd.same_share === null) return null;
  return <p>{Math.round(crowd.same_share * 100)}% of players trusted the same letter.</p>;
}

/** Whether this decision is one the players' ranking is built from. */
function countsTowardRanking(round: RevealedRound): boolean {
  const preference = round.your_answer.type === "trust" || round.your_answer.type === "ranking";
  return preference && !round.trap && ELO_MODES.includes(round.mode);
}

/** The reveal: shown after a decision, and only then. */
export function RevealPanel({ round }: { round: RevealedRound }) {
  const models = [...new Set(round.letters.map((letter) => letter.model))];
  const progress = round.progress;
  return (
    <section aria-label="The reveal" className="flex flex-col gap-5">
      <Panel className="flex flex-col gap-3">
        <Title as="h2" kicker="The reveal">
          {round.letters.length === 1 ? "Who wrote it" : "Who wrote them"}
        </Title>
        {round.trap ? (
          <p className="deco-stamp self-start text-lg">One model wrote both letters!</p>
        ) : null}
        <p className="text-lg">
          {answerText(round.your_answer, round.authors)} {verdictText(round)}
        </p>
        <p className="text-sm text-muted-foreground">
          You were: {CONFIDENCE_LABELS[round.confidence].toLowerCase()}.
        </p>
        <div className="flex flex-col gap-1 text-sm">
          <p className="deco-label" data-testid="points-gained">
            {round.points > 0 ? `+${round.points}` : round.points} points
            {progress ? ` · ${progress.points_total} in all · ${progress.rank}` : ""}
          </p>
          {progress?.unlocked.map((distinction) => (
            <p key={distinction.id} className="deco-stamp self-start">
              Distinction: {distinction.name}
            </p>
          ))}
          <CrowdLine round={round} />
          {countsTowardRanking(round) ? (
            <p data-testid="vote-counted">
              Your vote has been added to the players&apos; ranking of the three models.
            </p>
          ) : null}
        </div>
      </Panel>

      <div
        className={`grid gap-4 ${round.letters.length === 3 ? "lg:grid-cols-3" : round.letters.length === 2 ? "lg:grid-cols-2" : ""}`}
      >
        {round.letters.map((letter) => (
          <LetterCard
            key={letter.seat}
            seat={letter.seat}
            guest={letter.guest}
            expression={letter.expression}
            answer={letter.final_answer}
            working={{ events: letter.events, steps: letter.steps }}
            category={round.task.category}
          >
            <Unmasking letter={letter} authors={round.authors} />
          </LetterCard>
        ))}
      </div>

      <OfficialBenchmarksPanel official={round.official} models={models} />
    </section>
  );
}
