import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * Switching between artist and client, reporting, bug reports, and the admin
 * screen. Every API call is stubbed, so each case decides exactly what the
 * server says.
 */

const base = {
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
  emailVerified: true,
  isStaff: false,
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

test.describe("account type", () => {
  test("shows why a switch is not possible", async ({ page }) => {
    await stubApi(page, () => CLIENT, (route, path) =>
      path === "/me/role-switch"
        ? route.fulfill(json({ allowed: false, blockers: ["You have an open craft request. Cancel it or choose an artist first."], nextAllowedAt: null }))
        : undefined,
    );
    await page.goto("/settings#account-type");
    const section = page.getByRole("region", { name: "Account type" });
    await expect(section.getByText("Client", { exact: true })).toBeVisible();
    await expect(section.getByText(/open craft request/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Switch to artist" })).toBeDisabled();
  });

  test("confirms, switches, and shows the new role", async ({ page }) => {
    let me: object = CLIENT;
    const posts: unknown[] = [];
    await stubApi(page, () => me, (route, path, method) => {
      if (path === "/me/role-switch") return route.fulfill(json({ allowed: true, blockers: [], nextAllowedAt: null }));
      if (path === "/me/role" && method === "POST") {
        posts.push(route.request().postDataJSON());
        me = { ...ARTIST, id: CLIENT.id, username: CLIENT.username, displayName: CLIENT.displayName };
        return route.fulfill(json({ user: me, accessToken: "x", refreshToken: "y" }));
      }
      return undefined;
    });
    await page.goto("/settings#account-type");
    const section = page.getByRole("region", { name: "Account type" });
    await section.getByRole("button", { name: "Switch to artist" }).click();

    const dialog = page.getByRole("dialog", { name: "Switch to an artist account?" });
    await expect(dialog.getByText(/signed out on your other devices/)).toBeVisible();
    expect(posts).toHaveLength(0);
    await dialog.getByRole("button", { name: "Switch to artist" }).click();

    await expect(section.getByText("Artist", { exact: true })).toBeVisible();
    expect(posts).toEqual([{ role: "artist" }]);
  });
});

const POST_ID = "01920000-0000-7000-8000-0000000000aa";
const OTHER_ARTIST = { ...ARTIST, id: "01920000-0000-7000-8000-000000000009", username: "lito", displayName: "Lito Weaves" };
const POST = {
  id: POST_ID,
  caption: "Abaca table runner",
  coverImage: null,
  images: [],
  artist: OTHER_ARTIST,
  createdAt: "2026-09-10T00:00:00.000Z",
  reactions: { love: 0, support: 0, like: 0, total: 0, mine: null },
  commentCount: 0,
  shareCount: 0,
  saved: false,
  shared: false,
};

test.describe("reporting", () => {
  test("reports a post with a reason, and says it was received", async ({ page }) => {
    const reports: unknown[] = [];
    await stubApi(page, () => CLIENT, (route, path, method) => {
      if (path === "/feed") return route.fulfill(json({ items: [POST], total: 1, limit: 12, offset: 0 }));
      if (path === "/reports" && method === "POST") {
        reports.push(route.request().postDataJSON());
        return route.fulfill(json({ id: "r1" }, 201));
      }
      return undefined;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "More options for this post" }).click();
    await page.getByRole("button", { name: "Report", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Report this post" });
    await dialog.getByRole("radio", { name: "It's stolen work" }).check();
    await dialog.getByLabel("Anything else? (optional)").fill("This is my photo.");
    await dialog.getByRole("button", { name: "Send report" }).click();

    await expect(dialog.getByText("Thanks. Craftbid will review it.")).toBeVisible();
    expect(reports).toEqual([{ targetType: "artist_post", targetId: POST_ID, reason: "stolen_work", details: "This is my photo." }]);
  });

  test("a second report on the same thing says so instead of failing", async ({ page }) => {
    await stubApi(page, () => CLIENT, (route, path, method) => {
      if (path === "/feed") return route.fulfill(json({ items: [POST], total: 1, limit: 12, offset: 0 }));
      if (path === "/reports" && method === "POST") {
        return route.fulfill(json({ error: { code: "conflict", message: "You have already reported this." } }, 409));
      }
      return undefined;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "More options for this post" }).click();
    await page.getByRole("button", { name: "Report", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Report this post" });
    await dialog.getByRole("radio", { name: "Spam" }).check();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByText("You already reported this. Craftbid will review it.")).toBeVisible();
  });

  test("signed out, reporting asks for an account first", async ({ page }) => {
    await stubApi(page, () => null, (route, path) =>
      path === "/feed" ? route.fulfill(json({ items: [POST], total: 1, limit: 12, offset: 0 })) : undefined,
    );
    await page.goto("/");
    await page.getByRole("button", { name: "More options for this post" }).click();
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "You need an account for that" })).toBeVisible();
  });

  test("sends a bug report from the account menu with the page filled in", async ({ page }) => {
    let body = "";
    await stubApi(page, () => CLIENT, (route, path, method) => {
      if (path === "/bug-reports" && method === "POST") {
        body = route.request().postData() ?? "";
        return route.fulfill(json({ id: "b1" }, 201));
      }
      return undefined;
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/postings");
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("banner").getByRole("button", { name: "Report a problem with the site" }).click();

    const dialog = page.getByRole("dialog", { name: "Report a problem with the site" });
    await expect(dialog.getByText("/postings")).toBeVisible();
    await dialog.getByLabel("What went wrong?").fill("The search box does not open on my tablet.");
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect(dialog.getByText("Thanks. This goes straight to the people who fix Craftbid.")).toBeVisible();
    expect(body).toContain("The search box does not open on my tablet.");
    expect(body).toContain("/postings");
  });
});

const STAFF = { ...CLIENT, id: "01920000-0000-7000-8000-0000000000ff", username: "ptheusen", displayName: "Ptheusen", isStaff: true };
const USERS = [
  { id: CLIENT.id, username: "maya", displayName: "Maya Dela Cruz", email: "maya@example.com", role: "client", status: "active", isStaff: false, createdAt: "2026-09-01T00:00:00.000Z", emailConfirmedAt: "2026-09-02T03:00:00.000Z" },
  { id: ARTIST.id, username: "nena", displayName: "Nena Hooks", email: "nena@example.com", role: "artist", status: "suspended", isStaff: false, createdAt: "2026-09-03T00:00:00.000Z", emailConfirmedAt: null },
];

test.describe("admin screen", () => {
  test("is not there for someone who is not staff", async ({ page }) => {
    const calls = await stubApi(page, () => CLIENT);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
    expect(calls.some((call) => call.includes("/admin/"))).toBe(false);

    await page.getByRole("button", { name: "Account and settings" }).click();
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("lists accounts with confirmed and not confirmed emails, and filters", async ({ page }) => {
    const urls: string[] = [];
    await stubApi(page, () => STAFF, (route, path) => {
      if (path === "/admin/users") {
        urls.push(route.request().url());
        const email = new URL(route.request().url()).searchParams.get("email");
        const items = email === "unconfirmed" ? USERS.filter((u) => !u.emailConfirmedAt) : USERS;
        return route.fulfill(json({ items, total: items.length, limit: 25, offset: 0 }));
      }
      return undefined;
    });
    await page.goto("/admin?tab=users");

    const maya = page.getByRole("row", { name: /maya@example.com/ });
    await expect(maya.getByText("Email confirmed")).toBeVisible();
    const nena = page.getByRole("row", { name: /nena@example.com/ });
    await expect(nena.getByText("Not confirmed")).toBeVisible();
    await expect(nena.getByText("Suspended")).toBeVisible();

    await page.getByLabel("Email").selectOption("unconfirmed");
    await expect(page.getByRole("row", { name: /maya@example.com/ })).toHaveCount(0);
    expect(urls.at(-1)).toContain("email=unconfirmed");
  });

  test("removes a reported post with a rule, and the report leaves the queue", async ({ page }) => {
    let open = true;
    const removals: unknown[] = [];
    await stubApi(page, () => STAFF, (route, path, method) => {
      if (path === "/admin/reports") {
        const items = open
          ? [{
              id: "01920000-0000-7000-8000-0000000000r1",
              targetType: "artist_post",
              targetId: POST_ID,
              reason: "stolen_work",
              details: "This is my photo.",
              status: "open",
              createdAt: "2026-09-14T00:00:00.000Z",
              reporter: { id: CLIENT.id, username: "maya" },
              target: { text: "Abaca table runner", href: `/posts/${POST_ID}`, removed: false, owner: { id: OTHER_ARTIST.id, username: "lito" } },
              resolution: null,
            }]
          : [];
        return route.fulfill(json({ items, total: items.length, limit: 25, offset: 0 }));
      }
      if (path === `/admin/posts/${POST_ID}/remove` && method === "POST") {
        removals.push(route.request().postDataJSON());
        open = false;
        return route.fulfill({ status: 204 });
      }
      return undefined;
    });
    await page.goto("/admin?tab=reports");

    const report = page.getByRole("article", { name: /Abaca table runner/ });
    await expect(report.getByText("This is my photo.")).toBeVisible();
    await report.getByRole("button", { name: "Remove post" }).click();

    const dialog = page.getByRole("dialog", { name: "Remove this post" });
    await dialog.getByLabel("Rule").selectOption("stolen_work");
    await expect(dialog.getByText(/Only post work you made yourself/)).toBeVisible();
    await dialog.getByRole("button", { name: "Remove post" }).click();

    await expect(page.getByText("No open reports")).toBeVisible();
    expect(removals).toEqual([{ rule: "stolen_work", reportId: "01920000-0000-7000-8000-0000000000r1" }]);
  });

  test("works at phone width without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stubApi(page, () => STAFF, (route, path) =>
      path === "/admin/users" ? route.fulfill(json({ items: USERS, total: 2, limit: 25, offset: 0 })) : undefined,
    );
    await page.goto("/admin?tab=users");
    await expect(page.getByText("nena@example.com")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
