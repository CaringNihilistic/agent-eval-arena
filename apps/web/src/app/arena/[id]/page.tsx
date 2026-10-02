import { MatchClient } from "@/components/arena/match-client";
import { SiteHeader } from "@/components/site-header";

export default async function MatchPage({ params }: PageProps<"/arena/[id]">) {
  const { id } = await params;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6">
        <MatchClient matchId={id} />
      </main>
    </>
  );
}
