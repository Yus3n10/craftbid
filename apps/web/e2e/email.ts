import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/**
 * The inbox, for the browser tests.
 *
 * The API runs here with MAIL_DRIVER=outbox, which writes every email it would
 * send to a JSON file instead. Reading the link from there and opening it is
 * the same path a person takes from their inbox, with nothing in the app
 * special-cased for tests.
 */
const OUTBOX = resolve(dirname(fileURLToPath(import.meta.url)), "../../api/.outbox");

async function findLink(email: string): Promise<string | null> {
  const files = await readdir(OUTBOX).catch(() => [] as string[]);
  for (const file of files.sort().reverse()) {
    const message = JSON.parse(await readFile(join(OUTBOX, file), "utf8")) as { to: string; text: string };
    if (message.to !== email) continue;
    const match = message.text.match(/https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_-]+/);
    if (match) return match[0];
  }
  return null;
}

/** After "Create account": opens the emailed link and lands signed in. */
export async function confirmEmail(page: Page, email: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 20_000 });

  let link: string | null = null;
  await expect(async () => {
    link = await findLink(email);
    expect(link).not.toBeNull();
  }).toPass({ timeout: 15_000 });

  const url = new URL(link!);
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByText("Your email is confirmed.")).toBeVisible({ timeout: 20_000 });
}

/** Signing out through the account menu (or the phone menu) and its confirmation. */
export async function signOutThroughMenu(page: Page): Promise<void> {
  const cog = page.getByRole("button", { name: "Account and settings" });
  if (await cog.isVisible().catch(() => false)) {
    await cog.click();
  } else {
    await page.getByRole("button", { name: "Menu" }).click();
  }
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog", { name: "Sign out of Craftbid?" }).getByRole("button", { name: "Sign out" }).click();
}
