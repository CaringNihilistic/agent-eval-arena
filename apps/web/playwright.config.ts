import { defineConfig } from "@playwright/test";

// Two ways to run:
//
// Locally (the default): the test builds the site and runs it on its own port
// against its own database, so it never touches the development database.
//
// Against a deployed site: set E2E_BASE_URL to its address. Nothing is built or
// started, and no database is touched from here. The test's decisions go into
// that site's database under voter ids that start with the prefix below; remove
// them afterwards with `pnpm --filter web db:clean-e2e`.
const PORT = 3101;
export const LIVE_URL = process.env.E2E_BASE_URL;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://arena:arena-local@localhost:5433/arena_e2e";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: LIVE_URL ? undefined : "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: LIVE_URL ?? `http://localhost:${PORT}`,
    // The browser already on the machine; no download.
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: LIVE_URL
    ? undefined
    : {
        command: `pnpm build && pnpm exec next start --port ${PORT}`,
        url: `http://localhost:${PORT}/api/meta`,
        timeout: 240_000,
        reuseExistingServer: false,
        env: { DATABASE_URL: E2E_DATABASE_URL },
      },
});
