import { beforeEach, describe, expect, it } from "vitest";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  type Session,
} from "./helpers.js";

/**
 * Emoji, field by field.
 *
 * Allowed where people express themselves (posts, comments, display names, a
 * bid's reason) and refused where the field names a real thing that has no
 * emoji in it: the name on a bank or wallet account, a bank, a city, a link.
 * Refused by what the field is, not by banning Unicode: accented names pass.
 *
 * Each accepted value is read back to prove it survives the database intact,
 * including four-byte characters, skin tones, flags and joined sequences.
 */
const RICH = "Salamat po 🙏🏽 🇵🇭 👩‍🎨 🧶";

describe("emoji handling", () => {
  let client: Session;
  let artist: Session;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    artist = await registerUser("artist");
  });

  async function send(session: Session, method: "PUT" | "PATCH" | "POST", url: string, payload: object) {
    const app = await getTestApp();
    return app.inject({ method, url, headers: authHeaders(session), payload });
  }

  describe("allowed", () => {
    it("in a post caption and a comment, stored exactly", async () => {
      const app = await getTestApp();
      const post = await createArtistPost(artist, `Bridal bouquet ${RICH}`);
      const detail = await app.inject({ method: "GET", url: `/posts/${post.id}` });
      expect(detail.json().caption).toBe(`Bridal bouquet ${RICH}`);

      const comment = await send(client, "POST", `/posts/${post.id}/comments`, { body: RICH });
      expect(comment.statusCode).toBe(201);
      const comments = await app.inject({ method: "GET", url: `/posts/${post.id}/comments` });
      expect(comments.json()[0].body).toBe(RICH);
    });

    it("in a display name", async () => {
      const app = await getTestApp();
      const response = await send(artist, "PATCH", "/me/profile", { displayName: "Nena 🧶 Hooks" });
      expect(response.statusCode).toBe(200);
      const me = await app.inject({ method: "GET", url: "/auth/me", headers: authHeaders(artist) });
      expect(me.json().displayName).toBe("Nena 🧶 Hooks");
    });

    it("in the reason for a lower bid", async () => {
      const posting = await createPosting(client, { minBudgetCentavos: 150_000 });
      const bid = await applyToPosting(artist, posting.id, 120_000, [], `Leftover yarn ${RICH}`);
      expect(bid.statusCode).toBe(201);
      expect(bid.json().belowBudgetReason).toBe(`Leftover yarn ${RICH}`);
    });
  });

  describe("refused where the field names a real thing", () => {
    it("in the name on a payout account, while accented names pass", async () => {
      const refused = await send(artist, "PUT", "/me/payout-accounts", {
        accounts: [{ method: "gcash", accountName: "Nena 🧶 Bautista", accountNumber: "09171234567" }],
      });
      expect(refused.statusCode).toBe(400);

      const accented = await send(artist, "PUT", "/me/payout-accounts", {
        accounts: [{ method: "gcash", accountName: "María Peña-Dela Cruz Jr.", accountNumber: "09171234567" }],
      });
      expect(accented.statusCode).toBe(200);
      expect(accented.json()[0].accountName).toBe("María Peña-Dela Cruz Jr.");
    });

    it("in a bank name", async () => {
      const response = await send(artist, "PUT", "/me/payout-accounts", {
        accounts: [
          { method: "bank", bankName: "BDO 🏦", accountName: "Nena Bautista", accountNumber: "001234567890" },
        ],
      });
      expect(response.statusCode).toBe(400);
    });

    it("in an account number", async () => {
      const response = await send(artist, "PUT", "/me/payout-accounts", {
        accounts: [{ method: "gcash", accountName: "Nena Bautista", accountNumber: "0917123456🧶" }],
      });
      expect(response.statusCode).toBe(400);
    });

    it("in a city, while Parañaque passes", async () => {
      expect((await send(client, "PATCH", "/me/profile", { city: "Iloilo 🌴" })).statusCode).toBe(400);
      expect((await send(client, "PATCH", "/me/profile", { city: "Parañaque" })).statusCode).toBe(200);
    });

    it("anywhere in a contact link", async () => {
      for (const url of ["https://🧶.example.com", "https://example.com/shop/🧶", "nena🧶@example.com"]) {
        const response = await send(artist, "PUT", "/me/links", { links: [{ platform: "website", url }] });
        expect(response.statusCode, url).toBe(400);
      }
      const plain = await send(artist, "PUT", "/me/links", {
        links: [{ platform: "website", url: "https://example.com/shop" }],
      });
      expect(plain.statusCode).toBe(200);
    });
  });
});
