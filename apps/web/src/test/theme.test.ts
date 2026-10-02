// @vitest-environment node
// The theme's rules that can be checked without a browser: contrast, tokens
// only, the portraits on disk, and the names that must not appear.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { EXPRESSIONS, GUEST_IDS, GUESTS } from "@/lib/guests";

const webRoot = process.cwd();
const css = readFileSync(join(webRoot, "src", "app", "globals.css"), "utf8");

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`No colour token --${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(token(foreground)), luminance(token(background))].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

/** Every pairing of text and surface the site uses. */
const TEXT_PAIRS: [string, string][] = [
  ["text", "claret"],
  ["text-secondary", "claret"],
  ["text-muted", "claret"],
  ["text", "panel"],
  ["text-secondary", "panel"],
  ["text-muted", "panel"],
  ["rose", "claret"],
  ["rose", "panel"],
  ["stamp-on-dark", "claret"],
  ["stamp-on-dark", "panel"],
  ["ink", "parchment"],
  ["ink-muted", "parchment"],
  ["ink", "parchment-shade"],
  ["ink-muted", "parchment-shade"],
  ["stamp", "parchment"],
  ["ink", "sage"],
  ["ink", "sage-hover"],
];

function sourceFiles(folder: string, pattern: RegExp): string[] {
  return readdirSync(folder).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sourceFiles(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

describe("the theme's colours", () => {
  it("are the ones the brief names", () => {
    const expected: Record<string, string> = {
      claret: "#3a1a22",
      panel: "#4a2430",
      line: "#6a3a47",
      parchment: "#e2d6bc",
      ink: "#2a141a",
      text: "#f0e4d4",
      "text-secondary": "#dccabd",
      "text-muted": "#cdb6aa",
      "ink-muted": "#5f4a3e",
      sage: "#a9c0a0",
      rose: "#c9a08a",
      stamp: "#9c2f2b",
      "stamp-on-dark": "#e59a8f",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(token(name).toLowerCase()).toBe(value);
    }
    expect(css).toContain("--pinstripe: rgba(201, 160, 138, 0.05)");
    expect(css).toContain("--pinstripe-width: 2px");
    expect(css).toContain("--pinstripe-gap: 46px");
  });

  it.each(TEXT_PAIRS)("%s on %s meets WCAG AA for body text", (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("appear in components only through tokens: no colour literal outside the stylesheet", () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
    const offenders = sourceFiles(join(webRoot, "src"), /\.tsx?$/)
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => literal.test(readFileSync(path, "utf8")))
      .map((path) => relative(webRoot, path));

    expect(offenders).toEqual([]);
  });

  it("uses no gradient except the hard-edged pinstripe, and none of the forbidden look", () => {
    const gradients = css.match(/[a-z-]*gradient\(/g) ?? [];

    expect(gradients).toEqual(["repeating-linear-gradient("]);
    expect(css).toContain("var(--pinstripe) var(--pinstripe-width)");
    const components = sourceFiles(join(webRoot, "src"), /\.tsx$/)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(components).not.toMatch(/bg-gradient|from-\w+-\d|to-\w+-\d/);
  });

  it("sets the three faces: Limelight titles, Libre Baskerville body, Josefin Sans labels", () => {
    const layout = readFileSync(join(webRoot, "src", "app", "layout.tsx"), "utf8");

    expect(layout).toMatch(/Limelight\(/);
    expect(layout).toMatch(/Libre_Baskerville\(/);
    expect(layout).toMatch(/Josefin_Sans\([^)]*weight: "600"/);
    expect(css).toMatch(/\.deco-label \{[^}]*text-transform: uppercase[^}]*letter-spacing/);
    expect(css).toMatch(/\.letter-hand \{[^}]*font-style: italic/);
  });
});

describe("the guests", () => {
  it("are the six of the brief, with a role, a description, and a quote each", () => {
    expect(GUESTS.map((guest) => [guest.id, guest.name, guest.role])).toEqual([
      ["constance", "Lady Constance Wrenfield", "The Dowager"],
      ["pike", "Colonel Archibald Pike", "The Retired Colonel"],
      ["ambrose", "Dr. Felix Ambrose", "The Village Doctor"],
      ["ivy", "Miss Ivy Hartley", "The Companion"],
      ["julian", "Mr. Julian Vane", "The Charming Nephew"],
      ["pell", "Mrs. Dorcas Pell", "The Housekeeper"],
    ]);
    expect(GUESTS.find((guest) => guest.id === "pike")?.quote).toBe(
      "Facts, man! Facts! Then dinner.",
    );
    expect(GUESTS.every((guest) => guest.description.length > 20 && guest.quote.length > 10)).toBe(
      true,
    );
  });

  it("each have four expressions on disk, where a PNG can replace them", () => {
    for (const guest of GUEST_IDS) {
      for (const expression of EXPRESSIONS) {
        const file = join(webRoot, "public", "guests", guest, `${expression}.svg`);
        expect(existsSync(file), file).toBe(true);
        expect(readFileSync(file, "utf8")).toContain("<svg");
      }
    }
    expect(EXPRESSIONS).toEqual(["neutral", "happy", "shocked", "flustered"]);
  });

  it("carry no model in their data: a guest is a costume", () => {
    expect(JSON.stringify(GUESTS)).not.toMatch(/claude|haiku|sonnet|opus|model/i);
  });
});

describe("the fiction", () => {
  // Assembled so this file does not contain the names it looks for.
  const forbidden = [
    ["Agatha", ["Chris", "tie"].join("")].join(" "),
    ["Chris", "tie"].join(""),
    ["Poi", "rot"].join(""),
    ["Mar", "ple"].join(""),
    ["Orient", "Express"].join(" "),
    ["Roger", "Ackroyd"].join(" "),
    ["And Then There", "Were None"].join(" "),
  ];

  it("never names a real author, her detectives, or her books", () => {
    const files = [
      ...sourceFiles(join(webRoot, "src"), /\.(tsx?|css)$/),
      ...sourceFiles(join(webRoot, "public"), /\.svg$/),
    ];
    const hits = files.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return forbidden
        .filter((name) => new RegExp(`\\b${name}\\b`).test(text))
        .map((name) => `${relative(webRoot, path)}: ${name}`);
    });

    expect(hits).toEqual([]);
  });

  it("says where the inspiration comes from on the about page", () => {
    const about = readFileSync(join(webRoot, "src", "app", "about", "page.tsx"), "utf8");

    expect(about).toContain("inspired by golden-age detective fiction");
  });

  it("uses no emoji in the interface", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    const offenders = sourceFiles(join(webRoot, "src"), /\.tsx$/)
      .filter((path) => !/\.test\.tsx$/.test(path))
      .filter((path) => emoji.test(readFileSync(path, "utf8")))
      .map((path) => relative(webRoot, path));

    expect(offenders).toEqual([]);
  });
});
