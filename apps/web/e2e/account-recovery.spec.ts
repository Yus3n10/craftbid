import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { confirmEmail, signOutThroughMenu } from "./email.js";

/**
 * A forgotten password, through the real API and its email outbox: ask for a
 * link, open it from the "inbox", set a new password, sign in with it.
 */

const OUTBOX = resolve(dirname(fileURLToPath(import.meta.url)), "../../api/.outbox");
const PASSWORD = "a sufficiently long password";
const NEW_PASSWORD = "a brand new long passphrase";

async function resetLink(email: string): Promise<string | null> {
  const files = await readdir(OUTBOX).catch(() => [] as string[]);
  for (const file of files.sort().reverse()) {
    const message = JSON.parse(await readFile(join(OUTBOX, file), "utf8")) as { to: string; text: string };
    if (message.to !== email) continue;
    const match = message.text.match(/https?:\/\/\S+\/reset-password\?token=[A-Za-z0-9_-]+/);
    if (match) return match[0];
  }
  return null;
}

test("someone who forgot their password gets back in through the emailed link", async ({ page }) => {
  test.slow();
  const username = `reset${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const email = `${username}@example.com`;

  await page.goto("/register");
  await page.getByRole("radio", { name: /I want something made/ }).check({ force: true });
  await page.getByLabel("Display name").fill("Reset Test");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmEmail(page, email);
  await signOutThroughMenu(page);

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  // The sign-in page has an Email box too; filling before the reset page has
  // replaced it types into the page that is about to go away.
  await expect(page.getByRole("heading", { name: "Reset your password", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText(`If ${email} has a Craftbid account`);

  let link: string | null = null;
  await expect(async () => {
    link = await resetLink(email);
    expect(link).not.toBeNull();
  }).toPass({ timeout: 15_000 });

  const url = new URL(link!);
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByRole("heading", { name: "Choose a new password", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "New password", exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Your password is changed" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Account and settings|Menu/ }).first()).toBeVisible();
});
