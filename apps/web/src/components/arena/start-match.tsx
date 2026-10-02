"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { startMatch } from "@/lib/client-api";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";

/** Pick a category (or any) and open a recorded match the visitor has not voted on. */
export function StartMatch() {
  const router = useRouter();
  const [category, setCategory] = useState<Category | null>(null);
  const start = useMutation({
    mutationFn: () => startMatch(category),
    onSuccess: ({ match_id }) => router.push(`/arena/${match_id}`),
  });

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Kind of task</legend>
        <div className="flex flex-wrap gap-2">
          {[null, ...CATEGORIES].map((option) => (
            <Button
              key={option ?? "any"}
              type="button"
              variant={option === category ? "default" : "outline"}
              aria-pressed={option === category}
              onClick={() => setCategory(option)}
            >
              {option === null ? "Any" : CATEGORY_LABELS[option]}
            </Button>
          ))}
        </div>
      </fieldset>
      <Button
        size="lg"
        className="self-start"
        onClick={() => start.mutate()}
        disabled={start.isPending}
      >
        {start.isPending ? "Finding a match…" : "Start a match"}
      </Button>
      {start.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {start.error.message}
        </p>
      ) : null}
    </div>
  );
}
