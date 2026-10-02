"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MermaidDiagram } from "@/components/mermaid-diagram";
import type { Category } from "@/lib/types";

const FENCE = /^\s*```[a-zA-Z]*\n([\s\S]*?)```\s*$/;
const MERMAID_START =
  /^\s*(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|erDiagram|classDiagram)\b/;

/** The Mermaid code in a diagram answer: the fenced block if there is one, else all of it. */
export function diagramCode(answer: string): string {
  const fenced = FENCE.exec(answer);
  return (fenced ? fenced[1] : answer).trim();
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

/**
 * Markdown written by a model. Raw HTML is never rendered: react-markdown shows
 * it as text unless a raw-HTML plugin is added, and none is.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="answer-markdown flex flex-col gap-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer noopener nofollow" target="_blank" className="underline">
              {children}
            </a>
          ),
          // Tasks often ask for one item per line, so a single line break is kept.
          p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
          h1: ({ children }) => <h3 className="text-base font-bold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-base font-bold">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-bold">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1">
                {children}
              </table>
            </div>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ children, className }) => {
            const code = textOf(children);
            if (className === "language-mermaid") return <MermaidDiagram code={code.trim()} />;
            if (className || code.includes("\n")) {
              return (
                <pre className="overflow-x-auto border border-border bg-muted p-3 font-mono text-xs not-italic">
                  <code>{code.replace(/\n$/, "")}</code>
                </pre>
              );
            }
            return (
              <code className="bg-muted px-1 py-0.5 font-mono text-xs not-italic">{code}</code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** An agent's final answer: a drawn diagram for diagram tasks, markdown otherwise. */
export function AnswerView({ answer, category }: { answer: string | null; category: Category }) {
  if (answer === null || answer.trim() === "") {
    return <p className="text-sm text-muted-foreground">No answer was given.</p>;
  }
  if (category === "diagram") {
    const code = diagramCode(answer);
    if (MERMAID_START.test(code)) return <MermaidDiagram code={code} />;
  }
  if (category === "code" && !answer.includes("```")) {
    return (
      <pre className="overflow-x-auto border border-border bg-muted p-3 font-mono text-xs not-italic">
        <code>{answer}</code>
      </pre>
    );
  }
  return <Markdown text={answer} />;
}
