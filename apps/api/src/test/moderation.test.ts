import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { bufToUuid, uuidToBuf } from "../db/ids.js";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  makeStaff,
  registerUser,
  resetData,
  setStatus,
  startCommission,
  type Session,
} from "./helpers.js";
import * as moderation from "../modules/moderation/moderation.service.js";

let client: Session;
let artist: Session;

beforeEach(async () => {
  await resetData();
  client = await registerUser("client");
  artist = await registerUser("artist");
});

describe("account status", () => {
  /**
   * An access token lasts 15 minutes and carries no status. Without a check at
   * write time, a suspended account keeps posting until its token runs out.
   */
  it("stops a suspended account writing with a token issued before the suspension", async () => {
    const app = await getTestApp();
    await setStatus(artist.id, "suspended");

    const post = await app.inject({
      method: "POST",
      url: "/posts",
      headers: authHeaders(artist),
      payload: { caption: "Posted while suspended", imageIds: [] },
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().error.code).toBe("account_inactive");

    // Reading is harmless and still works for the rest of the token's life.
    expect((await app.inject({ method: "GET", url: "/feed", headers: authHeaders(artist) })).statusCode).toBe(200);
  });

  /**
   * After a switch, another device's access token still says the old role for
   * up to 15 minutes. Without this, an artist who switched to client could keep
   * bidding from a second device while posting requests from the first.
   */
  it("refuses a write carrying a role the account no longer has", async () => {
    const app = await getTestApp();
    await db.run(`UPDATE users SET role = 'client' WHERE id = :id`, { id: uuidToBuf(artist.id) });
    const post = await app.inject({
      method: "POST",
      url: "/posts",
      headers: authHeaders(artist),
      payload: { caption: "Posted with an old role", imageIds: [] },
    });
    expect(post.statusCode).toBe(401);
  });

  it("lets a suspended account sign out", async () => {
    const app = await getTestApp();
    await setStatus(client.id, "suspended");
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: authHeaders(client) });
    expect(out.statusCode).toBeLessThan(400);
  });

  it("tells a suspended account why sign-in fails, only after the right password", async () => {
    const app = await getTestApp();
    await setStatus(client.id, "suspended");
    const email = `${client.username}@example.com`;

    const wrong = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "not the password at all" } });
    expect(wrong.statusCode).toBe(401);

    const right = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "a sufficiently long password" } });
    expect(right.statusCode).toBe(403);
    expect(right.json().error.code).toBe("account_suspended");
  });

  it("keeps a suspended profile visible and hides a removed one", async () => {
    const app = await getTestApp();
    await setStatus(artist.id, "suspended");
    expect((await app.inject({ method: "GET", url: `/users/${artist.username}` })).statusCode).toBe(200);
    await setStatus(artist.id, "deleted");
    expect((await app.inject({ method: "GET", url: `/users/${artist.username}` })).statusCode).toBe(404);
  });

  it("pauses a suspended client's open request and a suspended artist's pending bid", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);

    await setStatus(client.id, "suspended");
    expect((await applyToPosting(artist, posting.id, posting.minBudgetCentavos)).statusCode).toBe(400);
    await setStatus(client.id, "active");

    const bid = await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    expect(bid.statusCode).toBe(201);
    await setStatus(artist.id, "suspended");
    const accept = await app.inject({
      method: "POST",
      url: `/applications/${bid.json().id}/accept`,
      headers: authHeaders(client),
    });
    expect(accept.statusCode).toBe(400);
  });
});

async function actionsFor(targetId: string): Promise<string[]> {
  const rows = await db.many<{ action: string }>(
    `SELECT action FROM moderation_actions WHERE target_id = :id ORDER BY created_at`,
    { id: uuidToBuf(targetId) },
  );
  return rows.map((row) => row.action);
}

async function notificationsOf(session: Session) {
  const app = await getTestApp();
  const response = await app.inject({ method: "GET", url: "/notifications?limit=50", headers: authHeaders(session) });
  return (response.json() as { items: { type: string; payload: Record<string, unknown> }[] }).items;
}

describe("moderation", () => {
  let staff: Session;
  beforeEach(async () => {
    staff = await registerUser("client");
    await makeStaff(staff.id);
  });

  it("removes a post from every public place, tells the artist which rule, and logs it", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist, "Something against the rules");

    await moderation.removePost(staff.id, post.id, { rule: "stolen_work", note: "Reported by the original maker." });

    expect((await app.inject({ method: "GET", url: `/posts/${post.id}` })).statusCode).toBe(404);
    const feed = (await app.inject({ method: "GET", url: "/feed" })).json() as { items: { id: string }[] };
    expect(feed.items.map((item) => item.id)).not.toContain(post.id);

    const notice = (await notificationsOf(artist)).find((item) => item.type === "content_removed");
    expect(notice?.payload).toMatchObject({ kind: "post", rule: "stolen_work", note: "Reported by the original maker." });
    expect(await actionsFor(post.id)).toEqual(["remove_post"]);
  });

  it("hides a removed comment, keeps it for the record, and stops it counting", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist);
    const created = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeaders(client),
      payload: { body: "A comment that breaks the rules." },
    });
    const commentId = (created.json() as { id: string }).id;

    await moderation.removeComment(staff.id, commentId, { rule: "bullying_harassment" });

    const comments = (await app.inject({ method: "GET", url: `/posts/${post.id}/comments` })).json() as { id: string }[];
    expect(comments).toHaveLength(0);
    const detail = (await app.inject({ method: "GET", url: `/posts/${post.id}` })).json() as { commentCount: number };
    expect(detail.commentCount).toBe(0);
    const kept = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM post_comments WHERE id = :id AND removed_at IS NOT NULL`,
      { id: uuidToBuf(commentId) },
    );
    expect(Number(kept?.cnt)).toBe(1);
    expect((await notificationsOf(client)).map((item) => item.type)).toContain("content_removed");
  });

  it("removes an open request and declines its bids, but refuses one already under way", async () => {
    const posting = await createPosting(client);
    await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    await moderation.removePosting(staff.id, posting.id, { rule: "scam_fraud" });

    const row = await db.one<{ status: string; removedAt: Date | null }>(
      `SELECT status, removed_at FROM postings WHERE id = :id`,
      { id: uuidToBuf(posting.id) },
    );
    expect(row?.status).toBe("cancelled");
    expect(row?.removedAt).not.toBeNull();

    const busyArtist = await registerUser("artist");
    const busyClient = await registerUser("client");
    const commissionId = await startCommission(busyClient, busyArtist);
    const busy = await db.one<{ postingId: Buffer }>(`SELECT posting_id FROM commissions WHERE id = :id`, {
      id: uuidToBuf(commissionId),
    });
    await expect(
      moderation.removePosting(staff.id, bufToUuid(busy!.postingId)!, { rule: "scam_fraud" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("warns an account with the rule and the note", async () => {
    await moderation.warn(staff.id, client.id, { rule: "spam", note: "Please stop posting the same request." });
    const notice = (await notificationsOf(client)).find((item) => item.type === "account_warning");
    expect(notice?.payload).toMatchObject({ rule: "spam", note: "Please stop posting the same request." });
    expect(await actionsFor(client.id)).toEqual(["warn"]);
  });

  it("suspends and unsuspends, signing the account out", async () => {
    const app = await getTestApp();
    const credentials = { email: `${client.username}@example.com`, password: "a sufficiently long password" };
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: credentials });
    const refreshToken = (login.json() as { refreshToken: string }).refreshToken;

    await moderation.suspend(staff.id, client.id, { rule: "bullying_harassment" });
    expect((await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } })).statusCode).toBe(401);

    await moderation.unsuspend(staff.id, client.id, "Cleared after review.");
    expect((await app.inject({ method: "POST", url: "/auth/login", payload: credentials })).statusCode).toBe(200);
    expect(await actionsFor(client.id)).toEqual(["suspend", "unsuspend"]);
  });

  it("removes an account's public content but keeps its commissions for the other person", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist);
    const commissionId = await startCommission(client, artist);

    await moderation.removeAccount(staff.id, artist.id, { rule: "impersonation" });

    expect((await app.inject({ method: "GET", url: `/users/${artist.username}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/posts/${post.id}` })).statusCode).toBe(404);
    const view = await app.inject({ method: "GET", url: `/commissions/${commissionId}`, headers: authHeaders(client) });
    expect(view.statusCode).toBe(200);
    expect((view.json() as { artist: { displayName: string } }).artist.displayName).toBe("Removed account");
  });

  it("refuses to act on the staff member's own account or another staff account", async () => {
    const colleague = await registerUser("artist");
    await makeStaff(colleague.id);
    await expect(moderation.suspend(staff.id, staff.id, { rule: "other" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(moderation.warn(staff.id, colleague.id, { rule: "other" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("settles the report an action came from", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist);
    const report = await app.inject({
      method: "POST",
      url: "/reports",
      headers: authHeaders(client),
      payload: { targetType: "artist_post", targetId: post.id, reason: "stolen_work" },
    });
    const reportId = (report.json() as { id: string }).id;

    await moderation.removePost(staff.id, post.id, { rule: "stolen_work", reportId });
    const row = await db.one<{ status: string; resolvedBy: Buffer | null }>(
      `SELECT status, resolved_by FROM reports WHERE id = :id`,
      { id: uuidToBuf(reportId) },
    );
    expect(row?.status).toBe("reviewed");
    expect(bufToUuid(row!.resolvedBy)).toBe(staff.id);
  });
});
