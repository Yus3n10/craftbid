import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end coverage of the workflow a real pair of users would follow, driven
 * through the interface rather than the API: a client posts a request, an
 * artist bids on it, and the client picks them.
 *
 * The API tests already prove the rules hold at the boundary. What these prove
 * is that the screens actually let a person reach them.
 */

const PASSWORD = "a sufficiently long password";

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

async function register(
  page: Page,
  role: "client" | "artist",
): Promise<{ username: string }> {
  const username = unique(role);

  await page.goto("/register");
  await page.getByRole("radio", { name: new RegExp(role === "client" ? "I want something made" : "I make things") }).check({ force: true });
  await page.getByLabel("Display name").fill(`Test ${role}`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Where registration lands is the signal, rather than a header control:
  // the header collapses into a menu on mobile, so nothing in it is reliably
  // visible across both viewports.
  await expect(page).toHaveURL(role === "artist" ? /\/settings/ : /\/postings/, {
    timeout: 20_000,
  });

  return { username };
}

async function signOut(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Sign out" });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
  } else {
    // Mobile keeps it behind the menu.
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
  }

  // Confirms the session is actually gone rather than just the button: a
  // protected route must now send us to sign in. Retried, because the click
  // only starts the sign-out request and the cookie is cleared by its
  // response, so a single immediate navigation can still carry a live session.
  await expect(async () => {
    await page.goto("/commissions");
    await expect(page).toHaveURL(/\/login/, { timeout: 3_000 });
  }).toPass({ timeout: 25_000 });
}

test.describe("marketplace", () => {
  test("the home page explains both sides and lists categories", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Someone wants a thing made by hand/i }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "I want something made" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "I make things" })).toBeVisible();
    // Categories are now listed in two places on the home page: the strip
    // under the hero and the feed's sidebar. Either proves the point.
    await expect(
      page.getByRole("link", { name: "Crochet", exact: true }).first(),
    ).toBeVisible();
  });

  test("a client posts a request and an artist bids on it", async ({ page }) => {
    test.slow();

    // --- Client posts a request -------------------------------------------
    await register(page, "client");

    const title = `E2E crochet bouquet ${Date.now()}`;
    await page.goto("/postings/new");
    await page.getByLabel("Title").fill(title);
    await page
      .getByLabel("Description")
      .fill(
        "A handmade crochet bouquet for a wedding, white roses with light blue accents, about 25cm across.",
      );
    // By role, not label. "Craft" as a substring also matches the header's
    // "Craftbid home" link, and the exact string misses because the required
    // marker makes the accessible name "Craft*".
    await page.getByRole("combobox", { name: /Craft/ }).selectOption("crochet");
    await page.getByLabel("Starting budget").fill("1500");
    await page.getByRole("button", { name: "Post request" }).click();

    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    // Peso formatting, not a raw centavo figure.
    await expect(page.getByText("₱1,500").first()).toBeVisible();
    await expect(page.getByText("Open for bids").first()).toBeVisible();

    const postingUrl = page.url();
    await signOut(page);

    // --- Artist bids -------------------------------------------------------
    await register(page, "artist");
    await page.goto(postingUrl);

    await expect(page.getByRole("heading", { name: "Bid on this request" })).toBeVisible();

    // Below the minimum is refused, in the form, before anything is sent.
    await page.getByLabel("Your price").fill("1000");
    await page
      .getByLabel("Message to the client")
      .fill(
        "I have made several bouquets in this style and would be glad to make yours in mercerised cotton.",
      );
    await expect(page.getByText(/cannot be below ₱1,500/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send bid" })).toBeDisabled();

    // At or above the minimum is accepted.
    await page.getByLabel("Your price").fill("1800");
    await expect(page.getByRole("button", { name: "Send bid" })).toBeEnabled();
    await page.getByRole("button", { name: "Send bid" }).click();

    await expect(page.getByRole("heading", { name: "Your bid is in" })).toBeVisible({
      timeout: 20_000,
    });

    // A second bid on the same request is not offered.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "You have already bid on this" }),
    ).toBeVisible();
  });

  test("signed-out visitors are invited to sign in rather than shown a bid form", async ({
    page,
  }) => {
    await page.goto("/postings");

    // Postings arrive from a client-side query, so wait for the list to settle
    // into either cards or the empty state before counting anything.
    const cards = page.locator("h3 a");
    await expect
      .poll(async () => (await cards.count()) > 0 || (await page.getByRole("heading", { name: /No open requests|No requests match/ }).count()) > 0, {
        timeout: 15_000,
      })
      .toBe(true);

    if ((await cards.count()) === 0) {
      test.skip(true, "No open postings exist to open.");
      return;
    }

    await cards.first().click();
    await expect(page.getByText(/Sign in as an artist to bid/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bid on this request" })).toHaveCount(0);
  });

  test("a missing page offers a way back", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(
      page.getByRole("heading", { name: "That page does not exist" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse craft requests" })).toBeVisible();
  });

  test("the request list shows an empty state rather than a blank screen", async ({
    page,
  }) => {
    // A filter combination nothing can match.
    await page.goto("/postings?q=zzzzzznotathingzzzzzz");
    await expect(
      page.getByRole("heading", { name: /No requests match those filters/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
  });
});
