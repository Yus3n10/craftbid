import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * The home feed with craft requests in it, and a client's requests on their
 * profile. A request card links to the request and carries none of the social
 * actions a post has, because bidding stays private.
 */

const ARTIST = { id: "01920000-0000-7000-8000-000000000009", username: "lito", displayName: "Lito Weaves", role: "artist", avatar: null };
const CLIENT_SUMMARY = { id: "01920000-0000-7000-8000-000000000001", username: "maya", displayName: "Maya Dela Cruz", role: "client", avatar: null, city: "Iloilo City" };

const POST = {
  id: "01920000-0000-7000-8000-0000000000aa",
  caption: "Abaca table runner",
  coverImage: null,
  images: [],
  artist: ARTIST,
  category: { slug: "weaving", name: "Weaving", description: "" },
  createdAt: "2026-09-10T00:00:00.000Z",
  reactions: { love: 0, support: 0, like: 0, total: 0, mine: null },
  commentCount: 0,
  shareCount: 0,
};

const REQUEST = {
  id: "01920000-0000-7000-8000-0000000000b1",
  title: "Crochet wedding bouquet with light blue accents for a small garden wedding",
  description: "White roses with light blue accents for a small wedding in December.",
  category: { slug: "crochet", name: "Crochet", description: "" },
  minBudgetCentavos: 150_000,
  status: "open",
  images: [],
  client: CLIENT_SUMMARY,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

const PROFILE = {
  ...CLIENT_SUMMARY,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
};

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const page1 = (items: unknown[]) => json({ items, total: items.length, limit: 12, offset: 0 });

type Handler = (route: Route, path: string) => Promise<void> | undefined;

async function stubApi(page: Page, extra?: Handler) {
  const calls: string[] = [];
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      calls.push(path);
      const handled = extra?.(route, path);
      if (handled) return handled;
      if (path === "/auth/me") return route.fulfill(SIGNED_OUT);
      if (path === "/home") return route.fulfill(page1([{ kind: "request", ...REQUEST }, { kind: "post", ...POST }]));
      return route.fulfill(EMPTY_PAGE);
    },
  );
  return calls;
}

test("the home feed shows a request card beside work, without social actions", async ({ page }) => {
  await stubApi(page);
  await page.goto("/");

  const card = page.getByRole("article", { name: REQUEST.title });
  await expect(card).toBeVisible();
  await expect(card.getByText("Craft request")).toBeVisible();
  await expect(card.getByText("Crochet", { exact: true })).toBeVisible();
  await expect(card.getByText("₱1,500")).toBeVisible();
  await expect(card.getByText("Maya Dela Cruz")).toBeVisible();
  await expect(card.getByText("Iloilo City")).toBeVisible();
  await expect(card.getByRole("link", { name: "View request" })).toHaveAttribute("href", `/postings/${REQUEST.id}`);
  await expect(card.getByRole("button")).toHaveCount(0);

  // The post beside it keeps its own actions.
  await expect(page.getByText("Abaca table runner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save this post" })).toBeVisible();
});

test("the feed falls back to /feed while the API has not deployed /home yet", async ({ page }) => {
  const calls = await stubApi(page, (route, path) => {
    if (path === "/home") return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    if (path === "/feed") return route.fulfill(page1([POST]));
    return undefined;
  });
  await page.goto("/");
  await expect(page.getByText("Abaca table runner")).toBeVisible();
  expect(calls).toContain("/feed");
});

for (const width of [320, 1024]) {
  test(`a request card fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubApi(page);
    await page.goto("/");
    await expect(page.getByRole("article", { name: REQUEST.title })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a client's profile lists their requests, and hides the section when there are none", async ({ page }) => {
  let requests: unknown[] = [{ ...REQUEST, applicationCount: 2 }];
  await stubApi(page, (route, path) => {
    if (path === "/users/maya") return route.fulfill(json(PROFILE));
    if (path === "/users/maya/postings") return route.fulfill(page1(requests));
    if (path === "/users/maya/reviews") return route.fulfill(json({ items: [], total: 0, limit: 20, offset: 0 }));
    return undefined;
  });

  await page.goto("/artists/maya");
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(page.getByRole("link", { name: REQUEST.title })).toBeVisible();

  requests = [];
  await page.reload();
  await expect(page.getByRole("heading", { name: "Maya Dela Cruz" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Requests" })).toHaveCount(0);
});
