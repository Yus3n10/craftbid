import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  getTestApp,
  registerUser,
  resetData,
  storedObject,
  type Session,
} from "./helpers.js";

/**
 * Exercises POST /images for real, rather than inserting rows the way the
 * other suites do.
 *
 * Every other test seeds image rows directly, which is right for tests about
 * who may attach an image, but it meant nothing here had ever run: not the
 * magic-byte sniffing, not sharp, not the storage driver. An upload endpoint
 * broken in production passed CI without complaint.
 *
 * These run against the local driver, so a fault in a hosted provider's
 * credentials still will not surface here. What they do cover is everything
 * between the request and the driver, which is where the logic lives.
 */

/** Builds a multipart body by hand; inject takes a Buffer, not a FormData. */
function multipart(
  file: Buffer,
  { filename = "upload.jpg", contentType = "image/jpeg" } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----craftbidtest";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/**
 * The object key from a returned URL.
 *
 * The key is always `<ownerId>/<imageId>.<ext>`, so the last two segments are
 * it. Slicing a configured prefix off the front instead would make the test
 * depend on which base URL the environment happens to set.
 */
function storedKey(url: string): string {
  return url.split("/").slice(-2).join("/");
}

function image(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 120, b: 140 } },
  });
}

describe("image upload", () => {
  let user: Session;

  beforeEach(async () => {
    await resetData();
    user = await registerUser("client");
  });

  async function upload(
    file: Buffer,
    options?: { filename?: string; contentType?: string },
  ) {
    const app = await getTestApp();
    const { payload, headers } = multipart(file, options);
    return app.inject({
      method: "POST",
      url: "/images",
      headers: { ...headers, ...authHeaders(user) },
      payload,
    });
  }

  it("accepts a JPEG and stores it re-encoded as WebP", async () => {
    const response = await upload(await image(1200, 900).jpeg().toBuffer());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.width).toBe(1200);
    expect(body.height).toBe(900);

    // The stored bytes, not just the row: a URL that points at nothing would
    // otherwise pass.
    const stored = storedObject(storedKey(body.url));
    expect(stored, "nothing reached storage").toBeDefined();
    expect(stored!.contentType).toBe("image/webp");
    expect((await sharp(stored!.body).metadata()).format).toBe("webp");
  });

  it("strips EXIF, so an uploaded photo cannot carry its GPS location", async () => {
    // The README claims this. A camera photo carries where it was taken, and
    // handing that to strangers on a marketplace is the kind of leak nobody
    // notices until it matters.
    const withExif = await image(800, 600)
      .withExif({ IFD0: { Copyright: "Test", Make: "TestCam" } })
      .jpeg()
      .toBuffer();

    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const response = await upload(withExif);
    expect(response.statusCode).toBe(201);

    const stored = storedObject(storedKey(response.json().url));
    expect((await sharp(stored!.body).metadata()).exif).toBeUndefined();
  });

  it("rejects a file that only claims to be an image", async () => {
    // The declared Content-Type says PNG; the bytes are a shell script. Only
    // sniffing the actual bytes catches this.
    const response = await upload(Buffer.from("#!/bin/sh\necho not an image\n"), {
      filename: "payload.png",
      contentType: "image/png",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/not a JPEG, PNG or WebP/i);
  });

  it("rejects an image below the minimum dimension", async () => {
    const response = await upload(await image(40, 40).png().toBuffer());

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/at least 100/i);
  });

  it("refuses an anonymous upload", async () => {
    const app = await getTestApp();
    const { payload, headers } = multipart(await image(800, 600).jpeg().toBuffer());

    const response = await app.inject({
      method: "POST",
      url: "/images",
      headers,
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("names the stored object itself rather than trusting the filename", async () => {
    // A client-supplied name reaching a storage path is how a traversal gets
    // written outside the storage root.
    const response = await upload(await image(800, 600).jpeg().toBuffer(), {
      filename: "../../../etc/passwd.jpg",
    });

    expect(response.statusCode).toBe(201);
    const url: string = response.json().url;
    expect(url).not.toContain("..");
    expect(url).not.toContain("passwd");
    expect(storedKey(url)).toMatch(/^[0-9a-f-]+\/[0-9a-f-]+\.webp$/);
  });
});
