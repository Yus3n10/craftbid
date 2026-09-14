import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { uuidToBuf } from "../db/ids.js";
import {
  applyToPosting,
  authHeaders,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  startCommission,
  type Session,
} from "./helpers.js";

let client: Session;
let artist: Session;

beforeEach(async () => {
  await resetData();
  client = await registerUser("client");
  artist = await registerUser("artist");
});

async function status(session: Session) {
  const app = await getTestApp();
  return (await app.inject({ method: "GET", url: "/me/role-switch", headers: authHeaders(session) })).json() as {
    allowed: boolean;
    blockers: string[];
    nextAllowedAt: string | null;
  };
}

async function switchTo(session: Session, role: "client" | "artist") {
  const app = await getTestApp();
  return app.inject({ method: "POST", url: "/me/role", headers: authHeaders(session), payload: { role } });
}

describe("switching between artist and client", () => {
  it("switches an account with nothing open and hands back a session with the new role", async () => {
    expect((await status(client)).allowed).toBe(true);

    const response = await switchTo(client, "artist");
    expect(response.statusCode).toBe(200);
    const body = response.json() as { user: { role: string }; accessToken: string; refreshToken: string };
    expect(body.user.role).toBe("artist");

    // The new token can do artist things; the old one's role claim is stale
    // but the account's other sessions are gone.
    const app = await getTestApp();
    const artistOnly = await app.inject({
      method: "PATCH",
      url: "/me/artist-profile",
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { headline: "New to making", acceptingCommissions: true, categorySlugs: ["crochet"], skills: [] },
    });
    expect(artistOnly.statusCode).toBe(200);
  });

  it("signs out every other session", async () => {
    const app = await getTestApp();
    const other = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `${client.username}@example.com`, password: "a sufficiently long password" },
    });
    const otherRefresh = (other.json() as { refreshToken: string }).refreshToken;

    await switchTo(client, "artist");

    const refreshed = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: otherRefresh } });
    expect(refreshed.statusCode).toBe(401);
  });

  it("refuses while a request is open, and says so", async () => {
    await createPosting(client);
    const view = await status(client);
    expect(view.allowed).toBe(false);
    expect(view.blockers.join(" ")).toMatch(/open craft request/i);
    expect((await switchTo(client, "artist")).statusCode).toBe(400);
  });

  it("refuses while a bid is pending", async () => {
    const posting = await createPosting(client);
    await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    expect((await status(artist)).blockers.join(" ")).toMatch(/bid/i);
    expect((await switchTo(artist, "client")).statusCode).toBe(400);
  });

  it("refuses while a commission is active, for both sides", async () => {
    await startCommission(client, artist);
    expect((await switchTo(client, "artist")).statusCode).toBe(400);
    expect((await switchTo(artist, "client")).statusCode).toBe(400);
  });

  /**
   * The reason the cooldown exists: an artist who could switch to client at
   * will could post a fake request, read every competitor's bid, and switch
   * back the same afternoon.
   */
  it("refuses a second switch within 30 days", async () => {
    expect((await switchTo(client, "artist")).statusCode).toBe(200);
    const again = await registerUser("client");
    await db.run(`UPDATE users SET role_changed_at = SYSTIMESTAMP - INTERVAL '29' DAY WHERE id = :id`, {
      id: uuidToBuf(again.id),
    });
    const view = await status(again);
    expect(view.allowed).toBe(false);
    expect(view.nextAllowedAt).not.toBeNull();
    expect((await switchTo(again, "artist")).statusCode).toBe(400);

    await db.run(`UPDATE users SET role_changed_at = SYSTIMESTAMP - INTERVAL '31' DAY WHERE id = :id`, {
      id: uuidToBuf(again.id),
    });
    expect((await switchTo(again, "artist")).statusCode).toBe(200);
  });

  it("refuses switching to the role the account already has", async () => {
    expect((await switchTo(client, "client")).statusCode).toBe(400);
  });

  it("keeps an artist's profile details through a round trip", async () => {
    const app = await getTestApp();
    await app.inject({
      method: "PATCH",
      url: "/me/artist-profile",
      headers: authHeaders(artist),
      payload: { headline: "Crochet to order", acceptingCommissions: true, categorySlugs: ["crochet"], skills: [] },
    });
    const toClient = await switchTo(artist, "client");
    expect(toClient.statusCode).toBe(200);
    await db.run(`UPDATE users SET role_changed_at = SYSTIMESTAMP - INTERVAL '31' DAY WHERE id = :id`, {
      id: uuidToBuf(artist.id),
    });
    const token = (toClient.json() as { accessToken: string }).accessToken;
    const back = await app.inject({
      method: "POST",
      url: "/me/role",
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "artist" },
    });
    expect(back.statusCode).toBe(200);
    expect((back.json() as { user: { artist?: { headline?: string } } }).user.artist?.headline).toBe("Crochet to order");
  });
});
