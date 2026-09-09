import { beforeEach, describe, expect, it } from "vitest";
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
