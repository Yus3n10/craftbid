import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { uuidToBuf } from "../db/ids.js";
import {
  addGcash,
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  makeStaff,
  registerUser,
  resetData,
  startCommission,
  type Session,
} from "./helpers.js";

/**
 * Closing your own account.
 *
 * People must be able to leave and take their personal details with them. What
 * another person still depends on stays: a commission in progress blocks
 * closing, and finished commissions and their payment records remain for the
 * other party under "Removed account".
 */

const PASSWORD = "a sufficiently long password";

async function closeAccount(user: Session, password = PASSWORD) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/me/delete-account",
    headers: authHeaders(user),
    payload: { password },
  });
}

async function userRow(id: string) {
  return db.one<{
    email: string;
    username: string;
    displayName: string;
    bio: string | null;
    city: string | null;
    status: string;
  }>(`SELECT email, username, display_name, bio, city, status FROM users WHERE id = :id`, {
    id: uuidToBuf(id),
  });
}

describe("closing your own account", () => {
  let client: Session;
  let artist: Session;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    artist = await registerUser("artist");
  });

  it("needs the account's password", async () => {
    const response = await closeAccount(artist, "not the password at all");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.password).toBeDefined();
    expect((await userRow(artist.id))?.status).toBe("active");
  });

  it("refuses while a commission is in progress, and says why", async () => {
    await startCommission(client, artist);
    const response = await closeAccount(artist);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/commission/i);
    expect((await userRow(artist.id))?.status).toBe("active");
  });

  it("removes personal details, public content and sessions, and frees the email", async () => {
    const app = await getTestApp();
    const originalEmail = `${artist.username}@example.com`;
    await app.inject({
      method: "PATCH",
      url: "/me/profile",
      headers: authHeaders(artist),
      payload: { bio: "I crochet bouquets", city: "Iloilo City" },
    });
    await addGcash(artist);
    const post = await createArtistPost(artist);
    const posting = await createPosting(client);
    await applyToPosting(artist, posting.id, 200_000);
    const signedIn = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: originalEmail, password: PASSWORD },
    });
    const refreshToken = signedIn.json().refreshToken as string;

    expect((await closeAccount(artist)).statusCode).toBe(204);

    const row = await userRow(artist.id);
    expect(row?.status).toBe("deleted");
    expect(row?.email).not.toBe(originalEmail);
    expect(row?.username).not.toBe(artist.username);
    expect(row?.displayName).toBe("Removed account");
    expect(row?.bio).toBeNull();
    expect(row?.city).toBeNull();

    const payout = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM payout_accounts WHERE user_id = :id`,
      { id: uuidToBuf(artist.id) },
    );
    expect(Number(payout?.cnt)).toBe(0);

    expect((await app.inject({ method: "GET", url: `/users/${artist.username}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/posts/${post.id}` })).statusCode).toBe(404);

    const bids = await app.inject({
      method: "GET",
      url: `/postings/${posting.id}/applications`,
      headers: authHeaders(client),
    });
    expect((bids.json() as { items: { status: string }[] }).items.every((bid) => bid.status !== "pending")).toBe(true);

    // Signed out everywhere.
    const refreshed = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
    expect(refreshed.statusCode).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: originalEmail, password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);

    // The address can start a new account.
    const again = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: originalEmail,
        username: artist.username,
        password: PASSWORD,
        displayName: "Back again",
        role: "artist",
      },
    });
    expect(again.statusCode).toBe(201);
  });

  it("keeps a finished commission for the other person, under Removed account", async () => {
    const app = await getTestApp();
    const commissionId = await startCommission(client, artist);
    await db.run(`UPDATE commissions SET status = 'completed', completed_at = SYSTIMESTAMP WHERE id = :id`, { id: uuidToBuf(commissionId) });

    expect((await closeAccount(artist)).statusCode).toBe(204);

    const view = await app.inject({
      method: "GET",
      url: `/commissions/${commissionId}`,
      headers: authHeaders(client),
    });
    expect(view.statusCode).toBe(200);
    expect((view.json() as { artist: { displayName: string } }).artist.displayName).toBe("Removed account");
  });

  it("cancels a client's open requests", async () => {
    const posting = await createPosting(client);
    expect((await closeAccount(client)).statusCode).toBe(204);
    const row = await db.one<{ status: string }>(`SELECT status FROM postings WHERE id = :id`, {
      id: uuidToBuf(posting.id),
    });
    expect(row?.status).toBe("cancelled");
  });

  it("refuses a staff account until staff access is taken away", async () => {
    await makeStaff(client.id);
    const response = await closeAccount(client);
    expect(response.statusCode).toBe(400);
    expect((await userRow(client.id))?.status).toBe("active");
  });
});
