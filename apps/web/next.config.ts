import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import type { NextConfig } from "next";

const repoRoot = join(__dirname, "..", "..");

// The repository keeps one .env at its root. The web app takes only these names
// from it, so the recorder's credentials never enter the web server's environment.
const WEB_VARIABLES = ["DATABASE_URL", "ARENA_IP_HASH_KEY", "ARENA_DATA_DIR"];
const rootEnv = join(repoRoot, ".env");
if (existsSync(rootEnv)) {
  const values = parseEnv(readFileSync(rootEnv, "utf8"));
  for (const name of WEB_VARIABLES) {
    const value = values[name];
    if (value && process.env[name] === undefined) process.env[name] = value;
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ["@arena/schema"],
  // The recordings live in the repository's data folder, outside this app.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/api/**": ["../../data/**"],
  },
};

export default nextConfig;
