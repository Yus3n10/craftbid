import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { EMPTY_PAGE, apiPath } from "./stub-api.js";

/**
 * The first question every page asks: is anyone signed in?
 *
 * Signed out, the answer used to be a 401 from /auth/me, which the browser
 * printed as a red error on every visit. And Safari deletes a site's
 * localStorage (and the "has had a session" hint in it) after seven days
 * without a visit, while a remembered session lasts thirty.
 */

const ME = {
  id: "01920000-0000-7000-8000-000000000041",
  username: "rosa",
  displayName: "Rosa Stitch",
  role: "client",
  email: "rosa@example.com",
  emailVerified: true,
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
};

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stub(page: Page, session: () => { status: number; body: unknown }, onRefresh: () => number) {
  const calls: string[] = [];
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      calls.push(`${route.request().method()} ${path}`);
      if (path === "/auth/session") {
        const answer = session();
        return route.fulfill(json(answer.body, answer.status));
      }
      if (path === "/auth/refresh") {
        const status = onRefresh();
        return route.fulfill(status === 200 ? json({}) : json({ error: { code: "unauthorised", message: "no" } }, status));
      }
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (path === "/conversations/unread") return route.fulfill(json({ unread: 0 }));
      if (/^\/(home|feed|posts|postings)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
  return calls;
}

test("a signed-out visit asks once, gets no error, and never tries to renew a session", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const calls = await stub(page, () => ({ status: 200, body: { user: null } }), () => 401);

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();

  expect(errors).toEqual([]);
  expect(calls).not.toContain("GET /auth/me");
  expect(calls).not.toContain("POST /auth/refresh");
});

test("a session whose hint the browser wiped still renews, because the server saw the cookie", async ({ page }) => {
  let renewed = false;
  const calls = await stub(
    page,
    () => (renewed ? { status: 200, body: { user: ME } } : { status: 401, body: { error: { code: "session_expired", message: "expired" } } }),
    () => {
      renewed = true;
      return 200;
    },
  );
  // No "craftbid.hadSession" in storage: a fresh context has none, as after Safari's wipe.
  await page.goto("/");

  await expect(page.getByRole("button", { name: /Account and settings|Menu/ }).first()).toBeVisible();
  expect(calls.filter((call) => call === "POST /auth/refresh")).toHaveLength(1);
  // And the hint is back for next time.
  expect(await page.evaluate(() => localStorage.getItem("craftbid.hadSession"))).toBe("1");
});
