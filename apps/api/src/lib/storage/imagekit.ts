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
export function createImageKitStorage(): ObjectStorage {
  const { privateKey, urlEndpoint } = config.storage.imagekit;
  if (!privateKey || !urlEndpoint) {
    // config.ts already enforces this; the check keeps the types honest.
    throw new Error("ImageKit storage selected but credentials are missing.");
  }

  const authHeader = `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`;
  const base = urlEndpoint.replace(/\/$/, "");

  return {
    name: "imagekit",

    async put(key, body, contentType) {
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

      const response = await fetch(
        "https://upload.imagekit.io/api/v1/files/upload",
        { method: "POST", headers: { Authorization: authHeader }, body: form },
      );

      if (!response.ok) {
        throw new Error(
          `ImageKit upload failed (${response.status}): ${await response.text()}`,
        );
      }
    },

    async remove(key) {
      // Deleting requires a fileId lookup by path first.
      const search = await fetch(
        `https://api.imagekit.io/v1/files?path=${encodeURIComponent(key)}&limit=1`,
        { headers: { Authorization: authHeader } },
      );
      if (!search.ok) return;

      const results = (await search.json()) as { fileId?: string }[];
      const fileId = results[0]?.fileId;
      if (!fileId) return;

      await fetch(`https://api.imagekit.io/v1/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });
    },

    urlFor(key) {
      return `${base}/${key}`;
    },
  };
}
