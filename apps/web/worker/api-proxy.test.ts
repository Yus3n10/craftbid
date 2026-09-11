/**
 * The /api proxy, tested under plain Node: `node --test` with type stripping,
 * so the Worker needs no test runner or dependency of its own.
 *
 * Run with: pnpm --filter @craftbid/web test:worker
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUpstreamRequest,
  isApiPath,
  proxyToApi,
  upstreamHeaders,
  upstreamUrl,
} from "./api-proxy.ts";
import worker from "./index.ts";

const SITE = "https://craftbid.pgeagoni.workers.dev";
const API = "https://craftbid-api.onrender.com";

describe("which paths are the API", () => {
  it("claims /api and everything under it", () => {
    for (const path of ["/api", "/api/", "/api/auth/me", "/api/applications/mine"]) {
      assert.equal(isApiPath(path), true, path);
    }
  });

  it("leaves the app's own routes and look-alikes to the asset server", () => {
    for (const path of ["/", "/postings", "/apiary", "/apis/x", "/my/api", "/assets/api.js"]) {
      assert.equal(isApiPath(path), false, path);
    }
  });
});

describe("where a request is sent", () => {
  it("strips the prefix and keeps the query", () => {
    assert.equal(
      upstreamUrl(`${SITE}/api/applications/mine?limit=50`, API),
      `${API}/applications/mine?limit=50`,
    );
    assert.equal(upstreamUrl(`${SITE}/api`, API), `${API}/`);
  });

  it("can never be pointed at another host", () => {
    // The case that would make this an open proxy if the path were resolved
    // against the origin instead of assigned to it.
    for (const path of [
      "/api//attacker.example/steal",
      "/api/%2F%2Fattacker.example/steal",
      "/api/@attacker.example/",
    ]) {
      const target = new URL(upstreamUrl(`${SITE}${path}`, API));
      assert.equal(target.host, new URL(API).host, `${path} escaped to ${target.host}`);
    }
  });
});

describe("what the API is told", () => {
  it("keeps the session cookie and the real Origin for the CSRF check", () => {
    const headers = upstreamHeaders(
      new Headers({ cookie: "craftbid_rt=abc", origin: SITE }),
      `${SITE}/api/auth/refresh`,
      "203.0.113.7",
    );
    assert.equal(headers.get("cookie"), "craftbid_rt=abc");
    assert.equal(headers.get("origin"), SITE);
    assert.equal(headers.get("x-forwarded-host"), "craftbid.pgeagoni.workers.dev");
    assert.equal(headers.get("x-forwarded-proto"), "https");
  });

  it("replaces a forwarded address the visitor made up", () => {
    const headers = upstreamHeaders(
      new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }),
      `${SITE}/api/auth/login`,
      "203.0.113.7",
    );
    assert.equal(headers.get("x-forwarded-for"), "203.0.113.7");
  });

  it("forwards no address at all rather than a made-up one when none is known", () => {
    const headers = upstreamHeaders(
      new Headers({ "x-forwarded-for": "1.2.3.4" }),
      `${SITE}/api/auth/login`,
      null,
    );
    assert.equal(headers.get("x-forwarded-for"), null);
  });

  it("bypasses every shared cache and hands redirects back to the browser", () => {
    const get = buildUpstreamRequest(new Request(`${SITE}/api/feed`), API, null);
    assert.equal(get.init.cache, "no-store");
    assert.equal(get.init.redirect, "manual");
    assert.equal(get.init.body, null);

    const post = buildUpstreamRequest(
      new Request(`${SITE}/api/auth/login`, { method: "POST", body: "{}" }),
      API,
      null,
    );
    assert.equal(post.init.method, "POST");
    assert.ok(post.init.body, "a POST must carry its body upstream");
  });
});

describe("what the browser gets back", () => {
  it("passes every Set-Cookie through, which is how the session lands first-party", async () => {
    let sentTo = "";
    let sentFor: string | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sentTo = url;
      sentFor = new Headers(init.headers).get("x-forwarded-for");
      const headers = new Headers();
      headers.append("set-cookie", "craftbid_at=a; Path=/; HttpOnly");
      headers.append("set-cookie", "craftbid_rt=r; Path=/; HttpOnly");
      return new Response("{}", { status: 200, headers });
    }) as typeof fetch;

    const response = await proxyToApi(
      new Request(`${SITE}/api/auth/login`, {
        method: "POST",
        body: "{}",
        headers: { "cf-connecting-ip": "198.51.100.4" },
      }),
      API,
      fakeFetch,
    );

    assert.equal(sentTo, `${API}/auth/login`);
    assert.equal(sentFor, "198.51.100.4");
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.headers.getSetCookie().map((cookie) => cookie.split("=")[0]),
      ["craftbid_at", "craftbid_rt"],
    );
  });

  it("answers an unreachable API in the API's own error shape", async () => {
    const failing = (async () => {
      throw new TypeError("connection refused");
    }) as typeof fetch;
    const response = await proxyToApi(new Request(`${SITE}/api/feed`), API, failing);
    assert.equal(response.status, 502);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "bad_gateway");
  });
});

describe("the Worker entry", () => {
  it("serves everything that is not the API from assets, untouched", async () => {
    let served = "";
    const env = {
      API_ORIGIN: API,
      ASSETS: {
        fetch: async (request: Request) => {
          served = new URL(request.url).pathname;
          return new Response("asset");
        },
      },
    };
    const response = await worker.fetch(new Request(`${SITE}/postings`), env);
    assert.equal(served, "/postings");
    assert.equal(await response.text(), "asset");
  });

  it("sends /api to the API and never to the asset server", async () => {
    const realFetch = globalThis.fetch;
    let upstream = "";
    globalThis.fetch = (async (url: string) => {
      upstream = url;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const env = {
        API_ORIGIN: API,
        ASSETS: {
          fetch: async () => {
            throw new Error("an API request reached the asset server");
          },
        },
      };
      const response = await worker.fetch(new Request(`${SITE}/api/auth/me`), env);
      assert.equal(response.status, 200);
      assert.equal(upstream, `${API}/auth/me`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
