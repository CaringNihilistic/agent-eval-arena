import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "About · Agent Eval Arena" };

const SECTIONS: { title: string; points: string[] }[] = [
  {
    title: "What is compared",
    points: [
      "Three Claude models: Opus 5.5, Sonnet 5.5, and Haiku 4.5. Each got the same system prompt, the same four tools, and the same limits. Only the model differs.",
      "30 tasks in six kinds: writing, diagrams, explanations, tech-stack recommendations, code, and agent tasks that need tools. Each model ran each task once: 90 runs, 90 matches.",
      "Every match is a replay of recorded runs. Nothing is generated while you watch.",
    ],
  },
  {
    title: "What you see before you vote",
    points: [
      "What each agent did (its tool calls and their results), what it said, and its final answer.",
      "Not shown until you vote: which model is which, pass or fail, scores, tokens, cost, the models' thinking, and all timing. Haiku does not think and the models differ in speed, so either would give the model away. The replay runs at one fixed pace for the same reason.",
      "The server withholds these; they are not hidden by the page.",
      "What is still not blind: writing style can hint at the model, and the recordings are in a public repository.",
    ],
  },
  {
    title: "How answers are scored",
    points: [
      "Code tasks run hidden tests. Agent tasks have one right answer. Both are pass or fail.",
      "Writing, diagram, explanation, and tech-stack tasks have no right answer. They get automatic checks of the limits the task stated: the length limit, required sections, constraints that had to be mentioned, a diagram that parses. This is shown as “constraints met X/Y”. It is not a measure of quality; quality on these tasks is your vote.",
      "The checks are crude. “Mentions the budget” is a text match, and a diagram is checked for parsing, not for how it looks.",
      "No AI judge is used anywhere.",
    ],
  },
  {
    title: "The three rankings",
    points: [
      "Visitor votes: Elo with K=32, starting at 1000, replayed in vote order, with a 95% bootstrap interval.",
      "Official benchmarks: Anthropic's published scores, copied from its announcement pages with the source and the date checked. Two models are compared only on benchmarks reported for both. Anthropic reports no benchmark that Haiku 4.5 shares with the two newer models, so Haiku has no official rank here.",
      "Our scorer: a pass counts 1, a fail 0, and an open-ended answer the share of its checks met.",
      "The official benchmarks measure different tasks from ours, at higher effort settings. They are shown for comparison, not as a target.",
    ],
  },
  {
    title: "Limits of this data",
    points: [
      "One run per model per task. Model output varies from run to run.",
      "Pass rates rest on ten tasks per model, so the intervals are wide.",
      "The models ran through Claude Code's agent loop on a subscription, capped at 1,024 output tokens per call, with thinking off for Haiku 4.5 and at the lowest effort for the other two. Results at other settings would differ.",
      "Every run cost $0. The cost shown “at API rates” applies Anthropic's list prices to the measured tokens.",
      "Votes on a public site can be manipulated. One vote per browser per match, with rate limits per address, is all that guards them.",
    ],
  },
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">How this works</h1>
        {SECTIONS.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
              {section.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
