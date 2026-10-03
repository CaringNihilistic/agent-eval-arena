import type { ReactNode } from "react";

import { RoundTable } from "@/components/game/round-table";
import { Title } from "@/components/theme/ornament";
import { EARLY_ROUND_KEY, VOTER_KEY } from "@/lib/client-api";
import { MODE_NAMES, type Mode } from "@/lib/types";

/**
 * Asks for the first round while the page's scripts are still loading, so the
 * letters do not wait for both in turn. It runs before React, and leaves the
 * request where the table will pick it up (see `fetchNextRound`). If anything
 * here fails, the table simply asks again in the usual way.
 */
function earlyRound(mode: Mode, seed: string | null): string {
  const request = JSON.stringify({ mode, seed });
  return `(function(){try{
var k=${JSON.stringify(VOTER_KEY)},id=localStorage.getItem(k);
if(!id){id=crypto.randomUUID();localStorage.setItem(k,id);}
window[${JSON.stringify(EARLY_ROUND_KEY)}]={request:${JSON.stringify(request)},response:fetch("/api/rounds/next",{method:"POST",headers:{"Content-Type":"application/json","X-Voter-Id":id},body:${JSON.stringify(request)}}).then(function(r){return r.json().then(function(b){return{ok:r.ok,status:r.status,body:b};});})};
}catch(e){}})();`;
}

/** The page of one mode: its name, how it is played, and its table. */
export function ModePage({
  mode,
  seed = null,
  children,
}: {
  mode: Mode;
  seed?: string | null;
  /** How the mode is played, in a sentence or two. */
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <script dangerouslySetInnerHTML={{ __html: earlyRound(mode, seed) }} />
      <Title>{MODE_NAMES[mode]}</Title>
      <p className="max-w-3xl text-text-secondary">{children}</p>
      {/* A screen's height from the start, so the footer is not pushed down when the round arrives. */}
      <div className="min-h-screen">
        <RoundTable mode={mode} seed={seed} />
      </div>
    </main>
  );
}
