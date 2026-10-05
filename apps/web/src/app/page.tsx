import Link from "next/link";
import type { CSSProperties } from "react";

import { Standing } from "@/components/game/rank-card";
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
  { figure: "3", label: "AI models" },
  { figure: "30", label: "tasks each" },
  { figure: "270", label: "recorded answers" },
];

const STEPS = [
  {
    title: "Read two answers",
    text: "Two AI models were given the same task. You see what each wrote, as an unsigned letter. Their names are hidden.",
  },
  {
    title: "Say which is better",
    text: "Trust one letter, call them equal, or trust neither. Now and then one model wrote both: accuse it if you spot that.",
  },
  {
    title: "See who wrote them",
    text: "The models are named, with how each answer scored, what it cost, and the published benchmarks. Your vote goes into the players' ranking.",
  },
];

export default function LobbyPage() {
  const [main, challenge] = ROOMS;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-14 px-4 py-10">
      <section className="grid items-center gap-8 lg:grid-cols-[5fr_6fr]">
        <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          <p className="deco-label rise text-ornament">A blind taste test of three AI models</p>
          <h1 className="deco-title rise text-5xl sm:text-6xl" style={after(120)}>
            Poison Pen
          </h1>
          <div className="rise" style={after(240)}>
            <Ornament />
          </div>
          <p className="rise max-w-xl text-lg text-pretty" style={after(360)}>
            Claude Haiku 4.5, Sonnet 5.5, and Opus 5.5 were each given the same 30 tasks. You are
            shown two of their answers with the names removed. Say which is better, then find out
            who wrote each one.
          </p>
          <p className="rise max-w-xl text-pretty text-text-secondary" style={after(420)}>
            The setting is a 1930s country house: every answer is an unsigned letter found beside a
            dinner guest. The guests are costumes, dealt at random.
          </p>
          <div
            className="rise flex flex-wrap items-center justify-center gap-x-5 gap-y-3 lg:justify-start"
            style={after(480)}
          >
            <Link
              href={main.href}
              className="deco-label lift border border-primary bg-primary px-8 py-4 text-primary-foreground hover:bg-sage-hover"
            >
              Play now
            </Link>
            <Link href={challenge.href} className="deco-label underline underline-offset-4">
              Or try the ten-round challenge
            </Link>
          </div>
          <dl
            className="rise grid w-full max-w-xl grid-cols-3 gap-3 border-t border-line pt-4"
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

      <section aria-labelledby="how" className="flex flex-col gap-5">
        <Reveal>
          <Title as="h2">
            <span id="how">How it works</span>
          </Title>
        </Reveal>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <Reveal as="li" key={step.title} delay={index * 90} className="flex">
              <div className="parchment flex w-full flex-col gap-2">
                <p className="deco-label text-muted-foreground">Step {index + 1}</p>
                <h3 className="deco-title text-2xl">{step.title}</h3>
                <p className="text-sm">{step.text}</p>
              </div>
            </Reveal>
          ))}
        </ol>
        <Reveal delay={300}>
          <p className="max-w-3xl text-text-secondary">
            Nothing is written while you play: every letter was recorded in advance, and the server
            keeps the author back until you decide.{" "}
            <Link href="/record" className="underline">
              See the results so far
            </Link>{" "}
            or read{" "}
            <Link href="/about" className="underline">
              how it is kept fair
            </Link>
            .
          </p>
        </Reveal>
      </section>

      <section aria-labelledby="modes" className="flex flex-col gap-5">
        <Reveal>
          <Title as="h2">
            <span id="modes">Two ways to play</span>
          </Title>
        </Reveal>
        <ul className="grid gap-4 md:grid-cols-2">
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

      <Standing />

      <section aria-labelledby="guests" className="flex flex-col gap-5">
        <Reveal>
          <Title as="h2">
            <span id="guests">At the table</span>
          </Title>
        </Reveal>
        <Reveal delay={120}>
          <p className="max-w-3xl text-text-secondary">
            A guest is only the seat a letter was found at. Seats are dealt at random each round and
            tell you nothing about which model wrote the letter.
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
