import { expect, test, type Page, type Route } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * The admin screen's commission problems and payment records. Every API call is
 * stubbed and every path the page asks for is answered, so nothing depends on
 * what an unstubbed call reaches on the machine running it.
 */

const STAFF = {
  id: "01920000-0000-7000-8000-000000000005",
  username: "yus3n",
  displayName: "Yusen Admin",
  role: "client",
  email: "yusen@example.com",
  avatar: null,
  cover: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  rating: { average: null, count: 0 },
  completedCommissions: 0,
  links: [],
  emailVerified: true,
  isStaff: true,
};

const COMMISSION_ID = "01920000-0000-7000-8000-0000000000d1";
const PROBLEM_ID = "01920000-0000-7000-8000-0000000000e1";
const PAYMENT_ID = "01920000-0000-7000-8000-0000000000p1";
const OLD_PAYMENT_ID = "01920000-0000-7000-8000-0000000000p0";
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: PAYMENT_ID,
  commissionId: COMMISSION_ID,
  postingTitle: "Crochet wedding bouquet",
  kind: "down",
  method: "gcash",
  status: "submitted",
  replaced: false,
  amountCentavos: 90_000,
  referenceNumber: "1234567890",
  paidOn: "2026-09-14",
  hasReceipt: true,
  client: { id: "01920000-0000-7000-8000-000000000001", username: "maya" },
  artist: { id: "01920000-0000-7000-8000-000000000002", username: "nena" },
  recordedBy: { id: "01920000-0000-7000-8000-000000000001", username: "maya" },
  paidTo: { name: "Nena Hooks", number: "09171234567", bank: null },
  submittedAt: "2026-09-14T03:00:00.000Z",
  decidedAt: null,
  ...overrides,
});

const PROBLEM = {
  id: PROBLEM_ID,
  commissionId: COMMISSION_ID,
  postingTitle: "Crochet wedding bouquet",
  reason: "payment_not_received",
  details: "I sent the down payment three days ago and it is still not confirmed.",
  status: "open",
  resolution: null,
  createdAt: "2026-09-14T05:00:00.000Z",
  closedAt: null,
  openedBy: { id: "01920000-0000-7000-8000-000000000001", username: "maya" },
  client: { id: "01920000-0000-7000-8000-000000000001", username: "maya", email: "maya@example.com" },
  artist: { id: "01920000-0000-7000-8000-000000000002", username: "nena", email: "nena@example.com" },
  payments: [payment()],
};

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pageOf = (items: unknown[]) => json({ items, total: items.length, limit: 25, offset: 0 });

type Handler = (route: Route, path: string, method: string, url: URL) => Promise<void> | undefined;

async function stubApi(page: Page, extra: Handler) {
  await page.route(
    (url) => apiPath(url) !== null,
    async (route) => {
      const url = new URL(route.request().url());
      const path = apiPath(url)!;
      const method = route.request().method();
      const handled = extra(route, path, method, url);
      if (handled) return handled;
      if (path === "/auth/me") return route.fulfill(json(STAFF));
      if (path === "/auth/refresh") return route.fulfill(SIGNED_OUT);
      if (path === "/notifications") return route.fulfill(json({ ...JSON.parse(EMPTY_PAGE.body), unread: 0 }));
      if (path === "/conversations/unread") return route.fulfill(json({ unread: 0 }));
      return route.fulfill(json({ error: { code: "not_found", message: "Not found" } }, 404));
    },
  );
}

test("the problems tab shows both people and the payments, and resolves with a note", async ({ page }) => {
  let open = true;
  const resolutions: unknown[] = [];
  await stubApi(page, (route, path, method) => {
    if (path === "/admin/problems") return route.fulfill(pageOf(open ? [PROBLEM] : []));
    if (path === `/admin/problems/${PROBLEM_ID}/resolve` && method === "POST") {
      resolutions.push(route.request().postDataJSON());
      open = false;
      return route.fulfill({ status: 204 });
    }
    if (path === `/admin/payments/${PAYMENT_ID}/receipt`) return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
    return undefined;
  });
  await page.goto("/admin?tab=problems");

  const card = page.getByRole("article", { name: /Crochet wedding bouquet/ });
  await expect(card.getByText("Payment not received")).toBeVisible();
  await expect(card.getByText(/three days ago/)).toBeVisible();
  await expect(card.getByText("maya@example.com")).toBeVisible();
  await expect(card.getByText("nena@example.com")).toBeVisible();
  await expect(card.getByText("1234567890")).toBeVisible();

  await card.getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve this problem" });
  await dialog.getByRole("radio", { name: /Cancel the commission/ }).check();
  const confirm = dialog.getByRole("button", { name: "Resolve" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: /Note/ }).fill("The transfer never arrived, so the commission is cancelled.");
  await confirm.click();

  await expect(page.getByText("No open problems")).toBeVisible();
  expect(resolutions).toEqual([{ outcome: "cancel", note: "The transfer never arrived, so the commission is cancelled." }]);
});

test("the payments tab lists every record with who sent it, opens receipts, and filters", async ({ page }) => {
  const asked: string[] = [];
  await stubApi(page, (route, path, _method, url) => {
    if (path === "/admin/payments") {
      asked.push(url.search);
      return route.fulfill(
        pageOf([
          payment({ status: "confirmed", decidedAt: "2026-09-14T06:00:00.000Z" }),
          payment({ id: OLD_PAYMENT_ID, status: "rejected", replaced: true, referenceNumber: "1111111111" }),
        ]),
      );
    }
    if (path === `/admin/payments/${PAYMENT_ID}/receipt`) return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
    return undefined;
  });
  await page.goto("/admin?tab=payments");

  const confirmed = page.getByRole("article", { name: /1234567890/ });
  await expect(confirmed.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(confirmed.getByText("Recorded by @maya")).toBeVisible();
  await expect(confirmed.getByRole("link", { name: "@nena" })).toBeVisible();
  await expect(confirmed.getByText("₱900")).toBeVisible();
  await expect(page.getByRole("article", { name: /1111111111/ }).getByText("Replaced")).toBeVisible();

  await confirmed.getByRole("button", { name: "View receipt" }).click();
  await expect(confirmed.getByRole("img", { name: "Receipt for 1234567890" })).toBeVisible();

  await page.getByLabel("State").selectOption("rejected");
  await expect.poll(() => asked.at(-1)).toContain("status=rejected");
  await page.getByRole("searchbox", { name: "Search payments" }).fill("maya");
  await page.getByRole("searchbox", { name: "Search payments" }).press("Enter");
  await expect.poll(() => asked.at(-1)).toContain("q=maya");
});

for (const tab of ["problems", "payments"] as const) {
  test(`the ${tab} tab fits a 320px phone`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await stubApi(page, (route, path) => {
      if (path === "/admin/problems") return route.fulfill(pageOf([PROBLEM]));
      if (path === "/admin/payments") return route.fulfill(pageOf([payment()]));
      return undefined;
    });
    await page.goto(`/admin?tab=${tab}`);
    await expect(page.getByText("1234567890").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the overview counts open commission problems", async ({ page }) => {
  await stubApi(page, (route, path) =>
    path === "/admin/overview"
      ? route.fulfill(
          json({ openReports: 0, openBugReports: 0, openProblems: 2, suspendedAccounts: 0, unconfirmedAccounts: 0, actionsThisWeek: 0 }),
        )
      : undefined,
  );
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /Open commission problems/ })).toContainText("2");
});
