import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { confirmEmail } from "./email.js";
import { receiptPng } from "./images.js";

/**
 * A commission from bid to completion through the payment record, driven the
 * way two real people would: the client and the artist each in their own
 * browser, taking turns, against the real API and database.
 *
 * The API tests prove each rule. This proves a person can actually get
 * through the screens: find where to pay, send the details with a receipt,
 * see the artist confirm, the piece finished and sent, pay the rest once it
 * arrives, and finish.
 */

const PASSWORD = "a sufficiently long password";

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}


async function newPerson(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...testInfo.project.use });
  return context.newPage();
}

async function register(page: Page, role: "client" | "artist"): Promise<void> {
  const username = unique(role);
  await page.goto("/register");
  await page
    .getByRole("radio", { name: new RegExp(role === "client" ? "I want something made" : "I make things") })
    .check({ force: true });
  await page.getByLabel("Display name").fill(`Pay ${role}`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmEmail(page, `${username}@example.com`);
  await page.goto(role === "artist" ? "/settings" : "/postings");
}

/** A reference number no earlier run has used, since Craftbid refuses a repeat. */
function uniqueReference(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.slice(-16);
}

async function sendPaymentDetails(page: Page, reference: string, receipt: Buffer): Promise<void> {
  // Scoped to the payment form: once a payment exists, the history lists a
  // receipt thumbnail that is also, correctly, named "Receipt".
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Send payment details" }) });
  await form.getByLabel("Reference number").fill(reference);
  await form.getByLabel("Receipt").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: receipt });
  await expect(page.getByRole("img", { name: "Your receipt" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Send payment details" }).click();
}

test("a commission goes from a bid to complete through the payment record", async ({ page, browser }, testInfo) => {
  test.slow();
  const client = page;
  const artist = await newPerson(browser, testInfo);

  // --- The artist says where to be paid ------------------------------------
  await register(artist, "artist");
  await artist.getByLabel("GCash number").fill("0917 123 4567");
  await artist.getByLabel("Name on the account").first().fill("Nena Hooks");
  await artist.getByRole("button", { name: "Save payment details" }).click();
  await expect(artist.getByText("Saved.")).toBeVisible();

  // --- The client posts a request, the artist bids, the client chooses -----
  await register(client, "client");
  const title = `E2E payment bouquet ${Date.now()}`;
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

  await artist.goto(postingUrl);
  await artist.getByLabel("Your price").fill("2000");
  await artist
    .getByLabel("Message to the client")
    .fill("I have made several bouquets in this style and would be glad to make yours in mercerised cotton.");
  await artist.getByRole("button", { name: "Send bid" }).click();
  await expect(artist.getByRole("heading", { name: "Your bid is in" })).toBeVisible({ timeout: 20_000 });

  await client.goto(`${postingUrl}/applications`);
  await client.getByRole("button", { name: "Choose this artist" }).click();
  await client.getByRole("link", { name: "Open commission" }).first().click();
  await expect(client).toHaveURL(/\/commissions\//, { timeout: 20_000 });
  const commissionUrl = client.url();

  // --- The down payment -----------------------------------------------------
  await expect(client.getByText("₱1,000.00").first()).toBeVisible();
  await expect(client.getByText("09171234567")).toBeVisible();
  const downReference = uniqueReference();
  await sendPaymentDetails(client, downReference, receiptPng(20));
  await expect(client.getByText(/Waiting for the artist to confirm your down payment/)).toBeVisible({ timeout: 20_000 });

  await artist.goto(commissionUrl);
  await expect(artist.getByText("Check before you confirm")).toBeVisible();
  await expect(artist.getByText(downReference).first()).toBeVisible();
  await artist.getByRole("button", { name: "Yes, I received it" }).click();

  // --- The work: finished without photos, then sent --------------------------------
  await expect(artist.getByRole("button", { name: "The piece is finished" })).toBeEnabled({ timeout: 20_000 });
  await artist.getByRole("button", { name: "The piece is finished" }).click();
  await artist.getByLabel("Courier").fill("J&T Express");
  await artist.getByLabel("Tracking number").fill("JT0001234567");
  await artist.getByRole("button", { name: "It has been sent" }).click();
  await expect(artist.getByText(/Waiting for the client to receive the piece/)).toBeVisible({ timeout: 20_000 });

  // --- The balance, once it arrives ----------------------------------------------------
  await client.reload();
  await expect(client.getByText(/Once your piece arrives/)).toBeVisible({ timeout: 20_000 });
  await expect(client.getByText("JT0001234567")).toBeVisible();
  await expect(client.getByText(/photos/i)).toHaveCount(0);
  await sendPaymentDetails(client, uniqueReference(), receiptPng(200));
  await expect(client.getByText(/Waiting for the artist to confirm your balance/)).toBeVisible({ timeout: 20_000 });

  await artist.reload();
  await artist.getByRole("button", { name: "Yes, I received it" }).click();
  await expect(artist.getByText(/Waiting for the client to confirm they received the piece/)).toBeVisible({ timeout: 20_000 });

  // --- Complete -----------------------------------------------------------------
  await client.reload();
  await client.getByRole("button", { name: "I received the piece" }).click();
  await expect(client.getByRole("heading", { name: "Leave a review" })).toBeVisible({ timeout: 20_000 });
  await expect(client.getByText("Received").first()).toBeVisible();

  await artist.context().close();
});
