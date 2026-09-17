import { expect, test, type Page } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, isApiCall } from "./stub-api.js";

/** Everything the app asks of the API, answered without an API. */
async function stubApi(page: Page): Promise<void> {
  await page.route(
    (url) => isApiCall(url, /^\/auth\/(me|refresh)$/),
    (route) => route.fulfill(SIGNED_OUT),
  );

  await page.route(
    (url) => isApiCall(url, /^\/(feed|posts|postings|notifications)$/),
    (route) => route.fulfill(EMPTY_PAGE),
  );
}

test.describe("a build that changed under an open page", () => {
  /**
   * Routes are dynamic imports and a deploy renames the chunks. A page open
   * across a deploy still asks for the old filenames, and Cloudflare answers
   * an unknown path with index.html rather than a 404, so the browser is given
   * HTML where it asked for a module and rejects it.
   */
  test("recovers itself instead of going blank", async ({ page }) => {
    await stubApi(page);

    // Fail the route chunk once, the way a deploy does, then stop: the reload
    // is supposed to land on a build that has the file.
    let failuresLeft = 1;
    await page.route(/\/assets\/PostingsPage-.*\.js$/, (route) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        // Not an abort. Cloudflare returns index.html with a 200 for a missing
        // asset, and it is the MIME type that makes the import fail.
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Craftbid</title>",
        });
      }
      return route.continue();
    });

    await page.goto("/");
    await page.getByRole("link", { name: "Craft requests" }).first().click();

    // The page it was asked for, actually rendered.
    await expect(
      page.getByRole("heading", { name: "Craft requests", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/postings/);
    expect(failuresLeft).toBe(0); // the failure really did happen

    // And never a blank document on the way there.
    const root = page.locator("#root");
    await expect(root).not.toBeEmpty();
  });

  /**
   * The reload is allowed once per minute per tab. A chunk that stays broken
   * is therefore not a stale build, and reloading on a loop would leave
   * someone watching a page flash forever, so it has to stop and say what
   * happened.
   */
  test("says so, rather than looping, when a reload does not fix it", async ({
    page,
  }) => {
    await stubApi(page);

    let loads = 0;
    page.on("load", () => {
      loads += 1;
    });

    await page.route(/\/assets\/PostingsPage-.*\.js$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Craftbid</title>",
      }),
    );

    await page.goto("/");
    await page.getByRole("link", { name: "Craft requests" }).first().click();

    await expect(page.getByRole("alert")).toContainText(
      "This page needs reloading",
    );
    await expect(
      page.getByRole("button", { name: "Reload the page" }),
    ).toBeVisible();

    // The frame is still there and still usable, which is the point of the
    // boundary sitting inside Shell rather than around the router.
    await expect(
      page.getByRole("link", { name: "Discover work" }).first(),
    ).toBeVisible();

    // One navigation, one recovery reload, and then it stopped.
    await page.waitForTimeout(3_000);
    expect(loads).toBeLessThanOrEqual(3);
  });
});

test.describe("an API that accepts a request and never answers", () => {
  /**
   * fetch has no timeout. Render stops the free service after fifteen idle
   * minutes, and a request into that gap can be accepted and never answered.
   *
   * What is asserted is the root cause rather than the eventual message: the
   * attempt is abandoned on a deadline, so it can be retried at all. A request
   * arriving a second time is proof the first one was let go of.
   */
  test("abandons the attempt so it can be retried", async ({ page }) => {
    await page.route(
      (url) => isApiCall(url, /^\/auth\/(me|refresh)$/),
      (route) => route.fulfill(SIGNED_OUT),
    );
    await page.route(
      (url) => isApiCall(url, /^\/(posts|postings)$/),
      (route) => route.fulfill(EMPTY_PAGE),
    );

    let attempts = 0;
    // Accepted, then never answered. Playwright holds the route open by simply
    // never resolving it, which is the socket-level shape of the original bug.
    // /home is what the home page asks for first; /feed only after a 404, which
    // a hung request never gives. Both are held, so the test cannot pass or fail
    // on whatever an unstubbed call happens to reach on the machine running it.
    await page.route(
      (url) => isApiCall(url, /^\/(home|feed)$/),
      () => {
        attempts += 1;
      },
    );

    await page.goto("/");

    // One 20s deadline, then React Query's first retry.
    await expect
      .poll(() => attempts, { timeout: 40_000, intervals: [1_000] })
      .toBeGreaterThan(1);
  });
});
