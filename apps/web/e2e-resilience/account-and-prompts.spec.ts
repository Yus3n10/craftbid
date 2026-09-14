import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * The account menu, and every prompt that stands between someone and losing
 * something: signing in to act, confirming an email, signing out, leaving a
 * half-filled form. Plus the pages a verification email leads to, and the
 * payment details form lining up.
 */

const base = {
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
};

const ARTIST = {
  ...base,
  id: "01920000-0000-7000-8000-000000000002",
  username: "nena",
  displayName: "Nena Hooks",
  role: "artist",
  email: "nena@example.com",
  emailVerified: true,
  artist: { acceptingCommissions: true, categories: [], skills: [] },
};

const OTHER_ARTIST = { id: "01920000-0000-7000-8000-000000000009", username: "lito", displayName: "Lito Weaves", role: "artist", avatar: null };

const POST = {
  id: "01920000-0000-7000-8000-0000000000aa",
  caption: "Abaca table runner",
  coverImage: null,
  images: [],
  artist: OTHER_ARTIST,
  createdAt: "2026-09-10T00:00:00.000Z",
  reactions: { love: 0, support: 0, like: 0, total: 0, mine: null },
  commentCount: 0,
  shareCount: 0,
};

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

type Me = typeof ARTIST | null;

/** Answers the API; records every call so a test can prove one never happened. */
async function stubApi(page: Page, me: () => Me, extra?: (route: Route, path: string, method: string) => Promise<void> | undefined) {
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
      if (path === "/auth/logout") return route.fulfill({ status: 204 });
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (path === "/feed") return route.fulfill(json({ items: [POST], total: 1, limit: 12, offset: 0 }));
      if (path === "/me/payout-accounts") return route.fulfill(json([]));
      if (/^\/(posts|postings|applications\/mine|commissions)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
  return calls;
}

test.describe("the account menu", () => {
  test("the cog opens profile, settings, saved posts, history, notifications and sign out", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubApi(page, () => ARTIST);
    await page.goto("/postings");

    const cog = page.getByRole("button", { name: "Account and settings" });
    await cog.click();
    await expect(cog).toHaveAttribute("aria-expanded", "true");
    // The panel the cog controls; the header has its own profile link beside it.
    const panel = page.locator(`[id="${await cog.getAttribute("aria-controls")}"]`);
    for (const name of ["Your profile", "Edit profile and settings", "Saved posts", "Activity history", "Notifications"]) {
      await expect(panel.getByRole("link", { name })).toBeVisible();
    }
    await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(cog).toBeFocused();

    await cog.click();
    await panel.getByRole("link", { name: "Saved posts" }).click();
    await expect(page).toHaveURL(/\/saved$/);
    await expect(page.getByRole("heading", { name: "Saved posts", level: 1 })).toBeVisible();
  });

  test("the phone menu carries the same places", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stubApi(page, () => ARTIST);
    await page.goto("/postings");
    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.locator("#mobile-nav");
    for (const name of ["Your profile", "Edit profile and settings", "Saved posts", "Activity history", "Notifications"]) {
      await expect(menu.getByRole("link", { name })).toBeVisible();
    }
    await menu.getByRole("link", { name: "Activity history" }).click();
    await expect(page.getByRole("heading", { name: "Activity history", level: 1 })).toBeVisible();
  });
});

test.describe("signing out", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("asks first, and staying signed in sends nothing", async ({ page }) => {
    const calls = await stubApi(page, () => ARTIST);
    await page.goto("/postings");
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();

    const dialog = page.getByRole("dialog", { name: "Sign out of Craftbid?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Stay signed in" }).click();
    await expect(dialog).toBeHidden();
    expect(calls).not.toContain("POST /auth/logout");
  });

  test("confirming signs out", async ({ page }) => {
    let signedIn = true;
    const calls = await stubApi(page, () => (signedIn ? ARTIST : null), (route, path) => {
      if (path === "/auth/logout") {
        signedIn = false;
        return route.fulfill({ status: 204 });
      }
      return undefined;
    });
    await page.goto("/postings");
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
    expect(calls).toContain("POST /auth/logout");
  });

  test("warns that unsaved changes will be lost", async ({ page }) => {
    await stubApi(page, () => ARTIST);
    await page.goto("/settings");
    await page.getByLabel("About you").fill("Half a sentence about my");
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("dialog")).toContainText("You have unsaved changes on this page.");
  });
});

test.describe("leaving a half-filled form", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("asks before a link throws it away; staying keeps the text, leaving goes", async ({ page }) => {
    await stubApi(page, () => ARTIST);
    await page.goto("/settings");
    const bio = page.getByLabel("About you");
    await bio.fill("Weaving since 2009");

    await page.getByRole("banner").getByRole("link", { name: "Discover work" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Stay on this page" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(bio).toHaveValue("Weaving since 2009");

    await page.getByRole("banner").getByRole("link", { name: "Discover work" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL(/\/discover$/);
  });

  test("does not ask when nothing was typed", async ({ page }) => {
    await stubApi(page, () => ARTIST);
    await page.goto("/settings");
    await page.getByRole("heading", { name: "Your profile", level: 1 }).waitFor();
    await page.getByRole("banner").getByRole("link", { name: "Discover work" }).click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("acting without an account", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("saving opens a sign-in popup with an X, and saves nothing", async ({ page }) => {
    const calls = await stubApi(page, () => null);
    await page.goto("/");
    await page.getByRole("button", { name: "Save this post" }).click();

    const dialog = page.getByRole("dialog", { name: "You need an account for that" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("save posts");
    await expect(page).toHaveURL(/\/$/);
    expect(calls.some((call) => call.includes("/save"))).toBe(false);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /^Love/ }).click();
    await expect(page.getByRole("dialog")).toContainText("react to posts");
    await page.getByRole("dialog").getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the comment box and share to profile ask too", async ({ page }) => {
    await stubApi(page, () => null);
    await page.goto("/");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page.getByRole("button", { name: "Write a comment" }).click();
    await expect(page.getByRole("dialog")).toContainText("comment on posts");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Share" }).click();
    await page.getByRole("button", { name: "Share to your profile" }).click();
    await expect(page.getByRole("dialog")).toContainText("share posts to your profile");
  });
});

test.describe("email verification", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("an unconfirmed account sees the banner, and acting asks to confirm", async ({ page }) => {
    await stubApi(page, () => ({ ...ARTIST, emailVerified: false }));
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Confirm your email" })).toContainText("nena@example.com");
    await page.getByRole("button", { name: "Save this post" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm your email first" })).toBeVisible();
  });

  test("signing up with verification on shows where the link went", async ({ page }) => {
    await stubApi(page, () => null, (route, path) =>
      path === "/auth/register"
        ? route.fulfill(json({ status: "verification_sent", email: "new@example.com" }, 202))
        : undefined,
    );
    await page.goto("/register");
    await page.getByLabel("Display name").fill("New Person");
    await page.getByLabel("Username").fill("newperson");
    await page.getByLabel("Email").fill("new@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("a sufficiently long password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("new@example.com")).toBeVisible();
  });

  test("the link confirms, removes the token from the address bar, and lands signed in", async ({ page }) => {
    let signedIn = false;
    let urlWhenSent = "";
    const token = "A".repeat(43);
    await stubApi(page, () => (signedIn ? ARTIST : null), (route, path) => {
      if (path === "/auth/verify-email") {
        urlWhenSent = page.url();
        expect(route.request().postDataJSON()).toEqual({ token });
        signedIn = true;
        return route.fulfill(json({ user: ARTIST, accessToken: "a", refreshToken: "r" }));
      }
      return undefined;
    });
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText("Your email is confirmed.")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(urlWhenSent).not.toContain(token);
  });

  test("an expired link says so and offers a new one", async ({ page }) => {
    await stubApi(page, () => null, (route, path) =>
      path === "/auth/verify-email"
        ? route.fulfill(json({ error: { code: "link_expired", message: "This link has expired. Ask for a new one below." } }, 410))
        : undefined,
    );
    await page.goto(`/verify-email?token=${"B".repeat(43)}`);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a link" })).toBeVisible();
  });
});

test.describe("payment details", () => {
  test("every method's boxes line up in the same two columns", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubApi(page, () => ARTIST);
    await page.goto("/settings");
    await page.getByRole("heading", { name: "Where clients pay you" }).waitFor();

    const box = async (label: string, index = 0) =>
      (await page.getByLabel(label, { exact: true }).nth(index).boundingBox())!;

    const gcashName = await box("Name on the account", 0);
    const gcashNumber = await box("GCash number");
    const mayaName = await box("Name on the account", 1);
    const mayaNumber = await box("Maya number");
    const bankName = await box("Name on the account", 2);
    const bankNumber = await box("Account number");

    // Side by side at the same height, the same size.
    for (const [left, right] of [[gcashName, gcashNumber], [mayaName, mayaNumber], [bankName, bankNumber]] as const) {
      expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(left.height - right.height)).toBeLessThanOrEqual(1);
    }
    // And the columns start at the same place for every method.
    for (const row of [mayaName, bankName]) expect(Math.abs(row.x - gcashName.x)).toBeLessThanOrEqual(1);
    for (const row of [mayaNumber, bankNumber]) expect(Math.abs(row.x - gcashNumber.x)).toBeLessThanOrEqual(1);
  });
});
