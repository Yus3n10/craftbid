import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/query.js";
import { hashRefreshToken } from "../../lib/tokens.js";
import {
  authHeaders,
  getTestApp,
  registerUser,
  resetData,
} from "../../test/helpers.js";

describe("authentication", () => {
  beforeEach(resetData);

  it("registers a client and returns a session without exposing the password", async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "Maria@Example.com",
        username: "maria_crafts",
        password: "a sufficiently long password",
        displayName: "Maria Santos",
        role: "client",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.role).toBe("client");
    // Email and username are normalised to lowercase so uniqueness is
    // genuinely case-insensitive.
    expect(body.user.email).toBe("maria@example.com");
    expect(body.user.username).toBe("maria_crafts");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("gives an artist an artist profile, and a client none", async () => {
    const app = await getTestApp();
    const artist = await registerUser("artist");
    const client = await registerUser("client");

    const artistMe = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeaders(artist),
    });
    const clientMe = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeaders(client),
    });

    expect(artistMe.json().artist).toBeDefined();
    expect(artistMe.json().artist.acceptingCommissions).toBe(true);
    expect(clientMe.json().artist).toBeUndefined();
  });

  it("rejects a duplicate email, case-insensitively", async () => {
    const app = await getTestApp();
    await registerUser("client", { email: "taken@example.com", username: "firstone" });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "TAKEN@example.com",
        username: "secondone",
        password: "a sufficiently long password",
        displayName: "Impostor",
        role: "client",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.fields.email).toBeDefined();
  });

  it("rejects a duplicate username", async () => {
    const app = await getTestApp();
    await registerUser("artist", { username: "sameuser" });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "other@example.com",
        username: "sameuser",
        password: "a sufficiently long password",
        displayName: "Other",
        role: "artist",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.fields.username).toBeDefined();
  });

  it("reports invalid fields individually so a form can highlight them", async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "not-an-email",
        username: "A!",
        password: "short",
        displayName: "X",
        role: "client",
      },
    });

    expect(response.statusCode).toBe(400);
    const fields = response.json().error.fields;
    expect(fields.email).toBeDefined();
    expect(fields.username).toBeDefined();
    expect(fields.password).toBeDefined();
  });

  it("logs in with correct credentials", async () => {
    const app = await getTestApp();
    await registerUser("client", { email: "login@example.com", username: "loginuser" });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "login@example.com", password: "a sufficiently long password" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBeTruthy();
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const app = await getTestApp();
    await registerUser("client", { email: "real@example.com", username: "realuser" });

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "real@example.com", password: "the wrong password entirely" },
    });
    const unknownAccount = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "ghost@example.com", password: "the wrong password entirely" },
    });

    // Identical status and message: anything else turns login into a way to
    // discover which addresses are registered.
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    expect(unknownAccount.json().error.message).toBe(
      wrongPassword.json().error.message,
    );
  });

  it("refuses protected routes without a token", async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: "GET", url: "/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("refuses a tampered token", async () => {
    const app = await getTestApp();
    const session = await registerUser("client");

    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${session.token.slice(0, -3)}xyz` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rotates the refresh token and refuses the one it replaced", async () => {
    const app = await getTestApp();
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "rotate@example.com",
        username: "rotateuser",
        password: "a sufficiently long password",
        displayName: "Rotate",
        role: "client",
      },
    });
    const original = registration.json().refreshToken as string;

    const first = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: original },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().refreshToken).not.toBe(original);

    // Replaying the consumed token must fail: that is what limits the damage
    // from a stolen one.
    const replay = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: original },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("accepts logout and refresh with no request body at all", async () => {
    const app = await getTestApp();

    // A POST with no body is the natural way to call these. Fastify answered
    // 400 for a while because the optional body schema rejected an absent
    // body, which broke sign-out and made renewable sessions look dead.
    const logout = await app.inject({ method: "POST", url: "/auth/logout" });
    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({ method: "POST", url: "/auth/refresh" });
    // No session to refresh, so 401 is right. The point is that it is not 400.
    expect(refresh.statusCode).toBe(401);
  });

  it("clears cookies with the attributes they were set with", async () => {
    const app = await getTestApp();

    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "cookies@example.com",
        username: "cookieuser",
        password: "a sufficiently long password",
        displayName: "Cookie",
        role: "client",
      },
    });
    const cookies = registration.headers["set-cookie"] as string[];

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: cookies.map((c) => c.split(";")[0]).join("; ") },
    });

    /**
     * The reason this test exists: sign-out returned 204, revoked the refresh
     * token, and left the browser signed in. A cookie is only overwritten when
     * the incoming Set-Cookie matches on name, path AND SameSite, so clearing
     * with a bare path produced something the browser did not recognise as the
     * same cookie. Nothing at the status-code level could see it.
     */
    const cleared = logout.headers["set-cookie"] as string[] | undefined;
    expect(cleared, "logout must send Set-Cookie headers").toBeDefined();

    for (const name of ["craftbid_at", "craftbid_rt"]) {
      const header = cleared!.find((value) => value.startsWith(`${name}=`));
      expect(header, `${name} must be cleared`).toBeDefined();

      // Emptied, expired, and carrying the same attributes as when it was set.
      expect(header).toMatch(new RegExp(`^${name}=;`));
      expect(header!.toLowerCase()).toContain("path=/");

      const setHeader = cookies.find((value) => value.startsWith(`${name}=`))!;
      for (const attribute of ["samesite=", "secure", "httponly"]) {
        const wasSet = setHeader.toLowerCase().includes(attribute);
        const isCleared = header!.toLowerCase().includes(attribute);
        expect(
          isCleared,
          `${name}: "${attribute}" was ${wasSet ? "set" : "absent"} on login and must match on logout`,
        ).toBe(wasSet);
      }
    }
  });

  it("logs out and invalidates the refresh token", async () => {
    const app = await getTestApp();
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "logout@example.com",
        username: "logoutuser",
        password: "a sufficiently long password",
        displayName: "Logout",
        role: "client",
      },
    });
    const refreshToken = registration.json().refreshToken as string;
    const cookies = registration.headers["set-cookie"] as string[];

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: cookies.map((c) => c.split(";")[0]).join("; ") },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});

/**
 * "Keep me logged in".
 *
 * The only thing the browser can be told is whether a cookie outlives it, and
 * the only thing the server can enforce is how long the token inside it keeps
 * working. These tests pin both, for each choice, and the one path that could
 * quietly change a session's kind after it began: refresh.
 */
describe("keep me logged in", () => {
  beforeEach(resetData);

  const password = "a sufficiently long password";

  /** The Set-Cookie header for one cookie, lower-cased for attribute checks. */
  function cookie(headers: Record<string, unknown>, name: string): string {
    const all = headers["set-cookie"] as string[] | string | undefined;
    const list = Array.isArray(all) ? all : all ? [all] : [];
    const found = list.find((value) => value.startsWith(`${name}=`));
    expect(found, `${name} must be set`).toBeDefined();
    return found!.toLowerCase();
  }

  function isSessionCookie(header: string): boolean {
    return !header.includes("max-age=") && !header.includes("expires=");
  }

  function maxAge(header: string): number {
    const match = /max-age=(\d+)/.exec(header);
    expect(match, `expected a Max-Age in: ${header}`).not.toBeNull();
    return Number(match![1]);
  }

  /** Hours from now until the stored refresh token stops working. */
  async function hoursLeft(refreshToken: string): Promise<number> {
    const row = await db.one<{ expiresAt: Date }>(
      `SELECT expires_at FROM refresh_tokens WHERE token_hash = :hash`,
      { hash: hashRefreshToken(refreshToken) },
    );
    expect(row, "the refresh token must be stored").not.toBeNull();
    return (row!.expiresAt.getTime() - Date.now()) / 3_600_000;
  }

  async function signIn(email: string, remember?: boolean) {
    const app = await getTestApp();
    await registerUser("artist", { email, username: email.split("@")[0]! });
    return app.inject({
      method: "POST",
      url: "/auth/login",
      payload: remember === undefined ? { email, password } : { email, password, remember },
    });
  }

  it("gives an unticked sign-in cookies that end with the browser", async () => {
    const response = await signIn("brief@example.com", false);
    expect(response.statusCode).toBe(200);

    for (const name of ["craftbid_at", "craftbid_rt"]) {
      const header = cookie(response.headers, name);
      expect(isSessionCookie(header), `${name} must be a session cookie: ${header}`).toBe(true);
      // Still the same protections, just not the lifetime.
      expect(header).toContain("httponly");
      expect(header).toContain("path=/");
    }

    // And the server stops honouring it after the idle window, for the
    // browsers that restore session cookies on relaunch.
    const hours = await hoursLeft(response.json().refreshToken);
    expect(hours).toBeGreaterThan(11);
    expect(hours).toBeLessThanOrEqual(12);
  });

  it("treats a sign-in that does not mention it as unticked", async () => {
    // An older build or a script: the safer session, never the long one.
    const response = await signIn("older@example.com");
    expect(isSessionCookie(cookie(response.headers, "craftbid_rt"))).toBe(true);
  });

  it("gives a ticked sign-in cookies that survive a restart, for a bounded time", async () => {
    const response = await signIn("stays@example.com", true);
    expect(response.statusCode).toBe(200);

    const refresh = cookie(response.headers, "craftbid_rt");
    expect(maxAge(refresh)).toBe(30 * 86_400);
    expect(refresh).toContain("httponly");

    // The access cookie lives exactly as long as the token inside it.
    expect(maxAge(cookie(response.headers, "craftbid_at"))).toBe(15 * 60);

    const hours = await hoursLeft(response.json().refreshToken);
    expect(hours).toBeGreaterThan(30 * 24 - 1);
    expect(hours).toBeLessThanOrEqual(30 * 24);
  });

  it("offers the same choice when creating an account", async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "newcomer@example.com",
        username: "newcomer",
        password,
        displayName: "Newcomer",
        role: "client",
        remember: true,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(maxAge(cookie(response.headers, "craftbid_rt"))).toBe(30 * 86_400);
  });

  it("keeps a session's kind across refresh, whatever the refresh asks for", async () => {
    const app = await getTestApp();

    const remembered = await signIn("kept@example.com", true);
    const renewedRemembered = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: remembered.json().refreshToken },
    });
    expect(renewedRemembered.statusCode).toBe(200);
    expect(maxAge(cookie(renewedRemembered.headers, "craftbid_rt"))).toBe(30 * 86_400);

    // The attack this closes: a refresh that could upgrade itself would turn
    // a session meant for a shared phone into a month-long one.
    const brief = await signIn("notkept@example.com", false);
    const renewedBrief = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: brief.json().refreshToken, remember: true },
    });
    expect(renewedBrief.statusCode).toBe(200);
    expect(isSessionCookie(cookie(renewedBrief.headers, "craftbid_rt"))).toBe(true);
    expect(await hoursLeft(renewedBrief.json().refreshToken)).toBeLessThanOrEqual(12);
  });

  it("signs out a remembered session completely", async () => {
    const app = await getTestApp();
    const remembered = await signIn("leaving@example.com", true);
    const cookies = remembered.headers["set-cookie"] as string[];

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: cookies.map((c) => c.split(";")[0]).join("; ") },
    });
    expect(logout.statusCode).toBe(204);

    // Both cookies are overwritten with an expired, empty value. A persistent
    // cookie is the one that would otherwise still be there next week.
    for (const name of ["craftbid_at", "craftbid_rt"]) {
      const header = cookie(logout.headers, name);
      expect(header).toMatch(new RegExp(`^${name}=;`));
      const expired = header.includes("max-age=0") || /expires=thu, 01 jan 1970/.test(header);
      expect(expired, `${name} must be expired on sign-out: ${header}`).toBe(true);
    }

    // And the token is dead server-side, so a copy of the cookie is useless.
    const replay = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: remembered.json().refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("refuses a remembered session once its time is up", async () => {
    const app = await getTestApp();
    const remembered = await signIn("expired@example.com", true);
    const refreshToken = remembered.json().refreshToken as string;

    await db.run(
      `UPDATE refresh_tokens SET expires_at = SYSTIMESTAMP - INTERVAL '1' MINUTE
        WHERE token_hash = :hash`,
      { hash: hashRefreshToken(refreshToken) },
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(response.statusCode).toBe(401);
  });
});
