"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { RoundTable } from "@/components/game/round-table";
import { Panel } from "@/components/theme/ornament";
import { fetchChallenge } from "@/lib/client-api";
import { shareSquares } from "@/lib/scoring";

/** A friend's challenge: play the same seeded Weekend, then compare. */
export function ChallengeClient({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const challenge = useQuery({ queryKey: ["challenge", id], queryFn: () => fetchChallenge(id) });
  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["challenge", id] }),
    [queryClient, id],
  );

  if (challenge.isPending) return <p role="status">Opening the invitation…</p>;
  if (challenge.isError) return <p role="alert">{challenge.error.message}</p>;
  const view = challenge.data;

  return (
    <div className="flex flex-col gap-6">
      {view.you_are_challenger ? (
        <Panel>
          <p>
            This is your own challenge. Send the link to a friend; when they have played, they will
            see both results.
          </p>
        </Panel>
      ) : view.challenger && view.compatibility ? (
        <Panel aria-label="The comparison" className="flex flex-col gap-3">
          <h2 className="deco-title text-2xl">The two of you, compared</h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="deco-label text-muted-foreground">You</dt>
              <dd data-testid="your-score">
                {view.you.points} points · {shareSquares(view.you.results)}
              </dd>
            </div>
            <div>
              <dt className="deco-label text-muted-foreground">Your challenger</dt>
              <dd data-testid="their-score">
                {view.challenger.points} points · {shareSquares(view.challenger.results)}
              </dd>
            </div>
            <div>
              <dt className="deco-label text-muted-foreground">Taste compatibility</dt>
              <dd data-testid="compatibility">
                {view.compatibility.percent === null
                  ? "No round in common."
                  : `${view.compatibility.percent}% (${view.compatibility.same} of ${view.compatibility.shared} rounds answered alike)`}
              </dd>
            </div>
          </dl>
        </Panel>
      ) : (
        <Panel>
          <p>
            Another player has played these ten rounds and dares you to do better. You will see both
            results when you finish.
          </p>
        </Panel>
      )}
      <RoundTable mode="weekend" seed={view.seed} onGameOver={refresh} />
    </div>
  );
}
