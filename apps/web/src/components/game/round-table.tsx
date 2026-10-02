"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { CopyButton } from "@/components/game/copy-button";
import { DecisionPanel } from "@/components/game/decision-panel";
import { GameStatus } from "@/components/game/game-status";
import { LetterCard } from "@/components/game/letter-card";
import { RevealPanel } from "@/components/game/reveal-panel";
import { Label, Panel } from "@/components/theme/ornament";
import { Button } from "@/components/ui/button";
import { createChallenge, fetchNextRound, sendDecision } from "@/lib/client-api";
import { shareSquares } from "@/lib/scoring";
import {
  CATEGORY_LABELS,
  MODE_NAMES,
  type Answer,
  type BlindRound,
  type Confidence,
  type GameState,
  type Mode,
  type RevealedRound,
  type Seat,
} from "@/lib/types";

/**
 * A paused run is replayed at this fixed pace. The real pace is hidden on
 * purpose: speed would identify the author.
 */
export const REPLAY_PACE_MS = 450;

/** How many trace events are on screen. Counts up at a fixed pace. */
function usePlayback(total: number, active: boolean): [number, () => void] {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active || shown >= total) return;
    const timer = window.setTimeout(() => setShown((count) => count + 1), REPLAY_PACE_MS);
    return () => window.clearTimeout(timer);
  }, [active, shown, total]);
  return [active ? shown : total, () => setShown(total)];
}

function TaskCard({ round }: { round: BlindRound | RevealedRound }) {
  return (
    <Panel className="flex flex-col gap-2">
      <Label>
        The matter at hand · {CATEGORY_LABELS[round.task.category]} · {round.task.title}
      </Label>
      {/* Shown as written: prompts carry code and lists whose line breaks and indentation matter. */}
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{round.task.prompt.trim()}</p>
    </Panel>
  );
}

function timetableQuestion(round: BlindRound): string {
  const openEnded = !["code", "agent"].includes(round.task.category);
  return openEnded
    ? "Does the timetable hold? Will the letter meet all the rules it was given?"
    : "Does the timetable hold? Will the answer pass the hidden tests?";
}

/** A round awaiting the player's decision. */
function BlindTable({
  round,
  pending,
  error,
  onSubmit,
}: {
  round: BlindRound;
  pending: boolean;
  error: string | null;
  onSubmit: (answer: Answer, confidence: Confidence) => void;
}) {
  const sealed = round.kind === "timetable";
  const [shown, skip] = usePlayback(round.letters[0].events.length, sealed);
  const replaying = sealed && shown < round.letters[0].events.length;
  const [tab, setTab] = useState<Seat>("A");
  const many = round.letters.length === 3;
  const columns = many ? "lg:grid-cols-3" : round.letters.length === 2 ? "lg:grid-cols-2" : "";

  return (
    <>
      {many ? (
        <div role="tablist" aria-label="Letters" className="flex gap-2 lg:hidden">
          {round.letters.map((letter) => (
            <Button
              key={letter.seat}
              role="tab"
              variant="outline"
              aria-selected={tab === letter.seat}
              onClick={() => setTab(letter.seat)}
            >
              Letter {letter.seat}
            </Button>
          ))}
        </div>
      ) : null}
      <div className={`grid gap-4 ${columns}`}>
        {round.letters.map((letter) => (
          <div key={letter.seat} className={many && tab !== letter.seat ? "hidden lg:block" : ""}>
            <LetterCard
              seat={letter.seat}
              guest={letter.guest}
              answer={letter.final_answer}
              events={letter.events}
              steps={letter.steps}
              category={round.task.category}
              sealed={sealed}
              shown={shown}
            />
          </div>
        ))}
      </div>
      {replaying ? (
        <Button variant="ghost" className="self-start" onClick={skip}>
          Skip to the end
        </Button>
      ) : null}
      <DecisionPanel
        kind={round.kind}
        seats={round.letters.map((letter) => letter.seat)}
        authors={round.authors}
        question={sealed ? timetableQuestion(round) : undefined}
        disabled={replaying}
        pending={pending}
        error={error}
        onSubmit={onSubmit}
      />
    </>
  );
}

function Challenge({ seed }: { seed: string }) {
  const challenge = useMutation({ mutationFn: () => createChallenge(seed) });
  if (challenge.data) {
    const link = `${window.location.origin}/challenge/${challenge.data.id}`;
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          Send this link. Your friend gets the same ten rounds, then you both see how you compare.
        </p>
        <p className="font-mono text-sm break-all" data-testid="challenge-link">
          {link}
        </p>
        <CopyButton text={link} label="Copy the link" />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => challenge.mutate()} disabled={challenge.isPending}>
        Challenge a friend
      </Button>
      {challenge.isError ? <p role="alert">{challenge.error.message}</p> : null}
    </div>
  );
}

/** Shown when a mode has no round to deal: the game is over, or the room is exhausted. */
function NothingToDeal({ mode, game }: { mode: Mode; game: GameState | null }) {
  if (game?.type === "weekend") {
    return (
      <Panel className="flex flex-col gap-4">
        <h2 className="deco-title text-2xl">
          {game.survived ? "You survived the weekend." : "The last candle is out."}
        </h2>
        <p>
          {game.results.length} of {game.total} rounds played, {game.candles} of 3 candles still
          lit, {game.points} points.
        </p>
        <p className="font-mono text-lg tracking-widest">{shareSquares(game.results)}</p>
        <Challenge seed={game.seed} />
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href="/weekend">Another weekend</a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/casebook">My Casebook</Link>
          </Button>
        </div>
      </Panel>
    );
  }
  if (game?.type === "morning_post") {
    return (
      <Panel className="flex flex-col gap-4">
        <h2 className="deco-title text-2xl">You have read today&apos;s Morning Post.</h2>
        <p className="font-mono text-lg" data-testid="share-text">
          {game.share_text}
        </p>
        <CopyButton text={game.share_text ?? ""} label="Copy the result" />
        <p className="text-sm text-muted-foreground">
          A filled square is a round you did not get wrong. A new edition arrives at midnight, UTC.
        </p>
        <Button asChild variant="outline" className="self-start">
          <Link href="/">Back to the Hall</Link>
        </Button>
      </Panel>
    );
  }
  return (
    <Panel className="flex flex-col gap-4">
      <h2 className="deco-title text-2xl">Nothing is left on the table.</h2>
      <p>You have judged everything {MODE_NAMES[mode]} has to offer.</p>
      <Button asChild variant="outline" className="self-start">
        <Link href="/">Back to the Hall</Link>
      </Button>
    </Panel>
  );
}

/**
 * One mode's table: deal a round, take the decision, show the reveal, deal the
 * next. A Weekend keeps its seed in the address, so reloading resumes it.
 */
export function RoundTable({
  mode,
  seed = null,
  onGameOver,
}: {
  mode: Mode;
  /** A Weekend seed to resume or to take up as a challenge. */
  seed?: string | null;
  /** Called when a seeded game has no round left. */
  onGameOver?: () => void;
}) {
  const queryClient = useQueryClient();
  const [turn, setTurn] = useState(0);
  const [revealed, setRevealed] = useState<RevealedRound | null>(null);
  const seedRef = useRef(seed);

  const next = useQuery({
    queryKey: ["next", mode, seed, turn],
    queryFn: async () => {
      const dealt = await fetchNextRound(mode, seedRef.current);
      if (dealt.game?.type === "weekend" && seedRef.current === null) {
        seedRef.current = dealt.game.seed;
        if (window.location.pathname === "/weekend") {
          window.history.replaceState(null, "", `/weekend?seed=${dealt.game.seed}`);
        }
      }
      return dealt;
    },
    staleTime: Infinity,
    gcTime: 0,
  });

  const decision = useMutation({
    mutationFn: ({ answer, confidence }: { answer: Answer; confidence: Confidence }) => {
      const roundId = next.data?.round?.round_id;
      if (!roundId) throw new Error("There is no round to decide.");
      return sendDecision(roundId, answer, confidence);
    },
    onSuccess: (round) => {
      setRevealed(round);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const over = next.data?.round === null;
  useEffect(() => {
    if (over) onGameOver?.();
  }, [over, onGameOver]);

  if (next.isPending) return <p role="status">Laying the table…</p>;
  if (next.isError) {
    return (
      <Panel role="alert" className="flex flex-col gap-3">
        <p>{next.error.message}</p>
        <Button variant="outline" className="self-start" onClick={() => next.refetch()}>
          Try again
        </Button>
      </Panel>
    );
  }

  const round = next.data.round;
  if (round === null) return <NothingToDeal mode={mode} game={next.data.game} />;
  const game = revealed?.game ?? next.data.game;
  const lastOfGame = revealed !== null && revealed.game !== null && revealed.game.over;

  return (
    <div className="flex flex-col gap-5">
      {game ? <GameStatus game={game} /> : null}
      <TaskCard round={round} />
      {revealed ? (
        <>
          <RevealPanel round={revealed} />
          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              onClick={() => {
                setRevealed(null);
                decision.reset();
                setTurn((count) => count + 1);
                window.scrollTo({ top: 0 });
              }}
            >
              {lastOfGame ? "See how it ended" : "The next letter"}
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/">Back to the Hall</Link>
            </Button>
          </div>
        </>
      ) : (
        <BlindTable
          key={round.round_id}
          round={round}
          pending={decision.isPending}
          error={decision.isError ? decision.error.message : null}
          onSubmit={(answer, confidence) => decision.mutate({ answer, confidence })}
        />
      )}
    </div>
  );
}
