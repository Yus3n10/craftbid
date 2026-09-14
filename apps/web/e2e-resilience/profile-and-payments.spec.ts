import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * The client batch of 2026-09-14: the home feed after a lapsed session, the
 * show-password button, the role badge and profile checklist, the balance
 * option's Save changes, and the unread count on a phone's header.
 */

const base = {
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
  emailVerified: true,
};

const CLIENT = {
  ...base,
  id: "01920000-0000-7000-8000-000000000001",
  username: "maya",
  displayName: "Maya Dela Cruz",
  role: "client",
  email: "maya@example.com",
};

const ARTIST = {
  ...base,
  id: "01920000-0000-7000-8000-000000000002",
  username: "nena",
  displayName: "Nena Hooks",
  role: "artist",
  email: "nena@example.com",
  artist: { acceptingCommissions: true, categories: [], skills: [] },
};

const COMMISSION_ID = "01920000-0000-7000-8000-0000000000c1";

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

type Handler = (route: Route, path: string, method: string) => Promise<void> | undefined;

/** Answers every API call; `extra` handles a case's own endpoints first. */
async function stubApi(page: Page, me: () => object | null, extra?: Handler) {
  const calls: string[] = [];
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      const method = route.request().method();
      calls.push(`${method} ${path}`);
      const handled = extra?.(route, path, method);
      if (handled) return handled;
      if (path === "/auth/me") {
        const user = me();
        return route.fulfill(user ? json(user) : SIGNED_OUT);
      }
      if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
      if (path === "/me/payout-accounts") return route.fulfill(json([]));
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (/^\/(feed|posts|postings|applications\/mine|commissions)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
  return calls;
}

test.describe("the home feed", () => {
  /**
   * A reader whose access token had lapsed got the feed asked for alongside
   * /auth/me, so it went out before the session was renewed and came back as
   * a stranger's copy. It has to wait for the session to settle.
   */
  test("waits for a returning reader's session before asking for the feed", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("craftbid.hadSession", "1"));
    let releaseMe!: () => void;
    const meAnswered = new Promise<void>((resolve) => (releaseMe = resolve));

    const calls = await stubApi(page, () => CLIENT, (route, path) => {
      if (path !== "/auth/me") return undefined;
      return meAnswered.then(() => route.fulfill(json(CLIENT)));
    });

    await page.goto("/");
    await page.waitForTimeout(800);
    expect(calls.filter((call) => call.startsWith("GET /feed")), "feed asked for before the session settled").toHaveLength(0);

    releaseMe();
    await expect(page.getByRole("heading", { name: "No work posted yet" })).toBeVisible();
    expect(calls.filter((call) => call.startsWith("GET /feed"))).toHaveLength(1);
  });

  test("a first-time visitor gets the feed without waiting on a session", async ({ page }) => {
    const calls = await stubApi(page, () => null, (route, path) =>
      path === "/auth/me" ? new Promise<void>(() => undefined) : undefined,
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No work posted yet" })).toBeVisible();
    expect(calls.some((call) => call.startsWith("GET /feed"))).toBe(true);
  });
});

test("the password can be shown and hidden again without submitting", async ({ page }) => {
  const calls = await stubApi(page, () => null);
  await page.goto("/login");

  const password = page.getByRole("textbox", { name: "Password", exact: true });
  await password.fill("a sufficiently long password");
  await expect(password).toHaveAttribute("type", "password");

  const toggle = page.getByRole("button", { name: "Show password" });
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  expect(calls.some((call) => call.includes("/auth/login")), "toggling submitted the form").toBe(false);
});

test.describe("profiles", () => {
  const profileOf = (user: typeof ARTIST | typeof CLIENT): Handler => (route, path) =>
    path === `/users/${user.username}` ? route.fulfill(json(user)) : undefined;

  test("say whether the account is an artist or a client", async ({ page }) => {
    await stubApi(page, () => null, (route, path) => profileOf(ARTIST)(route, path, "GET") ?? profileOf(CLIENT)(route, path, "GET"));

    await page.goto("/artists/nena");
    await expect(page.getByRole("heading", { name: "Nena Hooks" })).toBeVisible();
    await expect(page.getByText("Artist", { exact: true })).toBeVisible();

    await page.goto("/artists/maya");
    await expect(page.getByRole("heading", { name: "Maya Dela Cruz" })).toBeVisible();
    await expect(page.getByText("Client", { exact: true })).toBeVisible();
  });

  test("an artist with nothing filled in is told to add payment details first", async ({ page }) => {
    await stubApi(page, () => ARTIST, profileOf(ARTIST));
    await page.goto("/artists/nena");

    const checklist = page.getByRole("region", { name: "Complete your profile" });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText("0 of 7 done")).toBeVisible();
    await expect(checklist.getByRole("link").first()).toContainText("Add where clients pay you");

    await checklist.getByRole("link", { name: /Add where clients pay you/ }).click();
    await expect(page).toHaveURL(/\/settings#payout$/);
    await expect(page.getByRole("heading", { name: "Where clients pay you" })).toBeInViewport();
  });

  test("nobody else sees the checklist, and it is gone once everything is done", async ({ page }) => {
    const complete = {
      ...ARTIST,
      avatar: { id: "01920000-0000-7000-8000-0000000000f1", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", width: 1, height: 1 },
      bio: "I crochet.",
      links: [{ platform: "messenger", url: "https://m.me/nena" }],
      artist: { ...ARTIST.artist, headline: "Crochet to order", categories: [{ slug: "crochet", name: "Crochet", description: "" }] },
    };
    await stubApi(page, () => complete, (route, path) => {
      if (path === "/users/nena") return route.fulfill(json(complete));
      if (path === "/me/payout-accounts") return route.fulfill(json([{ method: "gcash", accountName: "Nena", accountNumber: "09171234567" }]));
      if (path === "/posts") return route.fulfill(json({ items: [], total: 3, limit: 1, offset: 0 }));
      return undefined;
    });
    await page.goto("/artists/nena");
    await expect(page.getByRole("heading", { name: "Nena Hooks" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: "Complete your profile" })).toHaveCount(0);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await stubApi(page, () => CLIENT, profileOf(ARTIST));
    await page.goto("/artists/nena");
    await expect(page.getByRole("heading", { name: "Nena Hooks" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: "Complete your profile" })).toHaveCount(0);
  });
});

test.describe("choosing how to pay the balance", () => {
  const commission = (balanceMethod: string) => ({
    id: COMMISSION_ID,
    posting: { id: "01920000-0000-7000-8000-0000000000b1", title: "Crochet cardigan", status: "in_progress" },
    client: CLIENT,
    artist: ARTIST,
    agreedPriceCentavos: 200000,
    status: "active",
    startedAt: "2026-09-10T00:00:00.000Z",
    canReview: false,
    reviews: [],
    paymentTracking: {
      downPaymentCentavos: 100000,
      balanceCentavos: 100000,
      balanceMethod,
      stage: "awaiting_down_payment",
      payments: [],
      finishedPhotoIds: [],
      problems: [],
      payTo: [],
    },
  });

  test("saves only when asked, and says the artist was told", async ({ page }) => {
    let saved = "transfer";
    const puts: unknown[] = [];
    await stubApi(page, () => CLIENT, (route, path, method) => {
      if (path === `/commissions/${COMMISSION_ID}` && method === "GET") return route.fulfill(json(commission(saved)));
      if (path === `/commissions/${COMMISSION_ID}/balance-method` && method === "PUT") {
        const body = route.request().postDataJSON() as { method: string };
        puts.push(body);
        saved = body.method;
        return route.fulfill({ status: 204 });
      }
      return undefined;
    });

    await page.goto(`/commissions/${COMMISSION_ID}`);
    const group = page.getByRole("group", { name: "How will you pay the other half?" });
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    await group.getByRole("radio", { name: /Cash on delivery/ }).check();
    expect(puts, "picking an option saved it straight away").toHaveLength(0);
    await group.getByRole("button", { name: "Save changes" }).click();

    await expect(group.getByText("Saved. The artist has been notified.")).toBeVisible();
    expect(puts).toEqual([{ method: "cod" }]);
    await expect(group.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(group.getByRole("radio", { name: /Cash on delivery/ })).toBeChecked();

    // Back to the saved option: nothing to save, no button.
    await group.getByRole("radio", { name: /Meet-up/ }).check();
    await expect(group.getByRole("button", { name: "Save changes" })).toBeVisible();
    await group.getByRole("radio", { name: /Cash on delivery/ }).check();
    await expect(group.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("unread notifications show in the header without opening the menu", async ({ page }) => {
    await stubApi(page, () => CLIENT, (route, path) =>
      path === "/notifications" ? route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 3 })) : undefined,
    );
    await page.goto("/postings");

    const bell = page.getByRole("banner").getByRole("link", { name: "Notifications" });
    await expect(bell).toBeVisible();
    await expect(bell.getByLabel("3 unread notifications")).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");

    await bell.click();
    await expect(page).toHaveURL(/\/notifications$/);
  });

  test("signed out, there is no bell", async ({ page }) => {
    await stubApi(page, () => null);
    await page.goto("/postings");
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Notifications" })).toHaveCount(0);
  });
});
