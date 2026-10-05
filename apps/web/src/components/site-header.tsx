import Link from "next/link";

const LINKS = [
  { href: "/drawing-room", label: "Play" },
  { href: "/record", label: "Results" },
  { href: "/casebook", label: "My Casebook" },
  { href: "/about", label: "About" },
];

// These links are on every page. They are not prefetched: fetching every other page's
// code on each load costs a phone more than the click saves.
export function SiteHeader() {
  return (
    <header className="border-b border-line bg-claret">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4"
      >
        <Link prefetch={false} href="/" className="deco-title text-2xl">
          Poison Pen
        </Link>
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                prefetch={false}
                href={link.href}
                className="deco-label underline-offset-4 hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-line">
      <p className="mx-auto w-full max-w-7xl px-4 py-5 text-sm text-muted-foreground">
        A Wrenfield Hall mystery, inspired by golden-age detective fiction. Every letter is a
        recorded answer from one of three AI models; nothing is written while you watch.{" "}
        <Link prefetch={false} href="/about" className="underline">
          How it works
        </Link>
        .
      </p>
    </footer>
  );
}
