import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { getTestApp, resetData } from "./helpers.js";

/**
 * Refresh token reuse.
 *
 * Every refresh spends the token it was given. The same token coming back
 * later means a copy exists somewhere else, so the account is signed out
 * everywhere. Coming back within a minute is two tabs racing on one cookie,
 * and gets a session of its own.
 */

const PASSWORD = "a sufficiently long password";

async function signUpAndIn(username: string): Promise<{ refreshToken: string }> {
  const app = await getTestApp();
  const registered = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: `${username}@example.com`, username, password: PASSWORD, displayName: "Reuse Test", role: "client" },
  });
  expect(registered.statusCode).toBe(201);
  return { refreshToken: registered.json().refreshToken };
}

async function refresh(refreshToken: string) {
  const app = await getTestApp();
  return app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
}

async function login(username: string): Promise<string> {
  const app = await getTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: `${username}@example.com`, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return response.json().refreshToken;
}

function ageRotations(): Promise<number> {
  return db.run(`UPDATE refresh_tokens SET rotated_at = rotated_at - INTERVAL '2' MINUTE WHERE rotated_at IS NOT NULL`);
}

describe("refresh token reuse", () => {
  beforeEach(async () => {
    await resetData();
  });

  it("signs the account out everywhere when a spent token comes back later", async () => {
    const first = await signUpAndIn("reused");
    const otherDevice = await login("reused");

    const rotated = await refresh(first.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const current = rotated.json().refreshToken as string;

    await ageRotations();
    const replay = await refresh(first.refreshToken);
    expect(replay.statusCode).toBe(401);

    // The session it was exchanged for, and the other device, are both gone.
    expect((await refresh(current)).statusCode).toBe(401);
    expect((await refresh(otherDevice)).statusCode).toBe(401);
  });

  it("gives a tab that raced another refresh its own session instead", async () => {
    const first = await signUpAndIn("racer");
    const [a, b] = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    // Both new tokens work, and nothing was revoked.
    expect((await refresh(a.json().refreshToken)).statusCode).toBe(200);
    expect((await refresh(b.json().refreshToken)).statusCode).toBe(200);
  });

  it("gives a tab that arrives just after the other tab refreshed its own session", async () => {
    const first = await signUpAndIn("latecomer");
    const winner = await refresh(first.refreshToken);
    expect(winner.statusCode).toBe(200);

    const late = await refresh(first.refreshToken);
    expect(late.statusCode).toBe(200);
    expect((await refresh(winner.json().refreshToken)).statusCode).toBe(200);
  });

  it("gives the old token no grace after the account signs out", async () => {
    const first = await signUpAndIn("leaver");
    const rotated = await refresh(first.refreshToken);
    const app = await getTestApp();
    await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken: rotated.json().refreshToken } });

    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
  });

  it("answers a signed-out token with a plain 401 and leaves other sessions alone", async () => {
    const first = await signUpAndIn("tidy");
    const otherDevice = await login("tidy");
    const app = await getTestApp();
    await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken: first.refreshToken } });
    await ageRotations();

    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
    expect((await refresh(otherDevice)).statusCode).toBe(200);
  });
});
