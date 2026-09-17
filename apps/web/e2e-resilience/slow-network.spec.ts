import { expect, test } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/** The page on a poor connection or an older phone. */

function stubSignedOut(page: import("@playwright/test").Page) {
  return page.route(
    (url) => apiPath(url) !== null,
    (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      if (path === "/auth/me") return route.fulfill(SIGNED_OUT);
      return route.fulfill(EMPTY_PAGE);
    },
  );
}

test("the home page paints while outside font hosts never answer", async ({ page }) => {
  await stubSignedOut(page);
  // Registered after the API stub so it wins: the stub treats any other origin
  // as the API, and would otherwise answer the font host itself.
  const outside: string[] = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    outside.push(route.request().url());
    // Never fulfilled: a connection that hangs.
  });

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 5_000 });
  expect(outside, "the page still asks an outside host for fonts").toEqual([]);
});

test("requests load on a browser without AbortSignal.timeout", async ({ page }) => {
  // iOS before 16 and Chrome before 103.
  await page.addInitScript("delete AbortSignal.timeout;");
  const posting = {
    id: "01920000-0000-7000-8000-0000000000b1",
    title: "Crochet wedding bouquet",
    description: "White roses with light blue accents.",
    category: { slug: "crochet", name: "Crochet", description: "" },
    minBudgetCentavos: 150_000,
    status: "open",
    images: [],
    client: { id: "01920000-0000-7000-8000-000000000001", username: "maya", displayName: "Maya Dela Cruz", role: "client", avatar: null },
    applicationCount: 0,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
  await page.route(
    (url) => apiPath(url) !== null,
    (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      if (path === "/auth/me") return route.fulfill(SIGNED_OUT);
      if (path === "/postings") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [posting], total: 1, limit: 20, offset: 0 }),
        });
      }
      return route.fulfill(EMPTY_PAGE);
    },
  );

  await page.goto("/postings");
  await expect(page.getByText("Crochet wedding bouquet").first()).toBeVisible();
});

test("the document says it is loading before the app starts", async ({ page }) => {
  await page.route(/\/assets\/.*\.js$/, () => {
    // Scripts never arrive.
  });
  // Not "domcontentloaded": module scripts run before that event, so with the
  // scripts hung it never fires.
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByText("Loading Craftbid")).toBeVisible();
});
