import Link from "next/link";
import type { CSSProperties } from "react";

import { RankCard } from "@/components/game/rank-card";
import { GuestRow } from "@/components/lobby/guest-row";
import { HallScene } from "@/components/lobby/hall-scene";
import { Reveal } from "@/components/lobby/reveal";
import { Ornament, Title } from "@/components/theme/ornament";
import { ROOMS } from "@/lib/rooms";
import { MODE_NAMES } from "@/lib/types";

/** A stagger delay for the `rise` animation. */
function after(ms: number): CSSProperties {
  return { "--delay": `${ms}ms` } as CSSProperties;
}

const FACTS = [
  { figure: "3", label: "authors" },
  { figure: "6", label: "guests" },
  { figure: "30", label: "matters" },
  { figure: "270", label: "letters" },
];

export default function LobbyPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-14 px-4 py-10">
      <section className="grid items-center gap-8 lg:grid-cols-[5fr_6fr]">
        <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          <p className="deco-label rise text-ornament">Wrenfield Hall, 1934</p>
          <h1 className="deco-title rise text-5xl sm:text-6xl" style={after(120)}>
            Poison Pen
          </h1>
          <div className="rise" style={after(240)}>
            <Ornament />
          </div>
          <p className="rise max-w-xl text-lg text-pretty text-text-secondary" style={after(360)}>
            Every evening an unsigned letter appears at dinner. Six guests sit at the table, but
            only three hands wrote the letters. Decide which to trust, and unmask the author.
          </p>
          <div
            className="rise flex flex-wrap justify-center gap-3 lg:justify-start"
            style={after(480)}
          >
            <Link
              href="/weekend"
              className="deco-label lift border border-primary bg-primary px-6 py-3 text-primary-foreground hover:bg-sage-hover"
            >
              Begin a weekend
            </Link>
            <Link
              href="/morning-post"
              className="deco-label lift border border-ornament px-6 py-3 hover:bg-panel"
            >
              Today&apos;s Morning Post
            </Link>
          </div>
          <dl
            className="rise grid w-full max-w-xl grid-cols-4 gap-3 border-t border-line pt-4"
            style={after(600)}
          >
            {FACTS.map((fact) => (
              <div key={fact.label} className="flex flex-col items-center lg:items-start">
                <dt className="deco-label order-2 text-muted-foreground">{fact.label}</dt>
                <dd className="deco-title order-1 text-3xl">{fact.figure}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rise" style={after(300)}>
          <HallScene />
        </div>
      </section>

      <section aria-labelledby="modes" className="flex flex-col gap-5">
        <Reveal>
          <Title as="h2">
            <span id="modes">The rooms of the Hall</span>
          </Title>
        </Reveal>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ROOMS.map((item, index) => (
            <Reveal as="li" key={item.mode} delay={index * 90} className="flex">
              <div className="parchment lift flex w-full flex-col gap-2">
                <p className="deco-label text-muted-foreground">{item.note}</p>
                <h3 className="deco-title text-2xl">
                  <Link href={item.href} className="underline-offset-4 hover:underline">
                    {MODE_NAMES[item.mode]}
                  </Link>
                </h3>
                <p className="text-sm">{item.blurb}</p>
                <p className="deco-label mt-auto flex items-center justify-between gap-3 pt-2">
                  <Link href={item.href} className="underline">
                    Enter
                  </Link>
                  <span className="text-muted-foreground">{item.place}</span>
                </p>
              </div>
            </Reveal>
          ))}
        </ul>
      </section>

      <section aria-labelledby="standing" className="flex flex-col gap-5">
        <Reveal>
          <Title as="h2">
            <span id="standing">Your standing</span>
          </Title>
        </Reveal>
        <Reveal delay={120}>
          <RankCard />
        </Reveal>
      </section>

      <section aria-labelledby="guests" className="flex flex-col gap-5">
        <Reveal>
          <Title as="h2">
            <span id="guests">At the table</span>
          </Title>
        </Reveal>
        <Reveal delay={120}>
          <p className="max-w-3xl text-text-secondary">
            A guest is only the seat a letter was found at. Seats are dealt at random each round and
            tell you nothing about who wrote the letter.
          </p>
        </Reveal>
        <GuestRow />
        <div className="flex justify-center">
          <Ornament />
        </div>
        <Link href="/guests" className="deco-label self-center underline">
          The Guest List
        </Link>
      </section>
    </main>
  );
}
