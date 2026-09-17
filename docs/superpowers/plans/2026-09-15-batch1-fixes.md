# Batch 1: Fixes Implementation Plan

**Goal:** Stop the blank page on slow networks, load data on older iPhones, fix "-1 days ago", trim chat suggestions to three, and refresh the feed after a request is posted.

**Architecture:** Web-only changes plus pure helpers in `packages/shared` (tested from the API's Vitest suite, as `crop.ts` is). No migration, no API change.

**Tech Stack:** React 19, Vite 6, Tailwind 4, vite-plugin-pwa, Fontsource variable fonts, Playwright resilience suite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-fixes-feed-chat-images-staff-tools-design.md` (Batch 1)

## Global Constraints

- No em dashes in user-facing copy, commits or docs. No AI attribution.
- Commit and deploy only when the developer says so. Steps below end with a local green run, not a commit.
- Fonts: Bricolage Grotesque (opsz 12..96, wght 500..700) and Figtree (wght 400..700), served from the site's own origin, `font-display: swap`.
- "Today"/"Yesterday" are calendar days in `Asia/Manila`; negative differences clamp to zero.
- At most three chat suggestions per role and stage.
- Header width tests keep 32px spare at 1024px and 8px at 320px.

---

### Task 1: Self-hosted fonts and a loading placeholder

**Files:**
- Modify: `apps/web/package.json` (add `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree`)
- Modify: `apps/web/src/main.tsx` (import the font CSS)
- Modify: `apps/web/src/index.css:59-60` (family names)
- Modify: `apps/web/index.html` (remove Google Fonts links, add placeholder and noscript)
- Modify: `apps/web/vite.config.ts` (precache the Latin woff2 files)
- Create: `apps/web/e2e-resilience/slow-network.spec.ts`

- [ ] **Step 1: Write the failing resilience test**

```ts
import { expect, test } from "@playwright/test";
import { EMPTY_PAGE, SIGNED_OUT, apiPath } from "./stub-api.js";

/**
 * The page must paint on a network where an outside host never answers.
 * Google Fonts used to be a render-blocking stylesheet: with it hung, Chromium
 * and WebKit showed no <body> at all for 90 seconds (Messenger black, Chrome
 * white), reproduced on production 2026-09-15.
 */
test("the home page paints while outside font hosts never answer", async ({ page }) => {
  const outside: string[] = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    outside.push(route.request().url());
    // Never fulfilled: a hung connection.
  });
  await page.route(
    (url) => apiPath(url) !== null,
    (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      if (path === "/auth/me") return route.fulfill(SIGNED_OUT);
      return route.fulfill(EMPTY_PAGE);
    },
  );

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 5_000 });
  expect(outside, "the page still asks an outside host for fonts").toEqual([]);
});

test("the document shows a loading message before the app starts", async ({ page }) => {
  await page.route(/\/assets\/.*\.js$/, () => {}); // scripts never arrive
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Loading Craftbid")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `pnpm --filter @craftbid/web test:resilience -- slow-network`
Expected: FAIL (heading not visible within 5s; no "Loading Craftbid" text).

- [ ] **Step 3: Install the fonts**

Run: `pnpm --filter @craftbid/web add @fontsource-variable/bricolage-grotesque @fontsource-variable/figtree`

- [ ] **Step 4: Import them in `main.tsx`** (above `import "./index.css";`)

```ts
// Served from this site, not Google: a render-blocking stylesheet on another
// host blanked the whole page whenever that host was slow (spec, finding 1).
// The opsz file carries the optical-size axis the headings pin at 24.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/figtree/wght.css";
```

- [ ] **Step 5: Update the family names in `index.css`**

```css
  --font-display: "Bricolage Grotesque Variable", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-body: "Figtree Variable", ui-sans-serif, system-ui, -apple-system, sans-serif;
```

- [ ] **Step 6: `index.html`**: delete the two `preconnect` links, the Google Fonts comment and stylesheet link. Replace the body with:

```html
  <body>
    <div id="root">
      <!--
        Shown until React replaces it. Inline styles only: the stylesheet may
        not have arrived, and a blank screen on a slow connection reads as a
        broken site.
      -->
      <p style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F7F4EE;color:#3B4A55;font:16px system-ui,-apple-system,sans-serif">
        Loading Craftbid…
      </p>
    </div>
    <noscript>
      <p style="padding:24px;font:16px system-ui,sans-serif">Craftbid needs JavaScript turned on.</p>
    </noscript>
    <script type="module" src="/src/main.tsx"></script>
  </body>
```

- [ ] **Step 7: Precache the Latin font files** in `vite.config.ts` `workbox`:

```ts
          // The app shell plus the Latin font files, so a repeat visit needs
          // no network for type. Other subsets load on demand by unicode-range.
          globPatterns: ["**/*.{js,css,html,svg,png}", "**/*-latin-{opsz,wght}-normal-*.woff2"],
```

- [ ] **Step 8: Run to verify pass**, then build and check `dist/sw.js` lists two woff2 files and `dist/index.html` has no `fonts.googleapis.com`.

Run: `pnpm --filter @craftbid/web test:resilience -- slow-network` → PASS
Run: `grep -c woff2 apps/web/dist/sw.js; grep -c googleapis apps/web/dist/index.html` → `>=1`, `0`

- [ ] **Step 9: Screenshot a heading at 390px and compare with production** to confirm the optical size and weights look the same.

### Task 2: A request deadline that works on older browsers

**Files:**
- Modify: `apps/web/src/lib/api.ts:89,176`
- Modify: `apps/web/e2e-resilience/slow-network.spec.ts`

**Interfaces:**
- Produces: `deadlineSignal(ms: number): AbortSignal` (module-private in `api.ts`)

- [ ] **Step 1: Failing test** (append to `slow-network.spec.ts`)

```ts
test("the feed loads on a browser without AbortSignal.timeout", async ({ page }) => {
  // iOS before 16 and Chrome before 103. Reproduced 2026-09-15: the shell
  // painted and every API call threw.
  await page.addInitScript("delete AbortSignal.timeout;");
  await page.route(
    (url) => apiPath(url) !== null,
    (route) => {
      const path = apiPath(new URL(route.request().url()))!;
      if (path === "/auth/me") return route.fulfill(SIGNED_OUT);
      if (path === "/postings")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0, limit: 5, offset: 0 }) });
      return route.fulfill(EMPTY_PAGE);
    },
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const categories = page.waitForResponse((response) => apiPath(new URL(response.url())) === "/categories");
  await page.goto("/");
  await categories;
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  expect(errors).toEqual([]);
});
```

(While writing it, confirm which request the home page makes on load and assert on its rendered result rather than `/categories` if the home page does not call it; the test must fail on the current build.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** in `api.ts` above `refreshSession`:

```ts
/**
 * A signal that aborts after `ms`. AbortSignal.timeout is Safari 16 and
 * Chrome 103; older phones here lack it, and calling it there threw on every
 * request, so the page painted but nothing ever loaded.
 */
function deadlineSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  return controller.signal;
}
```

Replace both `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` calls with `deadlineSignal(REQUEST_TIMEOUT_MS)`.

- [ ] **Step 4: Run, expect PASS.** Also run `recovery.spec.ts` (deadline behaviour) → PASS.

### Task 3: One "time ago"

**Files:**
- Create: `packages/shared/src/timeAgo.ts`
- Modify: `packages/shared/src/index.ts` (export it)
- Create: `apps/api/src/test/time-ago.test.ts`
- Modify: `apps/web/src/components/FeedPost.tsx`, `SharedPostCard.tsx`, `PostingCard.tsx`, `CommentThread.tsx`

**Interfaces:**
- Produces: `daysAgo(iso: string, options?: { now?: number; older?: "date" | "months" }): string` and `shortAgo(iso: string, now?: number): string`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { daysAgo, shortAgo } from "@craftbid/shared";

// 2026-09-15 06:00 in Manila is 2026-09-14 22:00 UTC.
const NOW = Date.parse("2026-09-14T22:00:00.000Z");

describe("daysAgo", () => {
  it("never goes negative when the server clock is ahead", () => {
    expect(daysAgo("2026-09-14T22:00:05.000Z", { now: NOW })).toBe("Today");
  });
  it("counts Manila calendar days, not 24-hour windows", () => {
    // 23:00 on the 14th in Manila, seven hours earlier.
    expect(daysAgo("2026-09-14T15:00:00.000Z", { now: NOW })).toBe("Yesterday");
    // 00:30 on the 15th in Manila.
    expect(daysAgo("2026-09-14T16:30:00.000Z", { now: NOW })).toBe("Today");
  });
  it("uses days, then a date or months", () => {
    expect(daysAgo("2026-09-10T22:00:00.000Z", { now: NOW })).toBe("4 days ago");
    expect(daysAgo("2026-07-01T00:00:00.000Z", { now: NOW })).toBe("1 Jul 2026");
    expect(daysAgo("2026-07-01T00:00:00.000Z", { now: NOW, older: "months" })).toBe("2 months ago");
  });
});

describe("shortAgo", () => {
  it("clamps the future to just now", () => {
    expect(shortAgo("2026-09-14T22:00:30.000Z", NOW)).toBe("just now");
  });
  it("steps through minutes, hours and days", () => {
    expect(shortAgo("2026-09-14T21:55:00.000Z", NOW)).toBe("5m");
    expect(shortAgo("2026-09-14T19:00:00.000Z", NOW)).toBe("3h");
    expect(shortAgo("2026-09-12T22:00:00.000Z", NOW)).toBe("2d");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @craftbid/api test -- time-ago` → FAIL (not exported).

- [ ] **Step 3: Implement `timeAgo.ts`**

```ts
const MANILA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Whole calendar days between two instants, on the Philippine calendar. */
function manilaDayNumber(ms: number): number {
  const [y, m, d] = MANILA_DAY.format(ms).split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/**
 * "Today", "Yesterday", "N days ago", then a date (or months).
 *
 * The difference is clamped at zero: a timestamp from a server whose clock is
 * a few seconds ahead of the phone's used to floor to "-1 days ago".
 */
export function daysAgo(iso: string, options: { now?: number; older?: "date" | "months" } = {}): string {
  const now = options.now ?? Date.now();
  const at = Math.min(Date.parse(iso), now);
  const days = manilaDayNumber(now) - manilaDayNumber(at);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (options.older === "months") {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  return new Date(at).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "just now", "5m", "3h", "2d", then a date. For comment timestamps. */
export function shortAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return daysAgo(iso, { now });
}
```

Check the Node ICU output of `toLocaleDateString("en-PH", …)` matches "1 Jul 2026"; adjust the test to the real format if ICU differs, keeping the same format the cards show today.

- [ ] **Step 4: Export** from `packages/shared/src/index.ts`: `export * from "./timeAgo.js";` then `pnpm --filter @craftbid/shared build`.

- [ ] **Step 5: Run tests** → PASS. Mutation: remove `Math.min(..., now)` and the `<= 0` clamp, confirm the first test fails, restore.

- [ ] **Step 6: Replace the four local functions** with imports: `FeedPost`/`SharedPostCard` use `daysAgo(iso)`, `PostingCard` uses `daysAgo(iso, { older: "months" })`, `CommentThread` uses `shortAgo(iso)`. `pnpm typecheck` → PASS.

### Task 4: Three chat suggestions that wrap

**Files:**
- Modify: `packages/shared/src/constants.ts:443-472`
- Modify: `apps/web/src/pages/ConversationPage.tsx:237-252`
- Create: `apps/api/src/test/chat-suggestions.test.ts`
- Modify: `apps/web/e2e-resilience/chat.spec.ts` (overflow check)

- [ ] **Step 1: Failing unit test**

```ts
import { expect, it } from "vitest";
import { CHAT_SUGGESTIONS } from "@craftbid/shared";

it("offers at most three suggestions per role and stage", () => {
  for (const role of Object.values(CHAT_SUGGESTIONS)) {
    for (const list of Object.values(role)) expect(list.length).toBeLessThanOrEqual(3);
  }
});
```

- [ ] **Step 2: Failing resilience check** in `chat.spec.ts`: at a 320px viewport on the conversation screen, the suggestions list has `scrollWidth <= clientWidth` and every chip is inside the viewport.

- [ ] **Step 3: Run both → FAIL.**

- [ ] **Step 4: Replace the lists** with the spec's twelve strings (section 1e). Update any existing chat resilience assertion that clicks a removed suggestion.

- [ ] **Step 5: Change the markup**: `<ul className="mb-2 flex flex-wrap gap-2" …>`, drop `shrink-0` on `<li>`, drop `whitespace-nowrap` on the button and add `text-left`. Update the comment to "Suggestions fill the box and never send; they wrap rather than scroll."

- [ ] **Step 6: Run → PASS.**

### Task 5: Feed and request lists refresh after request changes

**Files:**
- Modify: `apps/web/src/pages/PostingFormPage.tsx:84-85`
- Modify: `apps/web/src/pages/PostingDetailPage.tsx:327`

- [ ] **Step 1:** In `PostingFormPage` `onSuccess`, add `void queryClient.invalidateQueries({ queryKey: ["feed"] });`.
- [ ] **Step 2:** In `PostingDetailPage` `cancelMutation.onSuccess`, invalidate `["posting", id]`, `["postings"]` and `["feed"]`.
- [ ] **Step 3:** `pnpm typecheck` → PASS. (Behaviour is covered by the Batch 2 e2e test once requests are in the feed.)

### Task 6: Full verification

- [ ] `pnpm typecheck`
- [ ] `pnpm --filter @craftbid/api test` (then `pnpm db:reset && pnpm --filter @craftbid/api seed`)
- [ ] `pnpm --filter @craftbid/web test:resilience`
- [ ] `pnpm --filter @craftbid/web test:worker`
- [ ] `pnpm test:e2e`
- [ ] Re-run the scratchpad blank-page probe against a local `vite preview` build with fonts hung: body text present.
- [ ] Report to the developer and wait for "commit this and deploy it".
