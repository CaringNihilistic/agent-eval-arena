// Reads Mermaid text on stdin and prints {"valid": bool, "error": string|null}.
// Mermaid expects a browser, so a minimal DOM is provided. Nothing is rendered:
// this checks that the text parses as a diagram.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Recent Node versions define navigator as a read-only getter.
if (!("navigator" in globalThis)) globalThis.navigator = dom.window.navigator;

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const text = Buffer.concat(chunks).toString("utf8");

const { default: mermaid } = await import("mermaid");
mermaid.initialize({ startOnLoad: false });

let verdict;
try {
  await mermaid.parse(text);
  verdict = { valid: true, error: null };
} catch (error) {
  const message = String(error?.message ?? error).split("\n")[0].slice(0, 200);
  verdict = { valid: false, error: message };
}
process.stdout.write(JSON.stringify(verdict));
// jsdom keeps timers alive; exit once the verdict is written.
process.exit(0);
