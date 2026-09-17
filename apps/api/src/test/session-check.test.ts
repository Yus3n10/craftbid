import { beforeEach, describe, expect, it } from "vitest";
import { getTestApp, registerUser, resetData } from "./helpers.js";

/**
 * "Is anyone signed in?" without a 401 for the answer "no".
 *
 * The web app asks on every page load. /auth/me answers a signed-out visitor
 * with 401, which every browser prints as a red error in the console, on every
 * visit, for every visitor. /auth/session answers that visitor 200 with no
 * user, and keeps the 401 for the one case where it means something: a
 * session cookie is there but its access token has lapsed, so the app should
 * renew it.
 */
describe("the session check", () => {
  beforeEach(resetData);

  const PASSWORD = "a sufficiently long password";

  async function cookiesFor(username: string): Promise<string[]> {
    const app = await getTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `${username}@example.com`, password: PASSWORD },
    });
    return (response.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]!);
  }

  it("answers a visitor with no session 200 and no user", async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: "GET", url: "/auth/session" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: null });
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("answers a signed-in browser with its account", async () => {
    const app = await getTestApp();
    const user = await registerUser("client");
    const cookies = await cookiesFor(user.username);

    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: cookies.join("; ") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(user.id);
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("still says 401 when only the refresh cookie is left, so the app renews the session", async () => {
    const app = await getTestApp();
    const user = await registerUser("client");
    const refreshOnly = (await cookiesFor(user.username)).filter((c) => c.startsWith("craftbid_rt="));

    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: refreshOnly.join("; ") },
    });
    expect(response.statusCode).toBe(401);
  });

  it("says 401 for a token that no longer verifies", async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { authorization: "Bearer not.a.real.token" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("clears the cookies of a session that can no longer be renewed", async () => {
    // Otherwise a revoked refresh cookie makes every later visit try, and
    // fail, to renew it.
    const app = await getTestApp();
    const user = await registerUser("client");
    const cookies = await cookiesFor(user.username);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: cookies.join("; ") } });

    const refresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: cookies.join("; "), "content-type": "application/json" },
      payload: {},
    });
    expect(refresh.statusCode).toBe(401);
    const cleared = (refresh.headers["set-cookie"] as string[] | undefined) ?? [];
    for (const name of ["craftbid_at", "craftbid_rt"]) {
      expect(cleared.find((value) => value.startsWith(`${name}=;`)), `${name} cleared`).toBeDefined();
    }
  });
});
