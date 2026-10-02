"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Markdown } from "@/components/answer-view";
import { Reveal } from "@/components/arena/reveal";
import { TracePane } from "@/components/arena/trace-pane";
import { Button } from "@/components/ui/button";
import { fetchMatch, sendVote, startMatch } from "@/lib/client-api";
import type { Choice } from "@/lib/elo";
import { CATEGORY_LABELS, type MatchResponse } from "@/lib/types";

/**
 * Before the vote every event appears at this fixed pace. The real pace is
 * hidden on purpose: speed would identify the model.
 */
export const BLIND_PACE_MS = 450;

const VOTE_BUTTONS: { choice: Choice; label: string }[] = [
  { choice: "left", label: "▲ A is better" },
  { choice: "right", label: "■ B is better" },
  { choice: "tie", label: "Tie" },
  { choice: "both_bad", label: "Both are bad" },
];

/** How many events of the longer trace are on screen. Counts up at a fixed pace. */
function usePlayback(total: number, active: boolean): [number, () => void] {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active || shown >= total) return;
    const timer = window.setTimeout(() => setShown((count) => count + 1), BLIND_PACE_MS);
    return () => window.clearTimeout(timer);
  }, [active, shown, total]);
  return [shown, () => setShown(total)];
}

function MatchBody({ match }: { match: MatchResponse }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { left, right } = match.sides;
  const total = Math.max(left.events.length, right.events.length);
  const [shown, skip] = usePlayback(total, !match.voted);
  const finished = match.voted || shown >= total;

  const vote = useMutation({
    mutationFn: (choice: Choice) => sendVote(match.match_id, choice),
    onSuccess: (revealed) => queryClient.setQueryData(["match", match.match_id], revealed),
  });
  const next = useMutation({
    mutationFn: () => startMatch(null),
    onSuccess: ({ match_id }) => router.push(`/arena/${match_id}`),
  });

  const steps = (side: "left" | "right") =>
    match.voted ? match.sides[side].metrics.steps : match.sides[side].summary.steps;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {CATEGORY_LABELS[match.task.category]} · {match.task.title}
        </p>
        <div className="mt-2">
          <Markdown text={match.task.prompt} />
        </div>
      </section>

      {match.voted ? <Reveal match={match} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {(["left", "right"] as const).map((side) => (
          <TracePane
            key={side}
            side={side}
            events={match.sides[side].events}
            shown={match.voted ? match.sides[side].events.length : shown}
            steps={steps(side)}
            category={match.task.category}
            title={match.voted ? match.sides[side].config.display_name : undefined}
          />
        ))}
      </div>

      {match.voted ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => next.mutate()} disabled={next.isPending}>
            Next match
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/leaderboard">Leaderboard</Link>
          </Button>
          {next.isError ? <p role="alert">{next.error.message}</p> : null}
        </div>
      ) : (
        <section
          aria-label="Vote"
          className="sticky bottom-0 flex flex-col gap-2 rounded-xl border bg-background p-4 shadow-sm"
        >
          <p className="text-sm">
            {finished
              ? "Which agent did better? You will see which model was which, and the scores, after you vote."
              : "Both agents are working. You can vote when they have finished."}
          </p>
          <div className="flex flex-wrap gap-2">
            {VOTE_BUTTONS.map((button) => (
              <Button
                key={button.choice}
                variant="outline"
                size="lg"
                disabled={!finished || vote.isPending}
                onClick={() => vote.mutate(button.choice)}
              >
                {button.label}
              </Button>
            ))}
            {finished ? null : (
              <Button variant="ghost" size="lg" onClick={skip}>
                Skip to the end
              </Button>
            )}
          </div>
          {vote.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {vote.error.message}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

/** One match: two traces side by side, a blind vote, then the reveal. */
export function MatchClient({ matchId }: { matchId: string }) {
  const match = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => fetchMatch(matchId),
    staleTime: Infinity,
  });
  if (match.isPending) return <p role="status">Loading the match…</p>;
  if (match.isError) {
    return (
      <div role="alert" className="flex flex-col gap-3">
        <p>{match.error.message}</p>
        <Button asChild variant="outline" className="self-start">
          <Link href="/">Back to the start</Link>
        </Button>
      </div>
    );
  }
  // Remount when the vote lands, so playback state is not carried into the reveal.
  return <MatchBody key={String(match.data.voted)} match={match.data} />;
}
