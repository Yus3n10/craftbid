import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * Chat: the conversation screen, suggestions that fill but never send, polling
 * for new messages, a closed conversation, the list, and reaching a
 * conversation from a bid.
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
const CLIENT = { ...base, id: "01920000-0000-7000-8000-000000000001", username: "maya", displayName: "Maya Dela Cruz", role: "client", email: "maya@example.com" };
const ARTIST_SUMMARY = { id: "01920000-0000-7000-8000-000000000002", username: "nena", displayName: "Nena Hooks", role: "artist", avatar: null };
const POSTING_ID = "01920000-0000-7000-8000-0000000000b1";
const CONVERSATION_ID = "01920000-0000-7000-8000-0000000000c9";

const CONVERSATION = {
  id: CONVERSATION_ID,
  posting: { id: POSTING_ID, title: "Crochet wedding bouquet" },
  otherParty: ARTIST_SUMMARY,
  myRole: "client",
  stage: "bidding",
  canSend: true,
};

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const message = (id: string, body: string, mine: boolean, createdAt: string) => ({ id, body, mine, createdAt });

type Handler = (route: Route, path: string, method: string, url: URL) => Promise<void> | undefined;

async function stubApi(page: Page, extra?: Handler) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const url = new URL(route.request().url());
      const path = apiPath(url)!;
      const method = route.request().method();
      calls.push({ method, path, search: url.search, body: route.request().postDataJSON?.() ?? null });
      const handled = extra?.(route, path, method, url);
      if (handled) return handled;
      if (path === "/auth/me") return route.fulfill(json(CLIENT));
      if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (path === "/conversations/unread") return route.fulfill(json({ unread: 0 }));
      if (/^\/(feed|posts|postings|applications\/mine|commissions)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
  return calls;
}

test.describe("a conversation", () => {
  test("says who and what it is about, sends, and picks up replies", async ({ page }) => {
    let reply = false;
    const calls = await stubApi(page, (route, path, method, url) => {
      if (path === `/conversations/${CONVERSATION_ID}`) return route.fulfill(json(CONVERSATION));
      if (path === `/conversations/${CONVERSATION_ID}/read`) return route.fulfill({ status: 204 });
      if (path === `/conversations/${CONVERSATION_ID}/messages` && method === "POST") {
        const body = (route.request().postDataJSON() as { body: string }).body;
        reply = true;
        return route.fulfill(json(message("01920000-0000-7000-8000-00000000m002", body, true, "2026-09-15T02:01:00.000Z"), 201));
      }
      if (path === `/conversations/${CONVERSATION_ID}/messages`) {
        const items = url.searchParams.get("after")
          ? reply
            ? [message("01920000-0000-7000-8000-00000000m003", "Yes, three weeks is fine 🧶", false, "2026-09-15T02:02:00.000Z")]
            : []
          : [message("01920000-0000-7000-8000-00000000m001", "Hello, thank you for bidding.", true, "2026-09-15T02:00:00.000Z")];
        return route.fulfill(json({ items }));
      }
      return undefined;
    });

    await page.goto(`/messages/${CONVERSATION_ID}`);
    await expect(page.getByRole("heading", { name: "Nena Hooks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Crochet wedding bouquet" })).toBeVisible();
    await expect(page.getByText("Hello, thank you for bidding.")).toBeVisible();
    await expect.poll(() => calls.some((call) => call.path.endsWith("/read"))).toBe(true);

    // A suggestion fills the box and is not sent.
    const suggestion = page.getByRole("list", { name: "Suggested messages" }).getByRole("button", { name: "How soon could you start?" });
    await suggestion.click();
    const box = page.getByRole("textbox", { name: "Message Nena Hooks" });
    await expect(box).toHaveValue("How soon could you start?");
    expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/messages"))).toBe(false);

    await box.fill("How soon could you start? Three weeks?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("How soon could you start? Three weeks?")).toBeVisible();
    await expect(box).toHaveValue("");

    // The next poll brings the reply, asking only for what is newer.
    await expect(page.getByText("Yes, three weeks is fine 🧶")).toBeVisible({ timeout: 12_000 });
    expect(calls.some((call) => call.method === "GET" && call.search.includes("after="))).toBe(true);
  });

  test("a closed conversation can be read but not written in", async ({ page }) => {
    await stubApi(page, (route, path) => {
      if (path === `/conversations/${CONVERSATION_ID}`) return route.fulfill(json({ ...CONVERSATION, canSend: false }));
      if (path === `/conversations/${CONVERSATION_ID}/read`) return route.fulfill({ status: 204 });
      if (path === `/conversations/${CONVERSATION_ID}/messages`) {
        return route.fulfill(json({ items: [message("01920000-0000-7000-8000-00000000m001", "Thanks for bidding.", true, "2026-09-15T02:00:00.000Z")] }));
      }
      return undefined;
    });
    await page.goto(`/messages/${CONVERSATION_ID}`);
    await expect(page.getByText("Thanks for bidding.")).toBeVisible();
    await expect(page.getByText(/the conversation is closed/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Message/ })).toHaveCount(0);
  });

  test("fits a phone, with the message box on screen", async ({ page }) => {
    // 320px: the narrowest phone the header is tested at.
    await page.setViewportSize({ width: 320, height: 700 });
    await stubApi(page, (route, path) => {
      if (path === `/conversations/${CONVERSATION_ID}`) return route.fulfill(json({ ...CONVERSATION, stage: "commission", commissionId: "01920000-0000-7000-8000-0000000000d1" }));
      if (path === `/conversations/${CONVERSATION_ID}/read`) return route.fulfill({ status: 204 });
      if (path === `/conversations/${CONVERSATION_ID}/messages`) {
        return route.fulfill(json({
          items: Array.from({ length: 20 }, (_, i) =>
            message(`01920000-0000-7000-8000-${String(i).padStart(12, "0")}`, `Message number ${i} about the yarn, the colour and the timing.`, i % 2 === 0, `2026-09-15T02:${String(i).padStart(2, "0")}:00.000Z`),
          ),
        }));
      }
      return undefined;
    });
    await page.goto(`/messages/${CONVERSATION_ID}`);
    await expect(page.getByText("Message number 19 about the yarn, the colour and the timing.")).toBeVisible();
    // Commission-stage suggestions for a client.
    await expect(page.getByRole("button", { name: "Can you send me a progress photo?" })).toBeVisible();
    // Three at most, and every one readable without scrolling sideways.
    const chips = page.getByRole("list", { name: "Suggested messages" }).getByRole("button");
    await expect(chips).toHaveCount(3);
    for (const chip of await chips.all()) {
      const box = (await chip.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await expect(page.getByRole("textbox", { name: "Message Nena Hooks" })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("the list shows who, about what, and what is unread", async ({ page }) => {
  await stubApi(page, (route, path) =>
    path === "/conversations"
      ? route.fulfill(json({
          items: [{
            id: CONVERSATION_ID,
            posting: { id: POSTING_ID, title: "Crochet wedding bouquet" },
            otherParty: ARTIST_SUMMARY,
            myRole: "client",
            lastMessage: { body: "Yes, three weeks is fine", createdAt: "2026-09-15T02:02:00.000Z", mine: false },
            unread: true,
          }],
        }))
      : undefined,
  );
  await page.goto("/messages");
  const row = page.getByRole("link", { name: /Nena Hooks/ });
  await expect(row.getByText("Crochet wedding bouquet")).toBeVisible();
  await expect(row.getByText("Yes, three weeks is fine")).toBeVisible();
  await expect(row.getByLabel("Unread")).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/messages/${CONVERSATION_ID}$`));
});

test("a client opens a conversation from a bid", async ({ page }) => {
  const opened: unknown[] = [];
  await stubApi(page, (route, path, method) => {
    if (path === `/postings/${POSTING_ID}`) {
      return route.fulfill(json({
        id: POSTING_ID, title: "Crochet wedding bouquet", description: "White roses.", category: { slug: "crochet", name: "Crochet", description: "" },
        minBudgetCentavos: 150_000, status: "open", images: [], client: { ...CLIENT, avatar: null }, applicationCount: 1,
        createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z",
      }));
    }
    if (path === `/postings/${POSTING_ID}/applications`) {
      return route.fulfill(json({
        items: [{ id: "01920000-0000-7000-8000-0000000000a1", postingId: POSTING_ID, artist: ARTIST_SUMMARY, proposedPriceCentavos: 160_000, startingBudgetCentavos: 150_000, coverLetter: "I can make this in three weeks with mercerised cotton.", status: "pending", samples: [], artistRating: { average: null, count: 0 }, createdAt: "2026-09-11T00:00:00.000Z" }],
        total: 1, limit: 20, offset: 0,
      }));
    }
    if (path === "/conversations" && method === "POST") {
      opened.push(route.request().postDataJSON());
      return route.fulfill(json(CONVERSATION));
    }
    if (path === `/conversations/${CONVERSATION_ID}`) return route.fulfill(json(CONVERSATION));
    if (path === `/conversations/${CONVERSATION_ID}/read`) return route.fulfill({ status: 204 });
    if (path === `/conversations/${CONVERSATION_ID}/messages`) return route.fulfill(json({ items: [] }));
    return undefined;
  });
  await page.goto(`/postings/${POSTING_ID}/applications`);
  await page.getByRole("button", { name: "Message Nena Hooks" }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${CONVERSATION_ID}$`));
  expect(opened).toEqual([{ postingId: POSTING_ID, artistId: ARTIST_SUMMARY.id }]);
  await expect(page.getByText("No messages yet. Say hello, or pick a suggestion below.")).toBeVisible();
});
