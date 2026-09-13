import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: [
    {
      command: "pnpm --filter @craftbid/api dev",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
      // Rate limits are off under NODE_ENV=test. The suite registers a fresh
      // account per run, which would otherwise trip the registration limiter.
      // The limiter has its own coverage in the API tests.
      // Email verification on, with each email written to apps/api/.outbox
      // for the tests to open, as a person would from their inbox.
      env: { NODE_ENV: "test", MAIL_DRIVER: "outbox", PUBLIC_WEB_URL: "http://localhost:5173" },
    },
    {
      command: "pnpm --filter @craftbid/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
    },
  ],
});
