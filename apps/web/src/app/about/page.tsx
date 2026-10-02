import type { Metadata } from "next";

import { Title } from "@/components/theme/ornament";

export const metadata: Metadata = { title: "About · Poison Pen" };

const SECTIONS: { title: string; points: string[] }[] = [
  {
    title: "What this is",
    points: [
      "A game laid over an evaluation of three AI models: Claude Haiku 4.5, Sonnet 5.5, and Opus 5.5. The setting is inspired by golden-age detective fiction.",
      "Each model was given the same 30 tasks three times, with the same prompt, the same four tools, and the same limits. Only the model differs. That is 270 recorded runs.",
      "Every letter is one of those recorded answers. Nothing is written while you play.",
      "The tasks are of six kinds: writing, diagrams, explanations, tech-stack recommendations, code, and agent tasks that need tools.",
    ],
  },
  {
    title: "Guests are costumes",
    points: [
      "The six guests are seats, not authors. Which guest a letter is found beside is dealt at random every round, and the part of the program that deals seats is never told which model wrote the letter.",
      "Which letter is shown first is dealt at random too.",
      "Once there are enough votes, the Official Record reports whether any guest's letters are trusted more than chance would explain, and whether the first letter shown is.",
    ],
  },
  {
    title: "What you see before you decide",
    points: [
      "What each author did (the tools it used and what came back), what it said, and its letter.",
      "Not shown until you decide: which model wrote which letter, pass or fail, scores, word counts, tokens, cost, the models' thinking, all timing, and the guests' reactions. Haiku does not think and the models differ in speed, so either would give the author away. Replays run at one fixed pace for the same reason.",
      "The server withholds these; they are not merely hidden by the page.",
      "What is still not blind: writing style can hint at the author, and the recordings are in a public repository.",
    ],
  },
  {
    title: "Points",
    points: [
      "Points come only from answers that can be right or wrong: naming the author (100), calling the timetable (40), and accusing one author of holding two seats (50 if right, 30 lost if wrong).",
      "A preference earns no points, and nothing is ever awarded for agreeing with other players. After you decide you are told what share of players trusted the same letter, once at least five have voted. That is information, not a score.",
      "How sure you said you were is recorded and does not change your points. Your Casebook shows how often you were right at each level.",
    ],
  },
  {
    title: "Impostors",
    points: [
      "About one Drawing Room round in eight, and some later rounds of a Weekend, show the same model in both seats: two of its three runs on the same task. Any preference between them is chance, taste for a costume, or a real difference between two runs of one model.",
      "These rounds never count toward the Official Record's ranking.",
      "In The Library Gathering all three authors are always present, so there is nothing to accuse and no button for it.",
    ],
  },
  {
    title: "Does the timetable hold?",
    points: [
      "You see one letter and how it was written, and the scorer's verdict is withheld. For code and agent tasks, “it holds” means the answer passed hidden tests or matched the one right answer. For the other tasks it means the letter met every rule the task stated.",
      "Far more letters hold than fall apart, so rounds are dealt by outcome: about half the time you are shown one that held and half the time one that did not. Guessing “it holds” every time is right only about half the time.",
    ],
  },
  {
    title: "How letters are scored",
    points: [
      "Code tasks run hidden tests. Agent tasks have one right answer. Both are pass or fail.",
      "Writing, diagram, explanation, and tech-stack tasks have no right answer. They get automatic checks of the limits the task stated: the length limit, required sections, constraints that had to be mentioned, a diagram that parses. This is shown as “rules met X/Y”. It is not a measure of quality; quality on these tasks is the players' vote.",
      "The checks are crude. “Mentions the budget” is a text match, and a diagram is checked for parsing, not for how it looks.",
      "No AI judge is used anywhere.",
    ],
  },
  {
    title: "The Official Record",
    points: [
      "Players: Elo with K=32, starting at 1000, replayed in order, with a 95% bootstrap interval. It uses only preferences from The Drawing Room and The Library Gathering. A ranking of three letters counts as three comparisons.",
      "Official benchmarks: Anthropic's published scores, copied from its announcement pages with the source and the date checked. Two models are compared only on benchmarks reported for both. Anthropic reports no benchmark that Haiku 4.5 shares with the two newer models, so Haiku has no official rank here.",
      "Our scorer: a pass counts 1, a fail 0, and an open-ended letter the share of its rules met, averaged over all three runs of the 30 tasks. Totals are shown with the lowest and highest run.",
      "The official benchmarks measure different tasks from ours, at higher effort settings. They are shown for comparison, not as a target.",
    ],
  },
  {
    title: "Limits of this data",
    points: [
      "Three runs per model per task. Model output varies from run to run, and the Official Record shows by how much: the same model on the same task does not always get the same score.",
      "Pass rates rest on ten tasks per model, each run three times. Repeats of a task are not independent, so the intervals shown are narrower than they should be.",
      "The models ran through Claude Code's agent loop on a subscription, capped at 1,024 output tokens per call, with thinking off for Haiku 4.5 and at the lowest effort for the other two. Results at other settings would differ.",
      "Every run cost $0. The cost shown “at API rates” applies Anthropic's list prices to the measured tokens.",
      "Votes on a public site can be manipulated. One decision per browser per round, with rate limits per address, is all that guards them. There are no accounts: you are an anonymous id kept in this browser.",
    ],
  },
];

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
      <Title>How it works</Title>
      {SECTIONS.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="deco-title text-2xl">{section.title}</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 leading-relaxed text-text-secondary">
            {section.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
