import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { registerUser, resetData } from "./helpers.js";

/**
 * The rest of the suite runs with rate limiting off, because registering
 * dozens of test accounts would trip the registration limiter. That makes it
 * this file's job to prove the limiter actually works, on an app built with it
 * forced on.
 */
describe("rate limiting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await resetData();
    app = await buildApp({ enableRateLimit: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("blocks repeated failed logins", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "nobody@example.com", password: "wrong password here" },
        remoteAddress: "203.0.113.10",
      });

    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      statuses.push((await attempt()).statusCode);
    }

    // The route allows 10 in 10 minutes; the rest must be refused. Without
    // this, login is an unlimited password-guessing oracle.
    expect(statuses.filter((status) => status === 401).length).toBe(10);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  describe("behind the site's Worker", () => {
    // Cloudflare stamps every Worker subrequest to another Cloudflare zone
    // (onrender.com is one) with this single CF-Connecting-IP, whoever the
    // visitor was. Measured on production 2026-09-17: through the site, the
    // login limit was shared by everyone.
    const WORKER_ADDRESS = "2a06:98c0:3600::103";
    const SECRET = "a-test-proxy-secret-that-is-long-enough";
    let proxied: FastifyInstance;

    beforeAll(async () => {
      proxied = await buildApp({ enableRateLimit: true, proxySharedSecret: SECRET });
      await proxied.ready();
    });

    afterAll(async () => {
      await proxied.close();
    });

    const login = (headers: Record<string, string>, email = "nobody@example.com") =>
      proxied.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: "wrong password here" },
        remoteAddress: "10.0.0.1",
        headers: { "cf-connecting-ip": WORKER_ADDRESS, ...headers },
      });

    it("gives each visitor their own bucket when the Worker vouches for the address", async () => {
      const visitor = { "x-craftbid-proxy": SECRET, "x-craftbid-client-ip": "198.51.100.21" };
      for (let i = 0; i < 11; i += 1) await login(visitor);
      expect((await login(visitor)).statusCode).toBe(429);

      // One visitor guessing passwords must not lock everyone else out.
      const someoneElse = { "x-craftbid-proxy": SECRET, "x-craftbid-client-ip": "198.51.100.22" };
      // A different account, so the per-account throttle is not what answers.
      expect((await login(someoneElse, "someone-else@example.com")).statusCode).toBe(401);
    });

    it("slows password guessing on one account even when every guess comes from a new address", async () => {
      const victim = await registerUser("client");
      const bystander = await registerUser("client");
      const attempt = (email: string, password: string, n: number) =>
        proxied.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email, password },
          remoteAddress: "10.0.0.1",
          headers: {
            "cf-connecting-ip": WORKER_ADDRESS,
            "x-craftbid-proxy": SECRET,
            "x-craftbid-client-ip": `203.0.113.${100 + n}`,
          },
        });

      const victimEmail = `${victim.username}@example.com`;
      for (let i = 0; i < 10; i += 1) {
        expect((await attempt(victimEmail, `wrong guess number ${i}`, i)).statusCode).toBe(401);
      }
      // The eleventh try is refused before the password is looked at, so the
      // right password does not get through either.
      const locked = await attempt(victimEmail, "a sufficiently long password", 50);
      expect(locked.statusCode).toBe(429);
      expect(locked.json().error.code).toBe("rate_limited");

      // Someone else's account is untouched.
      expect((await attempt(`${bystander.username}@example.com`, "a sufficiently long password", 51)).statusCode).toBe(200);
    });

    it("ignores a visitor address that arrives without the right secret", async () => {
      // Otherwise anyone calling Render directly could pick a new address per
      // attempt and never be limited. A new email each time, so a refusal can
      // only come from the address limit, not the per-account one.
      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const response = await login({
          "x-craftbid-proxy": "not-the-secret-not-the-secret-not-it",
          "x-craftbid-client-ip": `198.51.100.${40 + i}`,
        }, `probe${i}@example.com`);
        statuses.push(response.statusCode);
      }
      expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    });
  });

  it("answers a throttled request in the standard error envelope", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: `flood${Math.random()}@example.com`,
          username: `flood${Math.floor(Math.random() * 1e6)}`,
          password: "a sufficiently long password",
          displayName: "Flood",
          role: "client",
        },
        remoteAddress: "203.0.113.20",
      });

    let throttled: Awaited<ReturnType<typeof attempt>> | undefined;
    for (let i = 0; i < 10; i += 1) {
      const response = await attempt();
      if (response.statusCode === 429) {
        throttled = response;
        break;
      }
    }

    expect(throttled).toBeDefined();
    expect(throttled!.json().error.code).toBe("rate_limited");
  });
});
