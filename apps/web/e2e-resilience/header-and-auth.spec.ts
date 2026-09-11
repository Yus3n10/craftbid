import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * The header on phones, tablets and desktops, the sign-in pages, and what
 * signing in has to prove before the app believes it.
 *
 * Every API call is answered here, so each case controls exactly what the
 * server says: signed in or not, and whether the browser "kept" the session.
 */

const CLIENT = {
  id: "01920000-0000-7000-8000-000000000001",
  username: "maya",
  displayName: "Maya Dela Cruz",
  role: "client",
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
  email: "maya@example.com",
} as const;

const ARTIST = {
  ...CLIENT,
  id: "01920000-0000-7000-8000-000000000002",
  username: "nena",
  displayName: "Nena Hooks",
  role: "artist",
  email: "nena@example.com",
  artist: { acceptingCommissions: true, categories: [], skills: [] },
} as const;

type User = typeof CLIENT | typeof ARTIST;

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/**
 * Answers the API. `me` decides what /auth/me says, and is read on every call
 * so a test can change it mid-flow (signed out, then signed in).
 */
async function stubApi(page: Page, me: () => User | null) {
  const answer = (route: Route, path: string) => {
    if (path === "/auth/me") {
      const user = me();
      return route.fulfill(user ? json(user) : SIGNED_OUT);
    }
    if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
    if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
    if (/^\/(feed|posts|postings|applications\/mine|commissions)$/.test(path)) {
      return route.fulfill(EMPTY_PAGE);
    }
    // Anything else (a profile, an image) is irrelevant to these cases.
    return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
  };

  await page.route(
    (url) => apiPath(url) !== null && apiPath(url) !== "/auth/login",
    (route) => answer(route, apiPath(new URL(route.request().url()))!),
  );
}

/**
 * Makes the page long enough to scroll, whatever it happens to contain.
 * Waits for the page to render first: appending to a <main> that is not there
 * yet silently does nothing, every later scroll clamps to the same short page,
 * and the header's behaviour is never actually exercised.
 */
async function makeScrollable(page: Page) {
  await page.locator("main").waitFor();
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "4000px";
    document.querySelector("main")!.append(spacer);
  });
}

/** Scrolls and proves it got there, so a short page cannot fake a result. */
async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
  expect(await page.evaluate(() => Math.round(window.scrollY)), "scroll position reached").toBe(y);
  // One frame for the scroll handler, then the 200ms slide.
  await page.waitForTimeout(350);
}

const header = (page: Page) => page.locator("header").first();
const headerBox = async (page: Page) => (await header(page).boundingBox())!;

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  /**
   * The failure: "Your profile", "Notifications" and "Post a request" in the
   * open menu navigated without closing it, so the next page opened under a
   * panel pinned over most of the screen, which stayed put while scrolling.
   */
  test("the menu never outlives the page it was opened on", async ({ page }) => {
    await stubApi(page, () => CLIENT);
    await page.goto("/postings");

    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.locator("#mobile-nav");
    await expect(menu).toBeVisible();

    // Opened, it still fits in the screen under the bar.
    const box = (await menu.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(812);

    await menu.getByRole("link", { name: "Your profile" }).click();
    await expect(page).toHaveURL(/\/artists\/maya/);
    await expect(menu).toBeHidden();
  });

  test("Escape closes the menu and puts focus back on the button", async ({ page }) => {
    await stubApi(page, () => CLIENT);
    await page.goto("/postings");

    const button = page.getByRole("button", { name: "Menu" });
    await button.click();
    await expect(page.locator("#mobile-nav")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-nav")).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("the bar slides away while reading down and is back on the first scroll up", async ({ page }) => {
    await stubApi(page, () => null);
    await page.goto("/postings");
    await makeScrollable(page);

    expect((await headerBox(page)).y).toBe(0);

    await scrollTo(page, 900);
    const away = await headerBox(page);
    expect(away.y + away.height, "hidden while reading down").toBeLessThanOrEqual(1);

    await scrollTo(page, 800);
    expect((await headerBox(page)).y, "back on the way up").toBe(0);
  });

  /**
   * The failure: a link kept the previous page's scroll offset, so the next
   * page opened partway down, and with the bar hidden from the scroll that
   * got there, it opened with no header in view.
   */
  test("a link opens the next page at its top, with the header in view", async ({ page }) => {
    await stubApi(page, () => null);
    await page.goto("/postings");
    await makeScrollable(page);

    const bottom = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    await scrollTo(page, bottom);
    const away = await headerBox(page);
    expect(away.y + away.height, "hidden after reading down").toBeLessThanOrEqual(1);

    await page.getByRole("contentinfo").getByRole("link", { name: "Browse artists" }).click();
    await expect(page).toHaveURL(/\/discover/);
    await expect(page.getByRole("heading", { name: "Discover work", level: 1 })).toBeVisible();

    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0);
    // The new page commits when its chunk arrives, and the bar slides back in
    // over 200ms from that moment, so this waits for the slide to finish.
    await expect.poll(async () => (await headerBox(page)).y, { timeout: 2_000 }).toBe(0);
  });

  test("search is one tap from the bar, and the menu no longer carries it", async ({ page }) => {
    await stubApi(page, () => CLIENT);
    await page.goto("/postings");

    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator("#header-search input")).toBeFocused();

    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator("#header-search")).toBeHidden();
    await expect(page.locator("#mobile-nav input")).toHaveCount(0);
  });
});

test.describe("the sign-in pages", () => {
  // Short enough that the page scrolls, as it does with a keyboard up.
  test.use({ viewport: { width: 375, height: 560 } });

  /**
   * The failure: a pinned, translucent bar that stayed over the form as the
   * page scrolled, taking a large share of a screen already halved by the
   * keyboard.
   */
  for (const path of ["/login", "/register"]) {
    test(`${path}: the header scrolls away with the page instead of floating over the form`, async ({ page }) => {
      await stubApi(page, () => null);
      await page.goto(path);

      expect((await headerBox(page)).y).toBe(0);
      await scrollTo(page, 200);
      expect((await headerBox(page)).y).toBeLessThan(0);
    });
  }
});

test.describe("across widths, signed in as a client", () => {
  /**
   * The failure: the full navigation switched on at 768px, but signed in as a
   * client its contents ran to 904px, so tablets scrolled sideways.
   */
  for (const width of [320, 768, 900, 1024, 1280]) {
    test(`${width}px: nothing scrolls sideways and the navigation is reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await stubApi(page, () => CLIENT);
      await page.goto("/postings");
      await expect(page.getByRole("heading", { name: "Craft requests", level: 1 })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);

      if (width >= 1024) {
        await expect(
          page.getByRole("banner").getByRole("link", { name: "My requests" }),
        ).toBeVisible();
      } else {
        await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
      }
    });
  }

  test("desktop: the header stays in place while scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubApi(page, () => CLIENT);
    await page.goto("/postings");
    await makeScrollable(page);

    await scrollTo(page, 900);
    expect((await headerBox(page)).y).toBe(0);
  });
});

test.describe("signing in", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  async function signIn(page: Page, remember: boolean) {
    await page.getByLabel("Email").fill("nena@example.com");
    await page.getByLabel("Password").fill("a sufficiently long password");
    if (remember) await page.getByRole("checkbox", { name: "Keep me logged in" }).check();
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("Keep me logged in is offered, off by default, and sent when ticked", async ({ page }) => {
    let signedIn = false;
    await stubApi(page, () => (signedIn ? ARTIST : null));

    const sent: unknown[] = [];
    await page.route(
      (url) => apiPath(url) === "/auth/login",
      async (route) => {
        sent.push(route.request().postDataJSON());
        signedIn = true;
        await route.fulfill(json({ user: ARTIST, accessToken: "", refreshToken: "" }));
      },
    );

    await page.goto("/login");
    await expect(page.getByRole("checkbox", { name: "Keep me logged in" })).not.toBeChecked();

    await signIn(page, true);
    await expect(page).not.toHaveURL(/\/login/);
    expect(sent).toEqual([expect.objectContaining({ remember: true })]);
  });

  /**
   * The failure behind "My bids" saying "You need to sign in to do that" to
   * someone who had just signed in. The sign-in answered 200 and the app took
   * the user from that answer, but the browser had refused the session cookies
   * that came with it. Here the server keeps answering 401 after a
   * successful sign-in, which is exactly what such a browser sees.
   */
  test("a sign-in the browser did not keep is reported, not shown as signed in", async ({ page }) => {
    await stubApi(page, () => null);
    await page.route(
      (url) => apiPath(url) === "/auth/login",
      (route) => route.fulfill(json({ user: ARTIST, accessToken: "", refreshToken: "" })),
    );

    await page.goto("/login");
    await signIn(page, false);

    await expect(page.getByRole("alert")).toContainText("did not keep you signed in");
    await expect(page).toHaveURL(/\/login/);

    // And nothing that needs the session is on offer.
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator("#mobile-nav").getByRole("link", { name: "My bids" })).toHaveCount(0);
  });

  test("a kept sign-in opens My bids straight away, without a false sign-in error", async ({ page }) => {
    let signedIn = false;
    await stubApi(page, () => (signedIn ? ARTIST : null));
    await page.route(
      (url) => apiPath(url) === "/auth/login",
      (route) => {
        signedIn = true;
        return route.fulfill(json({ user: ARTIST, accessToken: "", refreshToken: "" }));
      },
    );

    await page.goto("/login");
    await signIn(page, false);
    await expect(page).not.toHaveURL(/\/login/);

    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("#mobile-nav").getByRole("link", { name: "My bids" }).click();

    await expect(page.getByRole("heading", { name: "My bids" })).toBeVisible();
    await expect(page.getByText("You need to sign in to do that")).toHaveCount(0);
  });
});
