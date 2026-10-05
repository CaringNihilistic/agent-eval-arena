"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { CopyButton } from "@/components/game/copy-button";
import { Label, Ornament, Parchment } from "@/components/theme/ornament";
import { Portrait } from "@/components/theme/portrait";
import { Button } from "@/components/ui/button";
import { casebookText, type Casebook, type Tally } from "@/lib/casebook";
import { createShare, fetchProfile, fetchSharedCasebook } from "@/lib/client-api";
import { CONFIDENCE_LABELS, CONFIDENCES } from "@/lib/types";

function tally(value: Tally): string {
  return value.total === 0 ? "none yet" : `${value.right} of ${value.total}`;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="deco-label text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The card itself. Read-only: the same for the owner and for anyone with the link. */
export function CasebookCard({ casebook }: { casebook: Casebook }) {
  const author = casebook.most_trusted_author;
  const guest = casebook.favourite_guest;
  return (
    <Parchment as="article" aria-label="Casebook" className="flex flex-col gap-5">
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="deco-label text-muted-foreground">The casebook of a</p>
        <h2 className="deco-title text-3xl">{casebook.rank}</h2>
        <Ornament />
        <p className="deco-title text-2xl" data-testid="method">
          {casebook.method.name}
        </p>
        <p className="text-sm text-muted-foreground">{casebook.method.because}</p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Points">{casebook.points}</Fact>
        <Fact label="Decisions">{casebook.decisions}</Fact>
        <Fact label="Authors named">{tally(casebook.author_naming)}</Fact>
        <Fact label="Timetables called">{tally(casebook.timetable_calls)}</Fact>
        <Fact label="Impostors caught">
          {casebook.impostors_caught} caught, {casebook.false_accusations} false{" "}
          {casebook.false_accusations === 1 ? "accusation" : "accusations"}, fooled{" "}
          {casebook.times_fooled} {casebook.times_fooled === 1 ? "time" : "times"}
        </Fact>
        <Fact label="Author most trusted">
          {author
            ? `${author.model}, trusted ${author.trusted} of ${author.seen} times`
            : "none yet"}
        </Fact>
        <Fact label="Sided with most players">
          {casebook.crowd_agreement.total === 0
            ? "too few votes to say"
            : tally(casebook.crowd_agreement)}
        </Fact>
        <Fact label="Opus over Sonnet, as the official benchmarks have it">
          {tally(casebook.benchmark_agreement)}
        </Fact>
        <Fact label="Right, by how sure you were">
          {CONFIDENCES.map(
            (level) => `${CONFIDENCE_LABELS[level]}: ${tally(casebook.by_confidence[level])}`,
          ).join(" · ")}
        </Fact>
        {casebook.morning_post ? (
          <Fact label="Last Morning Post">
            {`No. ${casebook.morning_post.game.slice(3)} ${casebook.morning_post.squares}`}
          </Fact>
        ) : null}
        <Fact label="Weekends survived">{casebook.weekends_survived}</Fact>
      </dl>

      {guest ? (
        <div className="flex items-center gap-4">
          <Portrait guest={guest.guest} expression="happy" />
          <p>
            <span className="deco-label block text-muted-foreground">Favourite guest</span>
            {guest.name}, whose letter you trusted {guest.trusted}{" "}
            {guest.trusted === 1 ? "time" : "times"}. A guest is only a seat: this says something
            about you, not about any author.
          </p>
        </div>
      ) : null}

      <section>
        <Label className="mb-2">Distinctions</Label>
        <ul className="flex flex-wrap gap-2">
          {casebook.distinctions
            .filter((distinction) => distinction.earned)
            .map((distinction) => (
              <li key={distinction.id} className="deco-stamp" title={distinction.rule}>
                {distinction.name}
              </li>
            ))}
          {casebook.distinctions.every((distinction) => !distinction.earned) ? (
            <li className="text-sm text-muted-foreground">None yet.</li>
          ) : null}
        </ul>
      </section>
    </Parchment>
  );
}

function NotYet({ casebook }: { casebook: Casebook }) {
  return (
    <Parchment className="flex flex-col gap-3">
      <h2 className="deco-title text-2xl">Your Casebook is not open yet.</h2>
      <p>
        It opens after ten decisions; you need {casebook.needed} more. You have {casebook.points}{" "}
        points and the rank of {casebook.rank}.
      </p>
      <Button asChild className="self-start">
        <Link href="/drawing-room">Play a round</Link>
      </Button>
    </Parchment>
  );
}

/** The player's own Casebook, with the share link and the copy-text button. */
export function MyCasebook() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const share = useMutation({ mutationFn: createShare });
  if (profile.isPending) return <p role="status">Opening the casebook…</p>;
  if (profile.isError) return <p role="alert">{profile.error.message}</p>;
  const casebook = profile.data;
  if (!casebook.ready) return <NotYet casebook={casebook} />;
  const link = share.data ? `${window.location.origin}/casebook/${share.data.share_id}` : null;
  return (
    <div className="flex flex-col gap-5">
      <CasebookCard casebook={casebook} />
      <div className="flex flex-col gap-3">
        <CopyButton text={casebookText(casebook)} label="Copy as text" />
        {link ? (
          <>
            <p className="font-mono text-sm break-all" data-testid="share-link">
              {link}
            </p>
            <CopyButton text={link} label="Copy the link" />
          </>
        ) : (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => share.mutate()}
            disabled={share.isPending}
          >
            Make a link to share
          </Button>
        )}
        {share.isError ? <p role="alert">{share.error.message}</p> : null}
      </div>
    </div>
  );
}

/** Someone else's Casebook, opened from a share link. */
export function SharedCasebook({ shareId }: { shareId: string }) {
  const shared = useQuery({
    queryKey: ["casebook", shareId],
    queryFn: () => fetchSharedCasebook(shareId),
  });
  if (shared.isPending) return <p role="status">Opening the casebook…</p>;
  if (shared.isError) return <p role="alert">{shared.error.message}</p>;
  return (
    <div className="flex flex-col gap-5">
      <CasebookCard casebook={shared.data} />
      <Button asChild className="self-start">
        <Link href="/">Play it yourself</Link>
      </Button>
    </div>
  );
}
