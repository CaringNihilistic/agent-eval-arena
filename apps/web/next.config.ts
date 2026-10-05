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
    // The portrait files, so /api/art can see which exist once deployed.
    "/api/art": ["./public/guests/**"],
  },
  // Three rooms closed on 2026-10-05. Their addresses lead to the main game.
  // Temporary, so a browser does not remember it if a room reopens.
  async redirects() {
    return ["/library", "/timetable", "/morning-post"].map((source) => ({
      source,
      destination: "/drawing-room",
      permanent: false,
    }));
  },
};

export default nextConfig;
