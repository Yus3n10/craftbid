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
      let body: unknown = null;
      try {
        body = route.request().postDataJSON?.() ?? null;
      } catch {
        // An image upload is multipart, not JSON.
      }
      calls.push({ method, path, search: url.search, body });
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

test.describe("images in a conversation", () => {
  const FILE_ID = "01920000-0000-7000-8000-0000000000f1";
  const PIXEL = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  /** Width and height of a WebP inside a multipart body, or null when there is none. */
  function webpSize(body: Buffer): { width: number; height: number } | null {
    const riff = body.indexOf("RIFF");
    if (riff < 0 || body.toString("ascii", riff + 8, riff + 12) !== "WEBP") return null;
    const chunk = body.toString("ascii", riff + 12, riff + 16);
    // Extended format, which browsers write when they embed a colour profile:
    // the canvas size is stored as width-1 and height-1 in three bytes each.
    if (chunk === "VP8X") {
      return { width: body.readUIntLE(riff + 24, 3) + 1, height: body.readUIntLE(riff + 27, 3) + 1 };
    }
    if (chunk === "VP8 ") {
      return { width: body.readUInt16LE(riff + 26) & 0x3fff, height: body.readUInt16LE(riff + 28) & 0x3fff };
    }
    return null;
  }

  /** A large PNG drawn in the page and pasted into the box, as a copied photo arrives. */
  async function pastePhoto(page: Page) {
    await page.getByRole("textbox", { name: "Message Nena Hooks" }).evaluate(async (box) => {
      const canvas = document.createElement("canvas");
      canvas.width = 3000;
      canvas.height = 2000;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#b47a5a";
      context.fillRect(0, 0, 3000, 2000);
      context.fillStyle = "#1f3a4d";
      context.fillRect(400, 300, 1200, 900);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "photo.png", { type: "image/png" }));
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
  }

  async function stubImages(page: Page, sent: { upload?: Buffer; message?: unknown }) {
    return stubApi(page, (route, path, method) => {
      if (path === `/conversations/${CONVERSATION_ID}`) return route.fulfill(json(CONVERSATION));
      if (path === `/conversations/${CONVERSATION_ID}/read`) return route.fulfill({ status: 204 });
      if (path === `/conversations/${CONVERSATION_ID}/files` && method === "POST") {
        sent.upload = route.request().postDataBuffer() ?? undefined;
        return route.fulfill(json({ fileId: FILE_ID, width: 1600, height: 1067 }, 201));
      }
      if (path === `/conversations/${CONVERSATION_ID}/messages` && method === "POST") {
        const body = route.request().postDataJSON() as { body?: string; fileId?: string };
        sent.message = body;
        return route.fulfill(
          json(
            {
              id: "01920000-0000-7000-8000-00000000m009",
              body: body.body ?? "",
              mine: true,
              createdAt: "2026-09-15T03:00:00.000Z",
              image: { fileId: FILE_ID, width: 1600, height: 1067 },
            },
            201,
          ),
        );
      }
      if (path === `/conversations/${CONVERSATION_ID}/messages`) return route.fulfill(json({ items: [] }));
      if (path === `/conversations/${CONVERSATION_ID}/files/${FILE_ID}`) {
        return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
      }
      return undefined;
    });
  }

  test("a pasted photo is shrunk before upload, then sent as an image", async ({ page }) => {
    const sent: { upload?: Buffer; message?: unknown } = {};
    await stubImages(page, sent);
    await page.goto(`/messages/${CONVERSATION_ID}`);
    const send = page.getByRole("button", { name: "Send" });
    await expect(send).toBeDisabled();

    await pastePhoto(page);
    await expect(page.getByRole("img", { name: "Image to send" })).toBeVisible();
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByRole("button", { name: /Image from you/ })).toBeVisible();
    expect(sent.upload && webpSize(sent.upload)).toEqual({ width: 1600, height: 1067 });
    expect(sent.message).toEqual({ fileId: FILE_ID });
    await expect(page.getByRole("img", { name: "Image to send" })).toHaveCount(0);
  });

  test("an attached photo goes with the text typed beside it, and can be removed first", async ({ page }) => {
    const sent: { upload?: Buffer; message?: unknown } = {};
    await stubImages(page, sent);
    await page.goto(`/messages/${CONVERSATION_ID}`);

    const png = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 600;
        canvas.getContext("2d")!.fillRect(0, 0, 800, 600);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
        return [...new Uint8Array(await blob.arrayBuffer())];
      }),
    );
    const chooser = page.locator('input[type="file"]');
    await chooser.setInputFiles({ name: "yarn.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("img", { name: "Image to send" })).toBeVisible();

    await page.getByRole("button", { name: "Remove image" }).click();
    await expect(page.getByRole("img", { name: "Image to send" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

    await chooser.setInputFiles({ name: "yarn.png", mimeType: "image/png", buffer: png });
    await page.getByRole("textbox", { name: "Message Nena Hooks" }).fill("These are the two colours");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => sent.message).toEqual({ fileId: FILE_ID, body: "These are the two colours" });
    await expect(page.getByText("These are the two colours")).toBeVisible();
  });

  test("a received image loads privately and opens full size", async ({ page }) => {
    await stubApi(page, (route, path) => {
      if (path === `/conversations/${CONVERSATION_ID}`) return route.fulfill(json(CONVERSATION));
      if (path === `/conversations/${CONVERSATION_ID}/read`) return route.fulfill({ status: 204 });
      if (path === `/conversations/${CONVERSATION_ID}/messages`) {
        return route.fulfill(
          json({
            items: [
              {
                id: "01920000-0000-7000-8000-00000000m010",
                body: "",
                mine: false,
                createdAt: "2026-09-15T03:00:00.000Z",
                image: { fileId: FILE_ID, width: 1600, height: 1067 },
              },
            ],
          }),
        );
      }
      if (path === `/conversations/${CONVERSATION_ID}/files/${FILE_ID}`) {
        return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
      }
      return undefined;
    });
    await page.goto(`/messages/${CONVERSATION_ID}`);
    const thumbnail = page.getByRole("button", { name: /Image from Nena Hooks/ });
    await expect(thumbnail).toBeVisible();
    await thumbnail.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("a photo waiting to be sent fits a 320px phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await stubImages(page, {});
    await page.goto(`/messages/${CONVERSATION_ID}`);
    await pastePhoto(page);
    await expect(page.getByRole("img", { name: "Image to send" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Nena Hooks" })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a closed conversation offers no way to attach", async ({ page }) => {
    await stubApi(page, (route, path) => {
      if (path === `/conversations/${CONVERSATION_ID}`) return route.fulfill(json({ ...CONVERSATION, canSend: false }));
      if (path === `/conversations/${CONVERSATION_ID}/read`) return route.fulfill({ status: 204 });
      if (path === `/conversations/${CONVERSATION_ID}/messages`) return route.fulfill(json({ items: [] }));
      return undefined;
    });
    await page.goto(`/messages/${CONVERSATION_ID}`);
    await expect(page.getByText(/the conversation is closed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Attach an image" })).toHaveCount(0);
  });
});

test("the list says when the last message was a photo", async ({ page }) => {
  await stubApi(page, (route, path) =>
    path === "/conversations"
      ? route.fulfill(
          json({
            items: [
              {
                id: CONVERSATION_ID,
                posting: { id: POSTING_ID, title: "Crochet wedding bouquet" },
                otherParty: ARTIST_SUMMARY,
                myRole: "client",
                lastMessage: { body: "", createdAt: "2026-09-15T02:02:00.000Z", mine: false, hasImage: true },
                unread: false,
              },
            ],
          }),
        )
      : undefined,
  );
  await page.goto("/messages");
  await expect(page.getByRole("link", { name: /Nena Hooks/ }).getByText("Sent a photo")).toBeVisible();
});
