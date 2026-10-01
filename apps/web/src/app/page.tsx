import { ApiStatus } from "@/components/api-status";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Agent Eval Arena</h1>
        <p className="text-base text-muted-foreground text-pretty">
          Run two agent configs on the same task, watch both traces side by side, and vote blind on
          which did better.
        </p>
      </div>
      <ApiStatus />
    </main>
  );
}
