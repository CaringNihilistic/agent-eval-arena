"use client";

import { useState } from "react";

import { Reveal } from "@/components/lobby/reveal";
import { Label } from "@/components/theme/ornament";
import { Portrait } from "@/components/theme/portrait";
import { GUESTS, guest as guestById, type GuestId } from "@/lib/guests";

/**
 * The six guests at the table. Point at one, or tab to one, and they brighten
 * and say their line; click to keep them talking. This is the lobby only: in a
 * round every guest keeps a straight face until the decision is made.
 */
export function GuestRow() {
  const [hovered, setHovered] = useState<GuestId | null>(null);
  const [pinned, setPinned] = useState<GuestId | null>(null);
  const speaking = hovered ?? pinned;
  const speaker = speaking ? guestById(speaking) : null;

  return (
    <div className="flex flex-col gap-5">
      <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {GUESTS.map((guest, index) => (
          <Reveal as="li" key={guest.id} delay={index * 90}>
            <button
              type="button"
              className="lift flex w-full cursor-pointer flex-col items-center gap-2 text-center"
              aria-pressed={pinned === guest.id}
              aria-describedby="guest-line"
              onMouseEnter={() => setHovered(guest.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(guest.id)}
              onBlur={() => setHovered(null)}
              onClick={() => setPinned(pinned === guest.id ? null : guest.id)}
            >
              <Portrait
                guest={guest.id}
                size="lg"
                expression={speaking === guest.id ? "happy" : "neutral"}
              />
              <span className="deco-title text-lg">{guest.name}</span>
              <Label>{guest.role}</Label>
            </button>
          </Reveal>
        ))}
      </ul>
      <p
        id="guest-line"
        aria-live="polite"
        data-testid="guest-line"
        className="parchment min-h-24 text-center"
      >
        {speaker ? (
          <>
            <span className="letter-hand block text-lg">&ldquo;{speaker.quote}&rdquo;</span>
            <span className="deco-label mt-2 block text-muted-foreground">
              {speaker.name}, {speaker.role.toLowerCase()}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Point at a guest to hear what they have to say for themselves.
          </span>
        )}
      </p>
    </div>
  );
}
