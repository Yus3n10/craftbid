import { deflateSync, crc32 } from "node:zlib";
import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * Framing a profile picture and a cover. The saved file is checked byte for
 * byte for its real dimensions, because "the preview matches what is saved" is
 * only true if the upload is the crop itself.
 */

const ME = {
  id: "01920000-0000-7000-8000-000000000002",
  username: "nena",
  displayName: "Nena Hooks",
  role: "artist",
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
  email: "nena@example.com",
  emailVerified: true,
  isStaff: false,
  artist: { acceptingCommissions: true, categories: [], skills: [] },
};

/** A real PNG with diagonal stripes, so a crop has something to show. */
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
      const band = (x + y) % 80 < 40;
      rows[start + 1 + x * 3] = band ? 31 : 247;
      rows[start + 2 + x * 3] = band ? 58 : 244;
      rows[start + 3 + x * 3] = band ? 77 : 238;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/** The uploaded file's bytes out of a multipart body. */
function uploadedBytes(body: Buffer): Buffer {
  const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  const boundaryLine = body.subarray(0, body.indexOf("\r\n")).toString();
  const end = body.lastIndexOf(Buffer.from(`\r\n${boundaryLine}`));
  return body.subarray(start, end);
}

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stubApi(page: Page, onUpload: (size: { width: number; height: number } | null) => void, extra?: (route: Route, path: string) => Promise<void> | undefined) {
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      const handled = extra?.(route, path);
      if (handled) return handled;
      if (path === "/auth/me") return route.fulfill(json(ME));
      if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
      if (path === "/images" && route.request().method() === "POST") {
        const size = jpegSize(uploadedBytes(route.request().postDataBuffer()!));
        onUpload(size);
        return route.fulfill(json({ id: "01920000-0000-7000-8000-0000000000f9", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", width: size?.width ?? 0, height: size?.height ?? 0 }, 201));
      }
      if (path === "/me/payout-accounts") return route.fulfill(json([]));
      if (path === "/me/role-switch") return route.fulfill(json({ allowed: true, blockers: [], nextAllowedAt: null }));
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (path === "/conversations/unread") return route.fulfill(json({ unread: 0 }));
      if (/^\/(feed|posts|postings)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
}

test.describe("the crop editor", () => {
  test("a profile picture is framed in a circle, zoom is limited, and the saved file is square", async ({ page }) => {
    let uploaded: { width: number; height: number } | null = null;
    await stubApi(page, (size) => (uploaded = size));
    await page.goto("/settings");

    await page.getByLabel("Choose a profile picture").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: png(1600, 1200) });
    const dialog = page.getByRole("dialog", { name: "Frame your profile picture" });
    await expect(dialog.getByText("Other people see what is inside the circle.", { exact: false })).toBeVisible();

    // The frame is square, which is what the circle is cut from.
    const box = (await dialog.getByTestId("crop-area").boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);

    // Zoom stops where the crop would be narrower than 256 source pixels.
    const zoom = dialog.getByRole("slider", { name: "Zoom" });
    await expect(zoom).toHaveAttribute("min", "1");
    expect(Number(await zoom.getAttribute("max"))).toBeCloseTo(1200 / 256, 2);

    // Move and zoom, then save.
    await zoom.fill("2");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await dialog.getByRole("button", { name: "Use this photo" }).click();

    await expect.poll(() => uploaded).not.toBeNull();
    expect(uploaded).toEqual({ width: 512, height: 512 });
    await expect(page.getByRole("img", { name: "Your profile picture" })).toBeVisible();
  });

  test("a cover is framed at 3:1 and saved at 3:1", async ({ page }) => {
    let uploaded: { width: number; height: number } | null = null;
    await stubApi(page, (size) => (uploaded = size));
    await page.goto("/settings");

    await page.getByLabel("Choose a cover photo").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png(1200, 1600) });
    const dialog = page.getByRole("dialog", { name: "Frame your cover photo" });
    const box = (await dialog.getByTestId("crop-area").boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(3, 1);
    // A 1200-wide photo allows the crop to shrink only to 750 wide.
    expect(Number(await dialog.getByRole("slider", { name: "Zoom" }).getAttribute("max"))).toBeCloseTo(1200 / 750, 2);

    await dialog.getByRole("button", { name: "Use this photo" }).click();
    await expect.poll(() => uploaded).not.toBeNull();
    expect(uploaded).toEqual({ width: 1200, height: 400 });
  });

  test("a photo too small for a sharp picture is refused with the reason", async ({ page }) => {
    await stubApi(page, () => undefined);
    await page.goto("/settings");
    await page.getByLabel("Choose a profile picture").setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: png(200, 200) });
    const dialog = page.getByRole("dialog", { name: "Frame your profile picture" });
    await expect(dialog.getByRole("alert")).toHaveText("Choose a photo at least 256 pixels on its shortest side.");
    await expect(dialog.getByRole("button", { name: "Use this photo" })).toBeDisabled();
  });
});

test("the profile shows the cover at the same 3:1 shape the editor saves", async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await stubApi(page, () => undefined, (route, path) =>
      path === "/users/nena" ? route.fulfill(json({ ...ME, cover: { id: "01920000-0000-7000-8000-0000000000f8", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", width: 1500, height: 500 } })) : undefined,
    );
    await page.goto("/artists/nena");
    const cover = (await page.getByTestId("profile-cover").boundingBox())!;
    expect(cover.width / cover.height, `${width}px`).toBeCloseTo(3, 1);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
