import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { confirmEmail } from "./email.js";
import { receiptPng } from "./images.js";

/**
 * The moderation loop through the real stack: someone reports a post, staff
 * remove it from the admin screen, it leaves the feed, and the artist is told
 * which rule it broke. Staff access is granted with the real CLI, so this also
 * proves nothing on the website can grant it.
 */

const PASSWORD = "a sufficiently long password";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** Each person in their own browser, sized for the project (desktop or phone). */
async function newPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...testInfo.project.use });
  return context.newPage();
}

async function register(page: Page, role: "client" | "artist"): Promise<{ username: string; email: string }> {
  const username = unique(role);
  const email = `${username}@example.com`;
  await page.goto("/register");
  await page
    .getByRole("radio", { name: new RegExp(role === "client" ? "I want something made" : "I make things") })
    .check({ force: true });
  await page.getByLabel("Display name").fill(`Test ${role}`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmEmail(page, email);
  return { username, email };
}

test("a reported post is removed from the admin screen and the artist is told why", async ({ browser }, testInfo) => {
  test.slow();
  const artist = await newPage(browser, testInfo);
  const client = await newPage(browser, testInfo);
  const staff = await newPage(browser, testInfo);

  // --- An artist posts a piece ------------------------------------------------
  const artistAccount = await register(artist, "artist");
  const caption = `E2E reported piece ${Date.now()}`;
  await artist.goto("/posts/new");
  await artist
    .locator('input[type="file"]')
    .setInputFiles({ name: "piece.png", mimeType: "image/png", buffer: receiptPng(90) });
  await expect(artist.getByRole("button", { name: "Remove this image" })).toBeVisible({ timeout: 20_000 });
  await artist.getByLabel("Caption").fill(caption);
  await artist.getByRole("button", { name: "Add to portfolio" }).click();
  await expect(artist).toHaveURL(new RegExp(`/artists/${artistAccount.username}`), { timeout: 20_000 });

  // --- A client reports it --------------------------------------------------------
  await register(client, "client");
  await client.goto("/");
  const card = client.getByRole("article").filter({ hasText: caption });
  await card.getByRole("button", { name: "More options for this post" }).click();
  await card.getByRole("button", { name: "Report", exact: true }).click();
  const reportDialog = client.getByRole("dialog", { name: "Report this post" });
  await reportDialog.getByRole("radio", { name: "It's stolen work" }).check();
  await reportDialog.getByRole("button", { name: "Send report" }).click();
  await expect(reportDialog.getByText("Thanks. Craftbid will review it.")).toBeVisible();

  // --- Staff remove it --------------------------------------------------------------
  const staffAccount = await register(staff, "client");
  execSync(`pnpm --filter @craftbid/api staff grant ${staffAccount.email}`, { cwd: repoRoot, stdio: "pipe" });
  await staff.goto("/admin?tab=reports");
  const report = staff.getByRole("article", { name: new RegExp(caption) });
  await report.getByRole("button", { name: "Remove post" }).click();
  const removeDialog = staff.getByRole("dialog", { name: "Remove this post" });
  await removeDialog.getByLabel("Rule").selectOption("stolen_work");
  await removeDialog.getByRole("button", { name: "Remove post" }).click();
  await expect(report).toHaveCount(0, { timeout: 20_000 });

  // --- It is gone, and the artist knows why ----------------------------------------
  await client.goto("/");
  await expect(client.getByText(caption)).toHaveCount(0);
  await artist.goto("/notifications");
  await expect(artist.getByText(/We removed your post/)).toBeVisible({ timeout: 20_000 });
  await expect(artist.getByText(/Stolen work/).first()).toBeVisible();

  // Signed-in pages left open keep polling the API into the next test.
  await Promise.all([artist, client, staff].map((page) => page.context().close()));
});
