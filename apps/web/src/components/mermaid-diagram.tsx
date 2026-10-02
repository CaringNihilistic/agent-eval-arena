"use client";

import { useEffect, useId, useState } from "react";

type Drawing = { status: "drawing" } | { status: "drawn"; svg: string } | { status: "failed" };

/**
 * Draws Mermaid code written by a model. The code is untrusted, so Mermaid runs
 * at its strict security level: no HTML in labels and no click handlers. If it
 * cannot be drawn, the source is shown as plain text instead.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [drawing, setDrawing] = useState<Drawing>({ status: "drawing" });

  useEffect(() => {
    let cancelled = false;
    async function draw() {
      try {
        // Loaded on demand: Mermaid is large and most pages never need it.
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const { svg } = await mermaid.render(`mermaid-${id}`, code);
        if (!cancelled) setDrawing({ status: "drawn", svg });
      } catch {
        if (!cancelled) setDrawing({ status: "failed" });
      }
    }
    void draw();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (drawing.status === "drawn") {
    return (
      <div
        role="img"
        aria-label="Diagram drawn from the answer's Mermaid code"
        className="overflow-x-auto rounded-md border bg-background p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        // The SVG comes from Mermaid's own renderer at the strict security level.
        dangerouslySetInnerHTML={{ __html: drawing.svg }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground" role="status">
        {drawing.status === "failed"
          ? "This diagram could not be drawn. Its source is shown instead."
          : "Drawing the diagram…"}
      </p>
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}
