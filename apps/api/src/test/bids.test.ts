import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { newId, uuidToBuf } from "../db/ids.js";
import {
  applyToPosting,
  authHeaders,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  type Session,
} from "./helpers.js";

/**
 * Bids below the client's starting budget.
 *
 * A client can set a starting budget higher than the work needs, so an artist
 * may bid under it, but only with a reason the client can read. The bid stays
 * as private as any other: its price and reason are for that client and that
 * artist alone.
 */
describe("bids below the starting budget", () => {
  let client: Session;
  let artist: Session;
  let rival: Session;
  let postingId: string;

  const REASON = "I already have the cotton yarn from an earlier piece, so materials cost less.";

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    artist = await registerUser("artist");
    rival = await registerUser("artist");
    postingId = (await createPosting(client, { minBudgetCentavos: 150_000 })).id;
  });

  it("accepts a lower bid that says why, and shows both to the client", async () => {
    const app = await getTestApp();
    const bid = await applyToPosting(artist, postingId, 120_000, [], REASON);
    expect(bid.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: `/postings/${postingId}/applications`,
      headers: authHeaders(client),
    });
    expect(list.json().items[0]).toMatchObject({
      proposedPriceCentavos: 120_000,
      startingBudgetCentavos: 150_000,
      belowBudgetReason: REASON,
    });
  });

  it("refuses a lower bid without a reason, or with only whitespace", async () => {
    for (const reason of [undefined, "", "     "]) {
      const response = await applyToPosting(artist, postingId, 149_999, [], reason);
      expect(response.statusCode, JSON.stringify(reason)).toBe(400);
      expect(response.json().error.fields.belowBudgetReason).toBeDefined();
    }
  });

  it("refuses a reason longer than 500 characters", async () => {
    const response = await applyToPosting(artist, postingId, 120_000, [], "x".repeat(501));
    expect(response.statusCode).toBe(400);
  });

  it("does not ask for a reason at or above the starting budget, and keeps none", async () => {
    const app = await getTestApp();
    expect((await applyToPosting(artist, postingId, 150_000)).statusCode).toBe(201);
    // A reason left over from an earlier, lower price is dropped, not stored.
    const second = await applyToPosting(rival, postingId, 180_000, [], "Typed this before raising my price.");
    expect(second.statusCode).toBe(201);
    expect(second.json().belowBudgetReason).toBeUndefined();

    const list = await app.inject({
      method: "GET",
      url: `/postings/${postingId}/applications`,
      headers: authHeaders(client),
    });
    for (const item of list.json().items) expect(item.belowBudgetReason).toBeUndefined();
  });

  it("stores the reason as plain text, markup included", async () => {
    const markup = '<img src=x onerror="alert(1)"> Leftover abaca from my last order.';
    const bid = await applyToPosting(artist, postingId, 100_000, [], markup);
    expect(bid.statusCode).toBe(201);
    expect(bid.json().belowBudgetReason).toBe(markup);
  });

  it("never shows the price or the reason to another artist", async () => {
    const app = await getTestApp();
    const bid = await applyToPosting(artist, postingId, 110_000, [], REASON);
    const bidId = bid.json().id as string;
    await applyToPosting(rival, postingId, 150_000);

    const asRival = [
      await app.inject({ method: "GET", url: `/applications/${bidId}`, headers: authHeaders(rival) }),
      await app.inject({ method: "GET", url: `/postings/${postingId}/applications`, headers: authHeaders(rival) }),
    ];
    for (const response of asRival) {
      expect(response.statusCode).toBeGreaterThanOrEqual(403);
      expect(response.body).not.toContain(REASON);
      expect(response.body).not.toContain("110000");
    }

    const posting = await app.inject({ method: "GET", url: `/postings/${postingId}`, headers: authHeaders(rival) });
    expect(posting.body).not.toContain(REASON);
    expect(posting.body).not.toContain("110000");

    const mine = await app.inject({ method: "GET", url: "/applications/mine", headers: authHeaders(rival) });
    expect(mine.body).not.toContain(REASON);
  });

  it("can be accepted like any other bid, and the commission takes the lower price", async () => {
    const app = await getTestApp();
    const bid = await applyToPosting(artist, postingId, 120_000, [], REASON);
    const accepted = await app.inject({
      method: "POST",
      url: `/applications/${bid.json().id}/accept`,
      headers: authHeaders(client),
    });
    expect(accepted.statusCode).toBe(200);

    const row = await db.one<{ price: number }>(
      `SELECT agreed_price_centavos AS price FROM commissions WHERE posting_id = :id`,
      { id: uuidToBuf(postingId) },
    );
    expect(Number(row?.price)).toBe(120_000);
  });

  /** The database holds the rule too, so no future code path can skip it. */
  it("refuses a lower bid without a reason even when written straight to the table", async () => {
    await expect(
      db.run(
        `INSERT INTO applications (id, posting_id, artist_id, proposed_price_centavos, min_price_at_apply_centavos, cover_letter)
         VALUES (:id, :postingId, :artistId, 100000, 150000, 'A letter long enough to be a real proposal here.')`,
        { id: uuidToBuf(newId()), postingId: uuidToBuf(postingId), artistId: uuidToBuf(artist.id) },
      ),
    ).rejects.toThrow();
  });
});
