// Fails if .env.example holds a real value for a secret. The file is committed to
// a public repo, so keys, tokens, and passwords in it must stay empty.
import { readFileSync } from "node:fs";

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)/i;
const filled = readFileSync(new URL("../.env.example", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/))
  .filter((match) => match && SECRET_NAME.test(match[1]) && match[2].trim() !== "")
  .map((match) => match[1]);

if (filled.length > 0) {
  console.error(
    `.env.example has a value for: ${filled.join(", ")}.\n` +
      "Secrets belong in .env, which is git-ignored. Leave them empty in .env.example.",
  );
  process.exit(1);
}
console.log(".env.example holds no secrets.");
