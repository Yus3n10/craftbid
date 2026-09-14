import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * Bids below the starting budget, notifications that read themselves, the
 * footer's feedback line, and the server's reasons shown on repeated-row forms.
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
const ARTIST = { ...base, id: "01920000-0000-7000-8000-000000000002", username: "nena", displayName: "Nena Hooks", role: "artist", email: "nena@example.com", artist: { acceptingCommissions: true, categories: [], skills: [] } };

const POSTING_ID = "01920000-0000-7000-8000-0000000000b1";
const POSTING = {
  id: POSTING_ID,
  title: "Crochet wedding bouquet",
  description: "White roses with light blue accents for a small wedding.",
  category: { slug: "crochet", name: "Crochet", description: "" },
  minBudgetCentavos: 150_000,
  status: "open",
  images: [],
  client: { id: CLIENT.id, username: "maya", displayName: "Maya Dela Cruz", role: "client", avatar: null },
  applicationCount: 1,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Handler = (route: Route, path: string, method: string) => Promise<void> | undefined;

async function stubApi(page: Page, me: object | null, extra?: Handler) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      const method = route.request().method();
      calls.push({ method, path, body: route.request().postDataJSON?.() ?? null });
      const handled = extra?.(route, path, method);
      if (handled) return handled;
      if (path === "/auth/me") return route.fulfill(me ? json(me) : SIGNED_OUT);
      if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (/^\/(feed|posts|postings|applications\/mine|commissions)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
  return calls;
}

test.describe("a bid below the starting budget", () => {
  test("the artist is asked why before it can be sent, and only then", async ({ page }) => {
    const calls = await stubApi(page, ARTIST, (route, path, method) => {
      if (path === `/postings/${POSTING_ID}` && method === "GET") return route.fulfill(json(POSTING));
      if (path === `/postings/${POSTING_ID}/applications` && method === "POST") {
        return route.fulfill(json({ id: "01920000-0000-7000-8000-0000000000a1" }, 201));
      }
      return undefined;
    });
    await page.goto(`/postings/${POSTING_ID}`);
    await expect(page.getByRole("heading", { name: "Bid on this request" })).toBeVisible();

    await page.getByLabel("Message to the client").fill("I have made bouquets like this in mercerised cotton for years.");
    await expect(page.getByLabel("Why is your price lower?")).toHaveCount(0);

    await page.getByRole("spinbutton", { name: "Your price", exact: true }).fill("1200");
    await expect(page.getByText("₱300 below the client's starting budget of ₱1,500")).toBeVisible();
    const send = page.getByRole("button", { name: "Send bid" });
    await expect(send).toBeDisabled();

    await page.getByLabel("Why is your price lower?").fill("I have the yarn already from an earlier order.");
    await expect(send).toBeEnabled();
    await send.click();

    await expect.poll(() => calls.some((call) => call.method === "POST" && call.path.endsWith("/applications"))).toBe(true);
    const sent = calls.find((call) => call.method === "POST" && call.path.endsWith("/applications"))!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ proposedPriceCentavos: 120_000, belowBudgetReason: "I have the yarn already from an earlier order." });
  });

  test("the client sees how far below, and the artist's reason, on the bid", async ({ page }) => {
    await stubApi(page, CLIENT, (route, path) => {
      if (path === `/postings/${POSTING_ID}`) return route.fulfill(json(POSTING));
      if (path === `/postings/${POSTING_ID}/applications`) {
        return route.fulfill(json({
          items: [{
            id: "01920000-0000-7000-8000-0000000000a1",
            postingId: POSTING_ID,
            artist: { id: ARTIST.id, username: "nena", displayName: "Nena Hooks", role: "artist", avatar: null },
            proposedPriceCentavos: 120_000,
            startingBudgetCentavos: 150_000,
            belowBudgetReason: "I have the yarn already from an earlier order.",
            coverLetter: "I have made bouquets like this in mercerised cotton for years.",
            status: "pending",
            samples: [],
            artistRating: { average: 4.8, count: 12 },
            createdAt: "2026-09-11T00:00:00.000Z",
          }],
          total: 1, limit: 20, offset: 0,
        }));
      }
      return undefined;
    });
    await page.goto(`/postings/${POSTING_ID}/applications`);
    await expect(page.getByText("₱300 below your starting budget of ₱1,500")).toBeVisible();
    await expect(page.getByText("I have the yarn already from an earlier order.")).toBeVisible();
  });
});

test.describe("notifications", () => {
  const ITEMS = [
    { id: "01920000-0000-7000-8000-0000000000n2", type: "application_received", payload: { postingId: POSTING_ID }, readAt: null, createdAt: "2026-09-14T09:00:00.000Z" },
    { id: "01920000-0000-7000-8000-0000000000n1", type: "review_received", payload: {}, readAt: null, createdAt: "2026-09-13T09:00:00.000Z" },
  ];

  test("opening the page marks what it shows as read, with no button to press", async ({ page }) => {
    let unread = 2;
    const calls = await stubApi(page, CLIENT, (route, path, method) => {
      if (path === "/notifications/read" && method === "POST") {
        unread = 0;
        return route.fulfill(json({ markedRead: 2 }));
      }
      if (path === "/notifications") return route.fulfill(json({ items: ITEMS, total: 2, unread, limit: 50, offset: 0 }));
      return undefined;
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/postings");
    await expect(page.getByLabel("2 unread notifications").first()).toBeVisible();

    await page.goto("/notifications");
    await expect(page.getByText("An artist bid on your craft request.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);

    await expect.poll(() => calls.filter((call) => call.path === "/notifications/read").length).toBe(1);
    expect(calls.find((call) => call.path === "/notifications/read")!.body).toEqual({ throughId: ITEMS[0]!.id });
    await expect(page.getByLabel(/unread notifications/)).toHaveCount(0);
  });

  test("nothing is sent when everything is already read", async ({ page }) => {
    const calls = await stubApi(page, CLIENT, (route, path) =>
      path === "/notifications"
        ? route.fulfill(json({ items: ITEMS.map((item) => ({ ...item, readAt: "2026-09-14T10:00:00.000Z" })), total: 2, unread: 0, limit: 50, offset: 0 }))
        : undefined,
    );
    await page.goto("/notifications");
    await expect(page.getByText("An artist bid on your craft request.")).toBeVisible();
    await page.waitForTimeout(500);
    expect(calls.some((call) => call.path === "/notifications/read")).toBe(false);
  });
});

test("the footer asks for feedback", async ({ page }) => {
  await stubApi(page, null);
  await page.goto("/postings");
  await expect(page.getByRole("contentinfo").getByText(/Craftbid is new and improving every week/)).toBeVisible();
  await expect(page.getByText(/Prices are shown in Philippine pesos/)).toHaveCount(0);
});

test("payment details say why they were refused", async ({ page }) => {
  await stubApi(page, ARTIST, (route, path, method) => {
    if (path === "/me/payout-accounts" && method === "GET") return route.fulfill(json([]));
    if (path === "/me/payout-accounts" && method === "PUT") {
      return route.fulfill(json({ error: { code: "validation_failed", message: "Please check the highlighted fields.", fields: { "accounts.0.accountName": "Emoji can't be used here." } } }, 400));
    }
    return undefined;
  });
  await page.goto("/settings#payout");
  const section = page.locator("#payout");
  await section.getByLabel("Name on the account").first().fill("Nena 🧶");
  await section.getByLabel("GCash number").fill("09171234567");
  await section.getByRole("button", { name: "Save payment details" }).click();
  await expect(section.getByText("Emoji can't be used here.")).toBeVisible();
});
