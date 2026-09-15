import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { confirmEmail } from "./email.js";
import { receiptPng } from "./images.js";

/**
 * Chat on the real stack: a client messages an artist who bid, the artist sees
 * it and replies, and after the client chooses them the same conversation is
 * waiting on the commission page.
 */

const PASSWORD = "a sufficiently long password";

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** Each person in their own browser, sized for the project (desktop or phone). */
async function newPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...testInfo.project.use });
  return context.newPage();
}

async function register(page: Page, role: "client" | "artist", displayName: string): Promise<void> {
  const username = unique(role);
  const email = `${username}@example.com`;
  await page.goto("/register");
  await page
    .getByRole("radio", { name: new RegExp(role === "client" ? "I want something made" : "I make things") })
    .check({ force: true });
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmEmail(page, email);
}

test("a client and an artist talk about a bid, and carry on into the commission", async ({ browser }, testInfo) => {
  test.slow();
  const client = await newPage(browser, testInfo);
  const artist = await newPage(browser, testInfo);
  const artistName = `Nena ${Date.now().toString(36)}`;

  // --- A request and a bid ---------------------------------------------------------
  await register(client, "client", "Maya Dela Cruz");
  const title = `E2E chat bouquet ${Date.now()}`;
  await client.goto("/postings/new");
  await client.getByLabel("Title").fill(title);
  await client
    .getByLabel("Description")
    .fill("A handmade crochet bouquet for a wedding, white roses with light blue accents, about 25cm across.");
  await client.getByRole("combobox", { name: /Craft/ }).selectOption("crochet");
  await client.getByLabel("Starting budget").fill("1500");
  await client.getByRole("button", { name: "Post request" }).click();
  await expect(client.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  const postingUrl = client.url();

  await register(artist, "artist", artistName);
  await artist.goto(postingUrl);
  await artist.getByRole("spinbutton", { name: "Your price", exact: true }).fill("1800");
  await artist
    .getByLabel("Message to the client")
    .fill("I have made several bouquets in this style and would be glad to make yours in mercerised cotton.");
  await artist.getByRole("button", { name: "Send bid" }).click();
  await expect(artist.getByRole("heading", { name: "Your bid is in" })).toBeVisible({ timeout: 20_000 });

  // --- The client writes first, from the bid --------------------------------------
  await client.goto(`${postingUrl}/applications`);
  await client.getByRole("button", { name: `Message ${artistName}` }).click();
  await expect(client).toHaveURL(/\/messages\//, { timeout: 20_000 });
  const conversationUrl = client.url();
  await client.getByRole("button", { name: "How soon could you start?" }).click();
  await client.getByRole("button", { name: "Send" }).click();
  await expect(client.getByText("How soon could you start?").last()).toBeVisible();

  // --- The artist sees it and replies ------------------------------------------------
  await artist.goto("/messages");
  const row = artist.getByRole("link", { name: /Maya Dela Cruz/ });
  await expect(row.getByLabel("Unread")).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(artist.getByText("How soon could you start?")).toBeVisible();
  await artist.getByRole("textbox", { name: "Message Maya Dela Cruz" }).fill("Next week, if the blue yarn arrives in time 🧶");
  await artist.getByRole("button", { name: "Send" }).click();

  // The client's open conversation picks the reply up without a reload.
  await expect(client.getByText("Next week, if the blue yarn arrives in time 🧶")).toBeVisible({ timeout: 20_000 });

  // --- A photo of the colours, through the real upload and private storage ------------
  await artist.locator('input[type="file"]').setInputFiles({
    name: "yarn.png",
    mimeType: "image/png",
    buffer: receiptPng(90),
  });
  await expect(artist.getByRole("img", { name: "Image to send" })).toBeVisible();
  await artist.getByRole("textbox", { name: "Message Maya Dela Cruz" }).fill("The two blues side by side");
  await artist.getByRole("button", { name: "Send" }).click();
  await expect(artist.getByRole("button", { name: /Image from you/ })).toBeVisible({ timeout: 20_000 });
  await expect(client.getByRole("button", { name: `Image from ${artistName}. Open full size` })).toBeVisible({ timeout: 20_000 });

  // --- Chosen: the same conversation, now on the commission ---------------------------
  await client.goto(`${postingUrl}/applications`);
  await client.getByRole("button", { name: "Choose this artist" }).click();
  await client.getByRole("link", { name: "Open commission" }).first().click();
  await expect(client).toHaveURL(/\/commissions\//, { timeout: 20_000 });
  await client.getByRole("button", { name: `Message ${artistName}` }).click();
  await expect(client).toHaveURL(conversationUrl, { timeout: 20_000 });
  await expect(client.getByText("Next week, if the blue yarn arrives in time 🧶")).toBeVisible();
  await expect(client.getByRole("link", { name: title })).toBeVisible();
  await expect(client.getByText(/^Commission:/)).toBeVisible();
  // The photo sent while bidding still loads now that it is a commission.
  await expect(client.getByRole("button", { name: `Image from ${artistName}. Open full size` })).toBeVisible({ timeout: 20_000 });

  await Promise.all([client, artist].map((page) => page.context().close()));
});
