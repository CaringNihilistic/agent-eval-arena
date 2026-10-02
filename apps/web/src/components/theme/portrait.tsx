"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchArt } from "@/lib/client-api";
import { guest as guestById, type Expression, type GuestId } from "@/lib/guests";

const SIZES = { sm: "w-14", md: "w-24", lg: "w-36" } as const;

const MOODS: Record<Expression, string> = {
  neutral: "",
  happy: ", pleased",
  shocked: ", shocked",
  flustered: ", flustered",
};

/**
 * A guest's portrait in a stepped Art Deco frame. The file comes from
 * /public/guests/<id>/<expression>.png if there is one, else the built-in SVG;
 * /api/art says which exists.
 */
export function Portrait({
  guest,
  expression = "neutral",
  size = "md",
}: {
  guest: GuestId;
  expression?: Expression;
  size?: keyof typeof SIZES;
}) {
  const art = useQuery({ queryKey: ["art"], queryFn: fetchArt, staleTime: Infinity });
  const source = art.data?.[guest]?.[expression] ?? `/guests/${guest}/${expression}.svg`;
  const { name } = guestById(guest);
  return (
    <div className={`stepped shrink-0 bg-ornament p-1 ${SIZES[size]}`}>
      <div className="stepped bg-panel">
        {/* Plain img: the art is a local file that may be swapped for a PNG at any time. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source}
          alt={`${name}${MOODS[expression]}`}
          data-expression={expression}
          className="block aspect-[5/6] w-full object-cover"
        />
      </div>
    </div>
  );
}
