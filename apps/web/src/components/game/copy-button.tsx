"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Copies text to the clipboard and says so. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={copy}>
        {label}
      </Button>
      <span role="status" className="text-sm text-muted-foreground">
        {state === "copied"
          ? "Copied."
          : state === "failed"
            ? "Could not copy; select the text instead."
            : ""}
      </span>
    </span>
  );
}
