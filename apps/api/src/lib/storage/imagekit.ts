import { createHmac } from "node:crypto";
import { config } from "../../config.js";
import type { ObjectStorage } from "./index.js";

/**
 * ImageKit is the production driver: a free tier with no credit card, a CDN in
 * front, and on-the-fly transforms.
 *
 * Oracle Object Storage was the obvious alternative since the tenancy already
 * exists, but its Always Free allowance caps at 50,000 API requests a month,
 * which is roughly 1,600 image loads a day for an image-heavy marketplace with
 * no CDN in front of it. Implementing that driver is a small job if the
 * operator would rather stay inside Oracle; the port is here for exactly that.
 *
 * Uses the REST API directly rather than the official SDK, which is a
 * dependency for what amounts to two multipart POSTs.
 */
export function createImageKitStorage(
  fetchImpl: typeof fetch = fetch,
  credentials: { privateKey?: string; urlEndpoint?: string } = config.storage.imagekit,
): ObjectStorage {
  const { privateKey, urlEndpoint } = credentials;
  if (!privateKey || !urlEndpoint) {
    // config.ts already enforces this; the check keeps the types honest.
    throw new Error("ImageKit storage selected but credentials are missing.");
  }

  const authHeader = `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`;
  const base = urlEndpoint.replace(/\/$/, "");

  /**
   * One upload call for both kinds of object. A private file is the same
   * upload with `isPrivateFile`, after which ImageKit serves it only to a
   * signed URL, and the flag cannot be removed later.
   */
  async function upload(key: string, body: Buffer, contentType: string, isPrivate: boolean) {
    const slash = key.lastIndexOf("/");
    const folder = slash === -1 ? "/" : `/${key.slice(0, slash)}`;
    const fileName = slash === -1 ? key : key.slice(slash + 1);

    const form = new FormData();
    form.append("file", new Blob([body], { type: contentType }), fileName);
    form.append("fileName", fileName);
    form.append("folder", folder);
    // The key is already unique and the database records it verbatim, so
    // letting ImageKit rename the file would break every stored reference.
    form.append("useUniqueFileName", "false");
    if (isPrivate) form.append("isPrivateFile", "true");

    const response = await fetchImpl("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      headers: { Authorization: authHeader },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`ImageKit upload failed (${response.status}): ${await response.text()}`);
    }
  }

  async function remove(key: string) {
    // Deleting requires a fileId lookup by path first.
    const search = await fetchImpl(
      `https://api.imagekit.io/v1/files?path=${encodeURIComponent(key)}&limit=1`,
      { headers: { Authorization: authHeader } },
    );
    if (!search.ok) return;

    const results = (await search.json()) as { fileId?: string }[];
    const fileId = results[0]?.fileId;
    if (!fileId) return;

    await fetchImpl(`https://api.imagekit.io/v1/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });
  }

  return {
    name: "imagekit",

    put: (key, body, contentType) => upload(key, body, contentType, false),

    remove,

    urlFor(key) {
      return `${base}/${key}`;
    },

    putPrivate: (key, body, contentType) => upload(key, body, contentType, true),

    async getPrivate(key) {
      // The signed URL lives for a minute and never leaves this process: the
      // API reads the bytes and streams them to a checked participant.
      const expires = Math.floor(Date.now() / 1000) + 60;
      const response = await fetchImpl(signedUrl(base, key, privateKey, expires));
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`ImageKit private read failed (${response.status})`);
      }
      return Buffer.from(await response.arrayBuffer());
    },

    removePrivate: remove,
  };
}

/**
 * An ImageKit signed URL, per ImageKit's documented algorithm: take the URL,
 * remove the endpoint and its trailing slash, append the expiry timestamp,
 * HMAC-SHA1 that with the private key, and add `ik-t` and `ik-s` (lowercase
 * hex) as query parameters.
 */
export function signedUrl(
  urlEndpoint: string,
  key: string,
  privateKey: string,
  expiresEpochSeconds: number,
): string {
  const endpoint = urlEndpoint.replace(/\/$/, "");
  const path = key.replace(/^\//, "");
  const signature = createHmac("sha1", privateKey)
    .update(`${path}${expiresEpochSeconds}`)
    .digest("hex")
    .toLowerCase();
  return `${endpoint}/${path}?ik-t=${expiresEpochSeconds}&ik-s=${signature}`;
}
