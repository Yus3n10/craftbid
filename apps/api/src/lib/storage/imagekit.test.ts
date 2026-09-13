import { describe, expect, it } from "vitest";
import { createImageKitStorage, signedUrl } from "./imagekit.js";

const credentials = { privateKey: "private_key_test", urlEndpoint: "https://ik.imagekit.io/craftbid/" };

/**
 * The ImageKit driver's private-file path, without calling ImageKit.
 *
 * Receipts must be uploaded as private files and read back only through a
 * signed URL. Both halves are checked against an oracle that is not this code:
 * the signatures below were computed separately with Python's hmac module over
 * the string ImageKit's documentation says to sign.
 */
describe("ImageKit private files", () => {
  it("signs a URL the way ImageKit documents, matching an independent HMAC", () => {
    // ImageKit's own example path, signed with a test key.
    expect(
      signedUrl(
        "https://ik.imagekit.io/your_imagekit_id",
        "tr:w-400:rotate-91/sample/testing-file.jpg",
        "private_key_test",
        9999999999,
      ),
    ).toBe(
      "https://ik.imagekit.io/your_imagekit_id/tr:w-400:rotate-91/sample/testing-file.jpg" +
        "?ik-t=9999999999&ik-s=0c7ba7bf7fa566808654b9dd82923b2fec6a87c7",
    );
  });

  it("signs the path relative to the endpoint, whatever slashes surround it", () => {
    const expected =
      "https://ik.imagekit.io/craftbid/commissions/abc/def.webp" +
      "?ik-t=1700000000&ik-s=d566fd918716b7307075b45f1ded99cc4066e1d3";
    expect(signedUrl("https://ik.imagekit.io/craftbid/", "commissions/abc/def.webp", "private_key_test", 1700000000)).toBe(expected);
    expect(signedUrl("https://ik.imagekit.io/craftbid", "/commissions/abc/def.webp", "private_key_test", 1700000000)).toBe(expected);
  });

  it("uploads a private object with isPrivateFile, and a public one without", async () => {
    const forms: FormData[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      forms.push(init?.body as FormData);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const storage = createImageKitStorage(fakeFetch, credentials);
    await storage.putPrivate("commissions/c1/f1.webp", Buffer.from("x"), "image/webp");
    await storage.put("users/u1/i1.webp", Buffer.from("x"), "image/webp");

    expect(forms[0]!.get("isPrivateFile")).toBe("true");
    expect(forms[0]!.get("folder")).toBe("/commissions/c1");
    expect(forms[1]!.get("isPrivateFile")).toBeNull();
  });

  it("reads a private object through a short-lived signed URL, and reports a missing one", async () => {
    const requested: string[] = [];
    const fakeFetch = (async (url: string) => {
      requested.push(url);
      return url.includes("missing")
        ? new Response("", { status: 404 })
        : new Response(Buffer.from("receipt-bytes"), { status: 200 });
    }) as typeof fetch;

    const storage = createImageKitStorage(fakeFetch, credentials);
    const before = Math.floor(Date.now() / 1000);
    const body = await storage.getPrivate("commissions/c1/f1.webp");

    expect(body?.toString()).toBe("receipt-bytes");
    const url = new URL(requested[0]!);
    // The stored original, not ImageKit's re-encoded delivery.
    expect(url.pathname).toBe("/craftbid/tr:orig-true/commissions/c1/f1.webp");
    const expires = Number(url.searchParams.get("ik-t"));
    // Good for about a minute, and never longer: the URL is only for the API.
    expect(expires - before).toBeGreaterThanOrEqual(59);
    expect(expires - before).toBeLessThanOrEqual(61);
    expect(url.searchParams.get("ik-s")).toMatch(/^[0-9a-f]{40}$/);

    expect(await storage.getPrivate("commissions/c1/missing.webp")).toBeNull();
  });

  it("signs the original-file request over the transformation and the key together", async () => {
    const requested: string[] = [];
    const fakeFetch = (async (url: string) => {
      requested.push(url);
      return new Response(Buffer.from("receipt-bytes"), { status: 200 });
    }) as typeof fetch;
    const realNow = Date.now;
    Date.now = () => 1_699_999_940_000;
    try {
      await createImageKitStorage(fakeFetch, credentials).getPrivate("commissions/c1/f1.webp");
    } finally {
      Date.now = realNow;
    }
    // Python: hmac.new(b"private_key_test", b"tr:orig-true/commissions/c1/f1.webp1700000000", sha1)
    expect(requested[0]).toBe(
      "https://ik.imagekit.io/craftbid/tr:orig-true/commissions/c1/f1.webp" +
        "?ik-t=1700000000&ik-s=620f29d63e465113a11c0c08ae696d341df871dd",
    );
  });
});
