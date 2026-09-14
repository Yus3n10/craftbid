import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { uuidToBuf } from "../db/ids.js";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  freshImageSeed,
  getTestApp,
  makeStaff,
  registerUser,
  resetData,
  testImage,
  type Session,
} from "./helpers.js";

let staff: Session;
let client: Session;
let artist: Session;

beforeEach(async () => {
  await resetData();
  staff = await registerUser("client");
  await makeStaff(staff.id);
  client = await registerUser("client");
  artist = await registerUser("artist");
});

async function get(session: Session | null, url: string) {
  const app = await getTestApp();
  return app.inject({ method: "GET", url, headers: session ? authHeaders(session) : {} });
}

async function post(session: Session, url: string, payload: Record<string, unknown> = {}) {
  const app = await getTestApp();
  return app.inject({ method: "POST", url, headers: authHeaders(session), payload });
}

describe("the admin API", () => {
  it("does not exist for anyone but staff", async () => {
    for (const url of ["/admin/overview", "/admin/reports", "/admin/users", "/admin/actions", "/admin/bugs"]) {
      expect((await get(null, url)).statusCode, url).toBe(404);
      expect((await get(client, url)).statusCode, url).toBe(404);
      expect((await get(staff, url)).statusCode, url).toBe(200);
    }
    expect((await post(client, `/admin/users/${artist.id}/warn`, { rule: "spam" })).statusCode).toBe(404);
  });

  it("stops working the moment staff access is taken away", async () => {
    expect((await get(staff, "/admin/overview")).statusCode).toBe(200);
    await db.run(`UPDATE users SET is_staff = 0 WHERE id = :id`, { id: uuidToBuf(staff.id) });
    expect((await get(staff, "/admin/overview")).statusCode).toBe(404);
  });

  /** The developer asked to see, per account, whether its email was confirmed. */
  it("lists accounts with whether each email is confirmed, and filters on it", async () => {
    await db.run(`UPDATE users SET email_verified_at = NULL WHERE id = :id`, { id: uuidToBuf(client.id) });
    await db.run(`UPDATE users SET email_verified_at = SYSTIMESTAMP WHERE id = :id`, { id: uuidToBuf(artist.id) });

    const all = (await get(staff, "/admin/users?limit=50")).json() as {
      items: { id: string; email: string; emailConfirmedAt: string | null }[];
    };
    const byId = new Map(all.items.map((row) => [row.id, row]));
    expect(byId.get(client.id)?.emailConfirmedAt).toBeNull();
    expect(byId.get(artist.id)?.emailConfirmedAt).not.toBeNull();
    expect(byId.get(client.id)?.email).toBe(`${client.username}@example.com`);

    const unconfirmed = (await get(staff, "/admin/users?email=unconfirmed&limit=50")).json() as { items: { id: string }[] };
    expect(unconfirmed.items.map((row) => row.id)).toContain(client.id);
    expect(unconfirmed.items.map((row) => row.id)).not.toContain(artist.id);

    const search = (await get(staff, `/admin/users?q=${artist.username}`)).json() as { items: { id: string }[] };
    expect(search.items.map((row) => row.id)).toEqual([artist.id]);
  });

  it("shows a report with what was reported, and removes it from there", async () => {
    const created = await createArtistPost(artist, "Reported piece");
    const report = await post(client, "/reports", { targetType: "artist_post", targetId: created.id, reason: "stolen_work" });
    const reportId = (report.json() as { id: string }).id;

    const queue = (await get(staff, "/admin/reports?status=open")).json() as {
      items: { id: string; target: { text: string; owner: { id: string } } | null }[];
    };
    const item = queue.items.find((row) => row.id === reportId);
    expect(item?.target?.text).toContain("Reported piece");
    expect(item?.target?.owner.id).toBe(artist.id);

    expect((await post(staff, `/admin/posts/${created.id}/remove`, { rule: "stolen_work", reportId })).statusCode).toBe(204);
    const open = (await get(staff, "/admin/reports?status=open")).json() as { items: { id: string }[] };
    expect(open.items.map((row) => row.id)).not.toContain(reportId);

    const log = (await get(staff, "/admin/actions")).json() as { items: { action: string }[] };
    expect(log.items.map((row) => row.action)).toEqual(expect.arrayContaining(["remove_post", "resolve_report"]));
  });

  it("shows an account's history and content", async () => {
    await createArtistPost(artist, "One of their pieces");
    await post(staff, `/admin/users/${artist.id}/warn`, { rule: "spam", note: "First warning." });
    const detail = (await get(staff, `/admin/users/${artist.id}`)).json() as {
      history: { action: string; note: string | null }[];
      recentContent: { kind: string; text: string }[];
    };
    expect(detail.history[0]).toMatchObject({ action: "warn", note: "First warning." });
    expect(detail.recentContent.some((row) => row.text.includes("One of their pieces"))).toBe(true);
  });

  it("counts what needs attention", async () => {
    await db.run(`UPDATE users SET email_verified_at = NULL WHERE id = :id`, { id: uuidToBuf(client.id) });
    const overview = (await get(staff, "/admin/overview")).json() as { unconfirmedAccounts: number; openReports: number };
    expect(overview.unconfirmedAccounts).toBeGreaterThanOrEqual(1);
    expect(overview.openReports).toBe(0);
  });
});

function multipart(boundary: string, fields: Record<string, string>, file?: { name: string; body: Buffer }) {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\n`),
      file.body,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

describe("reporting", () => {
  it("accepts a report on a comment, once, and never on your own", async () => {
    const created = await createArtistPost(artist);
    const comment = await post(client, `/posts/${created.id}/comments`, { body: "Something unkind." });
    const commentId = (comment.json() as { id: string }).id;

    expect((await post(artist, "/reports", { targetType: "comment", targetId: commentId, reason: "harassment" })).statusCode).toBe(201);
    expect((await post(artist, "/reports", { targetType: "comment", targetId: commentId, reason: "harassment" })).statusCode).toBe(409);
    expect((await post(client, "/reports", { targetType: "comment", targetId: commentId, reason: "other" })).statusCode).toBe(400);
  });

  /** A bid is private to the client it was sent to, so only that client can report it. */
  it("lets only the client who received a bid report it", async () => {
    const posting = await createPosting(client);
    const bid = await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    const bidId = (bid.json() as { id: string }).id;
    const stranger = await registerUser("client");

    expect((await post(stranger, "/reports", { targetType: "application", targetId: bidId, reason: "spam" })).statusCode).toBe(404);
    expect((await post(client, "/reports", { targetType: "application", targetId: bidId, reason: "spam" })).statusCode).toBe(201);
  });

  it("takes a bug report with a screenshot that only staff can see", async () => {
    const app = await getTestApp();
    const boundary = "----craftbidbug";
    const created = await app.inject({
      method: "POST",
      url: "/bug-reports",
      headers: { ...authHeaders(client), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart(
        boundary,
        { description: "The Save changes button does nothing on my phone.", pageUrl: "/commissions/abc" },
        { name: "screenshot", body: await testImage(freshImageSeed()) },
      ),
    });
    expect(created.statusCode).toBe(201);
    const bugId = (created.json() as { id: string }).id;

    const list = (await get(staff, "/admin/bugs?status=open")).json() as {
      items: { id: string; hasScreenshot: boolean; reporter: { email: string } }[];
    };
    expect(list.items.find((row) => row.id === bugId)).toMatchObject({
      hasScreenshot: true,
      reporter: { email: `${client.username}@example.com` },
    });

    const shot = await get(staff, `/admin/bugs/${bugId}/screenshot`);
    expect(shot.statusCode).toBe(200);
    expect(shot.headers["cache-control"]).toBe("private, no-store");
    expect((await get(client, `/admin/bugs/${bugId}/screenshot`)).statusCode).toBe(404);

    expect((await post(staff, `/admin/bugs/${bugId}/resolve`)).statusCode).toBe(204);
  });

  it("refuses a bug report that says nothing useful", async () => {
    const app = await getTestApp();
    const boundary = "----craftbidbug";
    const response = await app.inject({
      method: "POST",
      url: "/bug-reports",
      headers: { ...authHeaders(client), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, { description: "broken" }),
    });
    expect(response.statusCode).toBe(400);
  });
});
