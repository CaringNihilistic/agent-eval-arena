// Generates TypeScript types from trace-event.schema.json.
// With --check, fails if the committed output is stale instead of writing it.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(root, "trace-event.schema.json");
const outPath = resolve(root, "generated", "trace-event.ts");

const banner = `/* eslint-disable */
// GENERATED from trace-event.schema.json. Do not edit by hand; run \`pnpm schema:gen\`.`;

const generated = (
  await compileFromFile(schemaPath, {
    bannerComment: banner,
    additionalProperties: false,
    unreachableDefinitions: true,
    style: { printWidth: 100 },
  })
).replace(/\r\n/g, "\n");

if (process.argv.includes("--check")) {
  const current = await readFile(outPath, "utf8").catch(() => "");
  if (current.replace(/\r\n/g, "\n") !== generated) {
    console.error("generated/trace-event.ts is stale. Run `pnpm schema:gen`.");
    process.exit(1);
  }
  console.log("TypeScript trace types are up to date.");
} else {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, generated);
  console.log(`Wrote ${outPath}`);
}
