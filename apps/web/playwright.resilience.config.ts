import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests that need no database and no API, kept apart from the
 * marketplace suite: recovery from a stale build or a silent API, the header
 * at phone, tablet and desktop widths, and what sign-in must prove before the
 * app believes it.
 *
 * These run against a production build served by `vite preview`, because what
 * they are about only exists in one: hashed chunk filenames, a service worker,
 * and the dynamic imports that actually split at build time. The dev server
 * serves unbundled modules and would prove nothing about either.
 *
 * They also need no database and no API. Every call to the API is intercepted,
 * so the whole suite runs from a checkout with nothing else started, which is
 * the difference between a test that runs on every change and one that waits
 * for Oracle to boot.
 */
export default defineConfig({
  testDir: "./e2e-resilience",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: "http://localhost:4178",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",

    /**
     * No service worker, for two reasons that happen to agree.
     *
     * The faithful one: these tests are about a chunk the precache no longer
     * holds, which is the state cleanupOutdatedCaches leaves the open page in
     * after a deploy. A worker serving the file from cache is the situation
     * being tested for the absence of.
     *
     * The practical one: page.route cannot see a request a service worker
     * answers, so with one registered the interception below silently does
     * nothing and the test passes without having tested anything.
     */
    serviceWorkers: "block",
  },

  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "npx vite preview --port 4178 --strictPort",
    url: "http://localhost:4178",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
