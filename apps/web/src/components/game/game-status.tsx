"use client";

import { shareSquares } from "@/lib/scoring";
import type { GameState, Outcome } from "@/lib/types";

/** A candle, lit or blown out. Drawn in the current text colour. */
function Candle({ lit }: { lit: boolean }) {
  return (
    <svg
      viewBox="0 0 16 32"
      aria-hidden="true"
      className="h-8 w-4"
      fill="none"
      stroke="currentColor"
    >
      {lit ? (
        <path d="M8 2 q4 5 0 9 q-4 -4 0 -9 z" fill="currentColor" className="text-ornament" />
      ) : (
        <path d="M8 11 q-3 -3 0 -5 q2 -2 0 -4" strokeWidth="1" className="text-muted-foreground" />
      )}
      <path d="M8 11 v3" strokeWidth="1.5" />
      <rect x="4" y="14" width="8" height="16" strokeWidth="1.5" />
    </svg>
  );
}

function Squares({ results, total }: { results: readonly Outcome[]; total: number }) {
  const pending = "·".repeat(Math.max(0, total - results.length));
  return (
    <p
      className="font-mono text-lg tracking-widest"
      aria-label={`${results.length} of ${total} rounds played`}
    >
      {shareSquares(results)}
      <span className="text-muted-foreground">{pending}</span>
    </p>
  );
}

/** Where a seeded game stands: the round, the candles or the squares, the points. */
export function GameStatus({ game }: { game: GameState }) {
  const round = Math.min(game.next + 1, game.total);
  if (game.type === "weekend") {
    return (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-line bg-panel px-4 py-2">
        <p className="deco-label">
          {game.over ? "The weekend is over" : `Round ${round} of ${game.total}`}
        </p>
        <div
          className="flex items-end gap-1"
          role="img"
          aria-label={`${game.candles} of 3 candles lit`}
        >
          {[0, 1, 2].map((index) => (
            <Candle key={index} lit={index < game.candles} />
          ))}
        </div>
        <p className="deco-label text-muted-foreground">{game.points} points</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-line bg-panel px-4 py-2">
      <p className="deco-label">
        Morning Post No. {game.number} · {game.date}
      </p>
      <Squares results={game.results} total={game.total} />
    </div>
  );
}
