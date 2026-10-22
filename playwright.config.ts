import { defineConfig, devices } from "@playwright/test";

// Next.js allows one dev server per project, so reuse the one on the usual port if it is already running.
const PORT = Number(process.env.PW_PORT ?? 3000);
const chrome = { ...devices["Desktop Chrome"], channel: "chrome" as const };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Runs in the installed Google Chrome (channel "chrome"), not Playwright's bundled engines.
  // Each run gets a clean temporary profile, so tests never touch real cookies, history or logins.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: chrome, teardown: "teardown" },
    { name: "teardown", testMatch: /auth\.teardown\.ts/ },
    // Writes to the database. Runs only when E2E_ALLOW_WRITES=1 and the Supabase project matches E2E_SUPABASE_REF.
    { name: "workflow", testMatch: /workflow\.spec\.ts/, use: chrome, dependencies: ["setup"] },
    {
      name: "chrome",
      testIgnore: [/workflow\.spec\.ts/, /auth\.(setup|teardown)\.ts/],
      use: chrome,
      dependencies: ["setup", "workflow"],
    },
    {
      name: "chrome-375",
      testMatch: [/layout\.spec\.ts/, /accessibility\.spec\.ts/],
      use: { ...chrome, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
      dependencies: ["setup", "workflow"],
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
