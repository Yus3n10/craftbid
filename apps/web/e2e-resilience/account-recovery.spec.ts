import { expect, test, type Page, type Request } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * Getting back into an account, and leaving one.
 *
 * The pages behind a forgotten password (asking for a link, landing from it)
 * and closing an account from Settings.
 */

const CLIENT = {
  id: "01920000-0000-7000-8000-000000000031",
  username: "maria",
  displayName: "Maria Santos",
  role: "client",
  email: "maria@example.com",
  emailVerified: true,
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
};

const TOKEN = "A".repeat(20) + "b".repeat(23);

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

interface Stub {
  me: typeof CLIENT | null;
  /** Answers for the calls a test is about; anything else gets a quiet default. */
  answers: Record<string, { status: number; body?: unknown }>;
  sent: Request[];
}

async function stubApi(page: Page, stub: Stub) {
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const request = route.request();
      const path = apiPath(new URL(request.url()))!;
      const key = `${request.method()} ${path}`;
      if (request.method() !== "GET") stub.sent.push(request);

      const answer = stub.answers[key];
      if (answer) {
        return route.fulfill(
          answer.body === undefined ? { status: answer.status } : json(answer.body, answer.status),
        );
      }
      if (path === "/auth/me") return route.fulfill(stub.me ? json(stub.me) : SIGNED_OUT);
      if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (path === "/conversations/unread") return route.fulfill(json({ unread: 0 }));
      if (path === "/me/role-switch") return route.fulfill(json({ allowed: true, blockers: [], nextAllowedAt: null }));
      if (/^\/(home|feed|posts|postings|commissions|applications\/mine)$/.test(path)) return route.fulfill(EMPTY_PAGE);
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
}

test.describe("a forgotten password", () => {
  test("sign in offers a way back, and the request never says whether the account exists", async ({ page }) => {
    const stub: Stub = { me: null, answers: { "POST /auth/forgot-password": { status: 204 } }, sent: [] };
    await stubApi(page, stub);
    await page.goto("/login");

    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password", level: 1 })).toBeVisible();

    await page.getByRole("textbox", { name: "Email" }).fill("maria@example.com");
    await page.getByRole("button", { name: "Send the link" }).click();

    await expect(page.getByRole("status")).toContainText("If maria@example.com has a Craftbid account");
    expect(stub.sent.map((request) => request.postDataJSON())).toEqual([{ email: "maria@example.com" }]);
  });

  test("the link's page takes the token out of the address bar and sets the password", async ({ page }) => {
    const stub: Stub = { me: null, answers: { "POST /auth/reset-password": { status: 204 } }, sent: [] };
    await stubApi(page, stub);
    await page.goto(`/reset-password?token=${TOKEN}`);

    await expect(page.getByRole("heading", { name: "Choose a new password", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/);

    await page.getByRole("textbox", { name: "New password", exact: true }).fill("a brand new long passphrase");
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(page.getByRole("heading", { name: "Your password is changed", level: 1 })).toBeVisible();
    expect(stub.sent[0]!.postDataJSON()).toEqual({ token: TOKEN, password: "a brand new long passphrase" });
    await expect(page.getByRole("link", { name: "Sign in" }).last()).toBeVisible();
  });

  test("an expired link says so and offers a new one", async ({ page }) => {
    const stub: Stub = {
      me: null,
      answers: {
        "POST /auth/reset-password": {
          status: 410,
          body: { error: { code: "link_expired", message: "This link has expired. Ask for a new one." } },
        },
      },
      sent: [],
    };
    await stubApi(page, stub);
    await page.goto(`/reset-password?token=${TOKEN}`);
    await page.getByRole("textbox", { name: "New password", exact: true }).fill("a brand new long passphrase");
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(page.getByRole("heading", { name: "This link has expired", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Send a new link" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});

test.describe("closing an account", () => {
  test("asks for the password, shows why it cannot close, and signs out when it does", async ({ page }) => {
    const stub: Stub = {
      me: CLIENT,
      answers: {
        "POST /me/delete-account": {
          status: 400,
          body: {
            error: {
              code: "bad_request",
              message: "You have a commission in progress. Finish or cancel it before closing your account.",
            },
          },
        },
      },
      sent: [],
    };
    await stubApi(page, stub);
    await page.goto("/settings");

    await page.getByRole("button", { name: "Close account" }).click();
    const dialog = page.getByRole("dialog", { name: "Close your Craftbid account?" });
    const confirm = dialog.getByRole("button", { name: "Close account" });
    await expect(confirm).toBeDisabled();

    await dialog.getByRole("textbox", { name: "Your password", exact: true }).fill("a sufficiently long password");
    await confirm.click();
    await expect(dialog).toContainText("You have a commission in progress.");
    await expect(dialog).toBeVisible();

    // The commission is finished; closing now goes through.
    stub.answers["POST /me/delete-account"] = { status: 204 };
    stub.me = null;
    await confirm.click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    const closing = stub.sent.filter((request) => new URL(request.url()).pathname.endsWith("/me/delete-account"));
    expect(closing.at(-1)!.postDataJSON()).toEqual({ password: "a sufficiently long password" });
  });
});
