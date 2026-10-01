// @vitest-environment node
// The public site only replays recordings. Nothing in the web app may be able to
// reach a model provider or the Claude subscription backend, which is local only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Vitest runs from the web app's folder.
const webRoot = process.cwd();
const SKIPPED = new Set(["node_modules", ".next"]);

// Split so that this file does not contain the strings it looks for.
const FORBIDDEN = [
  ["claude", "agent", "sdk"].join("-"),
  ["claude", "agent", "sdk"].join("_"),
  ["CLAUDE_CODE", "OAUTH_TOKEN"].join("_"),
  ["ANTHROPIC", "API_KEY"].join("_"),
  ["GEMINI", "API_KEY"].join("_"),
  ["GROQ", "API_KEY"].join("_"),
];

function sourceFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js|json|css)$/.test(name) ? [path] : [];
  });
}

describe("the web app", () => {
  it("contains no reference to a model provider, a provider key, or the Agent SDK", () => {
    const hits = sourceFiles(webRoot).flatMap((path) => {
      const text = readFileSync(path, "utf8").toLowerCase();
      return FORBIDDEN.filter((term) => text.includes(term.toLowerCase())).map(
        (term) => `${relative(webRoot, path)}: ${term}`,
      );
    });

    expect(hits).toEqual([]);
  });

  it("depends on no model provider package", () => {
    const manifest = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(
      packages.filter((name) => /anthropic|openai|claude|gemini|groq|litellm/i.test(name)),
    ).toEqual([]);
  });
});
