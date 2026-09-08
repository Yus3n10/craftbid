import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { resetData } from "./helpers.js";

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
