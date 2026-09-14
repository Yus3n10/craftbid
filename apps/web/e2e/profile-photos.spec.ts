import { deflateSync, crc32 } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { confirmEmail } from "./email.js";

/**
 * A profile picture and cover framed in the editor, uploaded through the real
 * image pipeline, accepted by the server's shape check, and shown on the
 * profile at the shape they were framed in.
 */

const PASSWORD = "a sufficiently long password";

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const band = (x * 2 + y) % 90 < 45;
      rows[start + 1 + x * 3] = band ? 168 : 62;
      rows[start + 2 + x * 3] = band ? 84 : 92;
      rows[start + 3 + x * 3] = band ? 52 : 107;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function register(page: Page): Promise<string> {
  const username = `artist${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  await page.goto("/register");
  await page.getByRole("radio", { name: /I make things/ }).check({ force: true });
  await page.getByLabel("Display name").fill("Photo Test Artist");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmEmail(page, `${username}@example.com`);
  return username;
}

test("a framed profile picture and cover are saved and shown at their shapes", async ({ page }) => {
  test.slow();
  const username = await register(page);
  await page.goto("/settings");

  await page.getByLabel("Choose a profile picture").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: png(1400, 1000) });
  await page.getByRole("dialog", { name: "Frame your profile picture" }).getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByRole("img", { name: "Your profile picture" })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Choose a cover photo").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png(2000, 1100) });
  await page.getByRole("dialog", { name: "Frame your cover photo" }).getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByRole("img", { name: "Your cover photo" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible({ timeout: 20_000 });

  await page.goto(`/artists/${username}`);
  const cover = page.getByTestId("profile-cover").locator("img");
  await expect(cover).toBeVisible();
  // The stored cover is 3:1 itself, not a different image cropped by CSS.
  const natural = await cover.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(natural).toBeCloseTo(3, 1);

  const avatar = page.getByRole("heading", { name: "Photo Test Artist" }).locator("xpath=ancestor::div[2]").locator("img").first();
  const avatarRatio = await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(avatarRatio).toBeCloseTo(1, 2);
});
