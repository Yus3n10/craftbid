import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * What a search engine and a thumb find on a page.
 *
 * Every route names itself in the title and points a canonical link at the
 * address people are given; a page that does not exist says so and asks not to
 * be indexed. Small controls are padded to a thumb-sized tap area on a phone.
 */

const ARTIST = { id: "01920000-0000-7000-8000-000000000009", username: "lito", displayName: "Lito Weaves", role: "artist", avatar: null };

const POST = {
  id: "01920000-0000-7000-8000-0000000000aa",
  caption: "Abaca table runner",
  description: "Woven over three weeks on a floor loom.",
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
  title: "Crochet wedding bouquet",
  description: "White roses with light blue accents for a small wedding in December.",
  category: { slug: "crochet", name: "Crochet", description: "" },
  minBudgetCentavos: 150_000,
  status: "open",
  images: [],
  client: { id: "01920000-0000-7000-8000-000000000001", username: "maya", displayName: "Maya Dela Cruz", role: "client", avatar: null },
  applicationCount: 0,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

const PROFILE = {
  ...ARTIST,
  bio: "Handweaver in Miagao working in abaca and cotton.",
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
  artist: { acceptingCommissions: true, categories: [], skills: [] },
};

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const page1 = (items: unknown[]) => json({ items, total: items.length, limit: 12, offset: 0 });

type Handler = (route: Route, path: string) => Promise<void> | undefined;

async function stubApi(page: Page, extra?: Handler) {
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      const handled = extra?.(route, path);
      if (handled) return handled;
      if (path === "/auth/session") return route.fulfill(json({ user: null }));
      if (path === "/auth/me") return route.fulfill(SIGNED_OUT);
      if (path === "/home") return route.fulfill(page1([{ kind: "post", ...POST }]));
      if (path === `/postings/${REQUEST.id}`) return route.fulfill(json(REQUEST));
      if (path === `/posts/${POST.id}`) return route.fulfill(json(POST));
      if (path === "/users/lito") return route.fulfill(json(PROFILE));
      // apiPath drops the query, so the ribbon's /posts?limit=12 arrives as /posts.
      if (path === "/posts") return route.fulfill(page1([]));
      return route.fulfill(EMPTY_PAGE);
    },
  );
}

const canonical = (page: Page) =>
  page.locator('link[rel="canonical"]').getAttribute("href");
const description = (page: Page) =>
  page.locator('meta[name="description"]').getAttribute("content");

test("each route names itself in the title and canonical link", async ({ page }) => {
  await stubApi(page);

  await page.goto("/");
  await expect(page).toHaveTitle("Craftbid: commission handmade work from Filipino artists");
  expect(await canonical(page)).toBe("https://craftbid-6w5p.onrender.com/");

  await page.goto("/postings");
  await expect(page).toHaveTitle("Craft requests · Craftbid");
  expect(await canonical(page)).toBe("https://craftbid-6w5p.onrender.com/postings");

  await page.goto("/login");
  await expect(page).toHaveTitle("Sign in · Craftbid");

  await page.goto(`/postings/${REQUEST.id}`);
  await expect(page).toHaveTitle(`${REQUEST.title} · Craftbid`);
  expect(await description(page)).toBe(REQUEST.description);
  expect(await canonical(page)).toBe(`https://craftbid-6w5p.onrender.com/postings/${REQUEST.id}`);

  await page.goto("/artists/lito");
  await expect(page).toHaveTitle("Lito Weaves (@lito) · Craftbid");
  expect(await description(page)).toBe(PROFILE.bio);
});

test("the title goes back to the default on a page that sets none", async ({ page }) => {
  await stubApi(page);
  await page.goto("/postings");
  await expect(page).toHaveTitle("Craft requests · Craftbid");

  await page.getByRole("link", { name: "Craftbid home" }).click();
  await expect(page).toHaveTitle("Craftbid: commission handmade work from Filipino artists");
});

test("a page that does not exist says so, asks not to be indexed, and has a heading", async ({ page }) => {
  await stubApi(page);
  await page.goto("/no-such-page");

  await expect(page).toHaveTitle("Page not found · Craftbid");
  await expect(page.getByRole("heading", { level: 1, name: "That page does not exist" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");

  // The tag goes away again on a real page, or the whole site would be hidden.
  await page.goto("/postings");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("a piece of work has a first-level heading naming its artist", async ({ page }) => {
  await stubApi(page);
  await page.goto(`/posts/${POST.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Work by Lito Weaves" })).toBeAttached();
  await expect(page).toHaveTitle("Work by Lito Weaves · Craftbid");
});

test("the moving ribbon can be stopped and started", async ({ page }) => {
  await stubApi(page, (route, path) => {
    if (path === "/posts") {
      const items = Array.from({ length: 6 }, (_, i) => ({
        ...POST,
        id: `01920000-0000-7000-8000-0000000000${20 + i}`,
        coverImage: { id: `img${i}`, url: "/icon-192.png", width: 192, height: 192 },
      }));
      return route.fulfill(page1(items));
    }
    return undefined;
  });
  await page.goto("/");

  const pause = page.getByRole("button", { name: "Pause the moving work ribbon" });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole("button", { name: "Play the moving work ribbon" })).toBeVisible();
  await expect(page.locator(".ribbon")).toHaveAttribute("data-paused", "true");
});

test("small controls are a thumb-sized target on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubApi(page);
  await page.goto("/");

  const targets = [
    page.getByRole("link", { name: "See all" }),
    page.getByRole("contentinfo").getByRole("link", { name: "Post a request" }),
    page.getByRole("contentinfo").getByRole("link", { name: "Browse work" }),
    page.getByRole("contentinfo").getByRole("link", { name: "Find commissions" }),
    page.getByRole("contentinfo").getByRole("link", { name: "Create a portfolio" }),
  ];
  for (const target of targets) {
    const box = await target.first().boundingBox();
    expect(box, `${await target.first().innerText()} has no box`).not.toBeNull();
    expect(box!.height, `${await target.first().innerText()} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
  }

  await page.goto("/login");
  const checkbox = page.getByText("Keep me logged in");
  const box = await checkbox.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("long feed text is capped at a readable width on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await stubApi(page, (route, path) => {
    if (path === "/home") {
      return route.fulfill(page1([{ kind: "post", ...POST, caption: "Abaca ".repeat(60).trim() }]));
    }
    return undefined;
  });
  await page.goto("/");
  const caption = page.locator("article p").filter({ hasText: "Abaca" }).first();
  await expect(caption).toBeVisible();

  const { width, characterWidth } = await caption.evaluate((element) => {
    const probe = document.createElement("span");
    probe.textContent = "0";
    element.appendChild(probe);
    const measured = probe.getBoundingClientRect().width;
    probe.remove();
    return { width: element.getBoundingClientRect().width, characterWidth: measured };
  });
  expect(width).toBeGreaterThan(0);
  expect(width / characterWidth).toBeLessThanOrEqual(76);
});
