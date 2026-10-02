import type { ReactNode } from "react";

/** An Art Deco divider: a rule, a diamond, a rule. Drawn in the ornament colour. */
export function Ornament({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 12"
      aria-hidden="true"
      className={`h-3 w-60 max-w-full text-ornament ${className}`}
      fill="none"
      stroke="currentColor"
    >
      <path d="M0 6 H96 M144 6 H240" strokeWidth="1" />
      <path d="M120 1 L128 6 L120 11 L112 6 Z" strokeWidth="1" fill="currentColor" />
      <path
        d="M104 6 L108 3.5 L112 6 L108 8.5 Z M128 6 L132 3.5 L136 6 L132 8.5 Z"
        strokeWidth="1"
      />
    </svg>
  );
}

/** A page or section title in the title face, with the diamond divider under it. */
export function Title({
  children,
  as: Tag = "h1",
  kicker,
  centered = false,
}: {
  children: ReactNode;
  as?: "h1" | "h2" | "h3";
  /** A small label above the title. */
  kicker?: string;
  centered?: boolean;
}) {
  const size =
    Tag === "h1" ? "text-4xl sm:text-5xl" : Tag === "h2" ? "text-2xl sm:text-3xl" : "text-xl";
  return (
    <div className={`flex flex-col gap-2 ${centered ? "items-center text-center" : "items-start"}`}>
      {kicker ? <p className="deco-label text-ornament">{kicker}</p> : null}
      <Tag className={`deco-title ${size} text-balance`}>{children}</Tag>
      <Ornament />
    </div>
  );
}

/** A small uppercase label. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`deco-label text-muted-foreground ${className}`}>{children}</p>;
}

/** A parchment card with the double-line inset border. */
export function Parchment({
  children,
  className = "",
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`parchment ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** A panel on the dark surface. */
export function Panel({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`border border-line bg-panel p-5 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
