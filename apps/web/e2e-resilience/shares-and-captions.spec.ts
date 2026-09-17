import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * A shared post is the sharer's own card, with its own reactions and comments,
 * and opens the real original. Long captions fold to about five lines.
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
const READER = { ...base, id: "01920000-0000-7000-8000-000000000001", username: "maya", displayName: "Maya Dela Cruz", role: "client", email: "maya@example.com" };
const ARTIST = { id: "01920000-0000-7000-8000-000000000009", username: "lito", displayName: "Lito Weaves", role: "artist", avatar: null };
const SHARER = { id: "01920000-0000-7000-8000-000000000003", username: "paolo", displayName: "Paolo Cruz", role: "client", avatar: null };
const POST_ID = "01920000-0000-7000-8000-0000000000aa";
const SHARE_ID = "01920000-0000-7000-8000-0000000000ab";

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

function post(caption: string, overrides: object = {}) {
  return {
    id: POST_ID,
    caption,
    coverImage: { id: "01920000-0000-7000-8000-0000000000f1", url: PIXEL, width: 800, height: 600 },
    images: [{ id: "01920000-0000-7000-8000-0000000000f1", url: PIXEL, width: 800, height: 600 }],
    artist: ARTIST,
    createdAt: "2026-09-10T00:00:00.000Z",
    reactions: { love: 3, support: 1, like: 1, total: 5, mine: null },
    commentCount: 4,
    shareCount: 1,
    saved: false,
    shared: false,
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
type Handler = (route: Route, path: string, method: string) => Promise<void> | undefined;

async function stubApi(page: Page, feed: object[], extra?: Handler) {
  const calls: { method: string; path: string }[] = [];
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      const method = route.request().method();
      calls.push({ method, path });
      const handled = extra?.(route, path, method);
      if (handled) return handled;
      if (path === "/auth/me") return route.fulfill(json(READER));
      if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
      if (path === "/feed") return route.fulfill(json({ items: feed, total: feed.length, limit: 12, offset: 0 }));
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (path === "/conversations/unread") return route.fulfill(json({ unread: 0 }));
      if (/^\/(posts|postings)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
  return calls;
}

const SHARED_ITEM = post("Abaca table runner in natural indigo", {
  share: {
    id: SHARE_ID,
    user: SHARER,
    caption: "My sister needs one of these",
    createdAt: "2026-09-12T00:00:00.000Z",
    reactions: { love: 0, support: 0, like: 2, total: 2, mine: null },
    commentCount: 1,
  },
});

test.describe("a shared post", () => {
  test("shows and takes its own reactions and comments, not the original's", async ({ page }) => {
    const calls = await stubApi(page, [SHARED_ITEM], (route, path, method) => {
      if (path === `/shares/${SHARE_ID}/reaction` && method === "PUT") return route.fulfill({ status: 204 });
      if (path === `/shares/${SHARE_ID}/comments`) {
        return route.fulfill(json([{ id: "01920000-0000-7000-8000-0000000000c1", body: "Ask Lito for a longer one", createdAt: "2026-09-12T01:00:00.000Z", mine: false, author: SHARER }]));
      }
      return undefined;
    });
    await page.goto("/");

    const card = page.getByRole("article", { name: "Paolo Cruz shared Lito Weaves's post" });
    await expect(card.getByText("My sister needs one of these")).toBeVisible();
    await expect(card.getByText("2 people")).toBeVisible();
    await expect(card.getByText("5 people")).toHaveCount(0);

    await card.getByRole("button", { name: /Love/ }).click();
    await expect.poll(() => calls.some((call) => call.method === "PUT" && call.path === `/shares/${SHARE_ID}/reaction`)).toBe(true);
    expect(calls.some((call) => call.path === `/posts/${POST_ID}/reaction`)).toBe(false);

    await card.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(card.getByText("Ask Lito for a longer one")).toBeVisible();
    expect(calls.some((call) => call.path === `/posts/${POST_ID}/comments`)).toBe(false);
  });

  test("opens the real original, with its own reactions and comments", async ({ page }) => {
    const calls = await stubApi(page, [SHARED_ITEM], (route, path) => {
      if (path === `/posts/${POST_ID}`) return route.fulfill(json(post("Abaca table runner in natural indigo")));
      if (path === `/posts/${POST_ID}/comments`) {
        return route.fulfill(json([{ id: "01920000-0000-7000-8000-0000000000c2", body: "The indigo is so even", createdAt: "2026-09-11T01:00:00.000Z", mine: false, author: READER }]));
      }
      return undefined;
    });
    await page.goto("/");

    await page.getByRole("button", { name: /Open Lito Weaves's original post/ }).click();
    const dialog = page.getByRole("dialog", { name: "Lito Weaves's post" });
    await expect(dialog.getByText("5 people")).toBeVisible();
    await dialog.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(dialog.getByText("The indigo is so even")).toBeVisible();
    expect(calls.some((call) => call.path === `/shares/${SHARE_ID}/comments`)).toBe(false);
  });
});

test.describe("captions", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const LONG = Array.from({ length: 14 }, (_, i) => `Line ${i + 1} about the weave, the dye and the loom 🧵`).join("\n");

  test("a long caption folds to about five lines and opens with See more", async ({ page }) => {
    await stubApi(page, [post(LONG)]);
    await page.goto("/");
    const card = page.getByRole("article").first();
    const more = card.getByRole("button", { name: "See more" });
    await expect(more).toBeVisible();

    // Five lines of whatever line height this font has on this device.
    const { height, lineHeight } = await card.locator("p.whitespace-pre-wrap").first().evaluate((el) => ({
      height: el.parentElement!.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el.parentElement!).lineHeight),
    }));
    expect(height).toBeGreaterThan(lineHeight * 4);
    expect(height).toBeLessThanOrEqual(lineHeight * 5 + 1);

    await more.click();
    await expect(card.getByRole("button", { name: "See less" })).toBeVisible();
    await card.getByText("Line 14 about the weave", { exact: false }).scrollIntoViewIfNeeded();
    await expect(card.getByText("Line 14 about the weave", { exact: false })).toBeVisible();
    // Expanding did not open the full-size image behind it.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a short caption shows in full with nothing to press", async ({ page }) => {
    await stubApi(page, [post("Abaca table runner")]);
    await page.goto("/");
    await expect(page.getByText("Abaca table runner")).toBeVisible();
    await expect(page.getByRole("button", { name: "See more" })).toHaveCount(0);
  });
});

test.describe("removing your own", () => {
  test("the person who shared a post can remove the share, and the original is left alone", async ({ page }) => {
    let feed: object[] = [SHARED_ITEM];
    const calls = await stubApi(page, [], (route, path, method) => {
      if (path === "/auth/me") return route.fulfill(json({ ...base, ...SHARER, email: "paolo@example.com" }));
      if (path === "/feed") return route.fulfill(json({ items: feed, total: feed.length, limit: 12, offset: 0 }));
      if (path === `/posts/${POST_ID}/share` && method === "DELETE") {
        feed = [];
        return route.fulfill({ status: 204 });
      }
      return undefined;
    });
    await page.goto("/");

    const card = page.getByRole("article", { name: /Paolo Cruz shared/ });
    await card.getByRole("button", { name: "More options for this share" }).click();
    await card.getByRole("button", { name: "Remove share" }).click();

    const dialog = page.getByRole("dialog", { name: "Remove this share?" });
    await expect(dialog).toContainText("Lito Weaves's original post stays.");
    await dialog.getByRole("button", { name: "Remove share" }).click();

    await expect(page.getByRole("article", { name: /Paolo Cruz shared/ })).toHaveCount(0);
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([`/posts/${POST_ID}/share`]);
  });

  test("nobody else is offered to remove someone's share", async ({ page }) => {
    await stubApi(page, [SHARED_ITEM]);
    await page.goto("/");
    const card = page.getByRole("article", { name: /Paolo Cruz shared/ });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "More options for this share" })).toHaveCount(0);
  });

  test("an artist can delete their own post after confirming, and is offered to edit it", async ({ page }) => {
    let feed: object[] = [post("Abaca table runner")];
    const calls = await stubApi(page, [], (route, path, method) => {
      if (path === "/auth/me") {
        return route.fulfill(json({ ...base, ...ARTIST, role: "artist", email: "lito@example.com", artist: { acceptingCommissions: true, categories: [], skills: [] } }));
      }
      if (path === "/feed") return route.fulfill(json({ items: feed, total: feed.length, limit: 12, offset: 0 }));
      if (path === `/posts/${POST_ID}` && method === "DELETE") {
        feed = [];
        return route.fulfill({ status: 204 });
      }
      return undefined;
    });
    await page.goto("/");

    const card = page.getByRole("article").filter({ hasText: "Abaca table runner" });
    await card.getByRole("button", { name: "More options for this post" }).click();
    await expect(card.getByRole("button", { name: "Edit post" })).toBeVisible();
    // Your own work is not something to report.
    await expect(card.getByRole("button", { name: "Report", exact: true })).toHaveCount(0);
    await card.getByRole("button", { name: "Delete post" }).click();

    const dialog = page.getByRole("dialog", { name: "Delete this post?" });
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(dialog).toBeHidden();
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);

    await card.getByRole("button", { name: "More options for this post" }).click();
    await card.getByRole("button", { name: "Delete post" }).click();
    await page.getByRole("dialog", { name: "Delete this post?" }).getByRole("button", { name: "Delete post" }).click();

    await expect(page.getByText("Abaca table runner")).toHaveCount(0);
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([`/posts/${POST_ID}`]);
  });
});
