import { defineConfig } from "@playwright/test";

// The end-to-end test builds the site and runs it on its own port against its
// own database, so it never touches the votes in the development database.
const PORT = 3101;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://arena:arena-local@localhost:5433/arena_e2e";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The browser already on the machine; no download.
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/meta`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: E2E_DATABASE_URL },
  },
});
