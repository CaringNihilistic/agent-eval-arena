// Runs a command with uv inside a backend container, so the host needs no Python tooling.
// Usage: node scripts/py.mjs <api|sandbox> <command> [args...]
import { spawnSync } from "node:child_process";

const [service, ...command] = process.argv.slice(2);
if (!["api", "sandbox"].includes(service) || command.length === 0) {
  console.error("usage: node scripts/py.mjs <api|sandbox> <command> [args...]");
  process.exit(2);
}

// The api's tests include integration tests against the real sandbox, so for
// pytest the api's dependencies are started too. Everything else runs alone.
const needsSandbox = service === "api" && command[0] === "pytest";
const result = spawnSync(
  "docker",
  [
    "compose",
    "run",
    "--rm",
    ...(needsSandbox ? [] : ["--no-deps"]),
    "-T",
    service,
    "uv",
    "run",
    ...command,
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
