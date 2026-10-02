import { StartMatch } from "@/components/arena/start-match";
import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            Which agent did better?
          </h1>
          <p className="text-base text-pretty text-muted-foreground">
            Two Claude models were given the same task with the same prompt and tools. You see what
            each one did and what it answered, without knowing which is which. Vote, then see the
            models, our measured results, and Anthropic&apos;s published benchmarks side by side.
          </p>
        </div>
        <StartMatch />
        <p className="text-sm text-muted-foreground">
          Every match is a replay of a recorded run. Nothing is generated while you watch.
        </p>
      </main>
    </>
  );
}
