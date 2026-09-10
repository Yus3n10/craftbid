import { expect, test, type Page } from "@playwright/test";

/**
 * The two ways this app used to become unusable without saying so, and the
 * behaviour that now replaces each.
 *
 * Both were found by using the site, not by reading it, and neither was
 * catchable by anything in the suite at the time: the marketplace tests drive
 * a healthy build talking to a healthy API, and these are about what happens
 * when one of those two things is not true. Each test here was checked by
 * reverting its fix and watching it fail.
 */

/**
 * True for a call to the API and nothing else.
 *
 * The API is on its own origin, and matching on the path alone does not know
 * that: `/postings` is both an endpoint and a route in this app, so a pattern
 * written against the path answered the browser's own navigation to /postings
 * with a page of JSON. Everything after that is confusing -- there is no
 * #root in the document to look at -- and none of it is the thing under test.
 * Origin first, then path.
 */
function isApiCall(url: URL, path: RegExp): boolean {
  return url.hostname.endsWith("onrender.com") && path.test(url.pathname);
}

const SIGNED_OUT = {
  status: 401,
  contentType: "application/json",
  body: JSON.stringify({
    error: { code: "unauthorised", message: "Not signed in" },
  }),
};

const EMPTY_PAGE = {
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ items: [], total: 0 }),
};

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
   * The failure this reproduces:
   *
   * Routes are dynamic imports and a deploy renames the chunks. A page open
   * across a deploy still asks for the old filenames, and Cloudflare answers
   * an unknown path with index.html rather than a 404, so the browser is given
   * HTML where it asked for a module and rejects it. React then unmounted the
   * whole tree, leaving an empty <div id="root"> -- a white page on a URL that
   * had already changed, so it read as the app having simply stopped. React
   * caches a lazy component's rejection, so navigating away and back replayed
   * it: only a manual reload recovered, and nothing on screen said so.
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
   * The failure this reproduces:
   *
   * fetch has no timeout. Render stops the free service after fifteen idle
   * minutes, and a request into that gap could be accepted and never answered,
   * which left the promise pending, the query in isLoading, and the screen
   * showing skeletons that resolved into nothing and reported nothing. Watched
   * for twelve seconds it was still eight skeletons and no error. There was no
   * way out of it but a reload.
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
    await page.route(
      (url) => isApiCall(url, /^\/feed$/),
      () => {
        attempts += 1;
      },
    );

    await page.goto("/");

    // One 20s deadline, then React Query's first retry. Before the fix this
    // stayed at 1 for as long as the tab was open.
    await expect
      .poll(() => attempts, { timeout: 40_000, intervals: [1_000] })
      .toBeGreaterThan(1);
  });
});
