# Batch 2: Personal Home Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put open craft requests in the home feed, rank the feed by each person's craft interests with fresh items always near the top, and show a client's requests on their profile.

**Architecture:** Migration 018 adds `user_category_interest`. A new `interests` module records weighted, decaying category scores from existing actions (best effort, after the action succeeds). A new `home` module ranks the newest 500 posts, shares and open requests in one Oracle query and returns a discriminated union. The web feed calls `/home` and falls back to `/feed` on 404 during the deploy gap.

**Tech Stack:** Fastify, node-oracledb (raw SQL), Zod shared schemas, React Query, Playwright, Vitest against real Oracle.

**Spec:** `docs/superpowers/specs/2026-09-15-fixes-feed-chat-images-staff-tools-design.md` (Batch 2)

## Global Constraints

- Bidding stays private: a request item in `/home` never carries `applicationCount` or `commissionId`, and gets no reactions, comments, saves or shares.
- Interest half-life 30 days; weights: save 3, share 3, comment 2, bid 2, post a request 2, reaction 1, search matching a category 1, browsing a category 0.5; artist's own crafts a fixed 2 each at read time.
- `freshness = 0.5 ^ (ageHours / 36)`; `rank = freshness * (1 + fresh + LEAST(interest, 10) / 10)` with `fresh = 1` under 6 hours (revised: a 0.9 floor did not lift new items); the viewer's own item under 24 hours first; ties `at DESC, id`; candidates the newest 500.
- Profile requests: status `open` or `in_progress`, not removed.
- `/feed` is unchanged. Migration 018 runs on production before the push.
- Interest recording never fails the action it follows.
- No em dashes; no AI attribution; commit only when told.

---

### Task 1: Migration 018 and the interests module

**Files:**
- Create: `apps/api/src/db/migrations/018-category-interest.sql`
- Create: `apps/api/src/modules/interests/interests.repository.ts`
- Create: `apps/api/src/modules/interests/interests.service.ts`
- Modify: `apps/api/src/test/helpers.ts` (`resetData` deletes `user_category_interest` first; add `interestOf(userId)` and `setInterest(userId, slug, score, daysAgo)`)
- Test: `apps/api/src/test/home-feed.test.ts` (interest section)

**Interfaces:**
- Produces:
  - `INTEREST_WEIGHTS: { save: 3; share: 3; comment: 2; bid: 2; request: 2; reaction: 1; search: 1; browse: 0.5 }`
  - `recordInterest(userId: string, signal: keyof typeof INTEREST_WEIGHTS, target: { postId: string } | { shareId: string } | { postingId: string } | { categorySlugs: string[] }): Promise<void>` (catches and logs its own errors)
  - `scoresFor(userId: string): Promise<Map<string, number>>` keyed by category slug, decayed to now (tests and ranking checks)

- [ ] **Step 1: Migration**

```sql
-- How much each person has shown interest in each craft, for ordering their
-- own home feed and nothing else. No endpoint returns these rows.
--
-- The score decays with a 30-day half-life, applied whenever it is read or
-- bumped, so interest someone has moved on from fades without a job to clear it.
CREATE TABLE user_category_interest (
  user_id     RAW(16)                  NOT NULL,
  category_id NUMBER(4)                NOT NULL,
  score       NUMBER(10, 4)            NOT NULL,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_user_category_interest PRIMARY KEY (user_id, category_id),
  CONSTRAINT fk_user_category_interest_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_category_interest_cat FOREIGN KEY (category_id) REFERENCES craft_categories (id),
  CONSTRAINT ck_user_category_interest_score CHECK (score >= 0)
);
```

- [ ] **Step 2: Failing tests** (in `home-feed.test.ts`)

```ts
describe("interest", () => {
  it("a save counts 3 toward the post's craft, a reaction 1", async () => { /* artist posts crochet; client saves and reacts; scoresFor(client).get("crochet") ≈ 4 */ });
  it("halves after 30 days", async () => { /* setInterest(client, "pottery", 8, 30); scoresFor ≈ 4 (±0.05) */ });
  it("a search counts only when it names a craft", async () => { /* GET /search?q=ceramic mug → pottery 1; q=birthday → no rows */ });
  it("bidding and posting a request count 2", async () => { /* createPosting pottery → client pottery 2; applyToPosting → artist pottery 2 */ });
  it("browsing a category counts once per first page", async () => { /* GET /postings?category=weaving signed in → 0.5; offset=20 → unchanged */ });
});
```

- [ ] **Step 3: Run** `pnpm --filter @craftbid/api exec vitest run src/test/home-feed.test.ts` → FAIL.

- [ ] **Step 4: Repository** (MERGE with decay; the category comes from a subquery keyed by the target, never from the request)

```ts
const HALF_LIFE_DAYS = 30;
const decayed = (column: string, stamp: string) =>
  `${column} * POWER(0.5, (EXTRACT(DAY FROM (SYSTIMESTAMP - ${stamp})) * 86400
     + EXTRACT(HOUR FROM (SYSTIMESTAMP - ${stamp})) * 3600
     + EXTRACT(MINUTE FROM (SYSTIMESTAMP - ${stamp})) * 60
     + EXTRACT(SECOND FROM (SYSTIMESTAMP - ${stamp}))) / ${HALF_LIFE_DAYS * 86400})`;

const CATEGORY_OF = {
  post: `SELECT category_id FROM artist_posts WHERE id = :target AND category_id IS NOT NULL`,
  share: `SELECT p.category_id FROM post_shares s JOIN artist_posts p ON p.id = s.post_id WHERE s.id = :target AND p.category_id IS NOT NULL`,
  posting: `SELECT category_id FROM postings WHERE id = :target`,
} as const;

async function merge(userId: string, source: string, binds: Record<string, BindValue>, weight: number, q: Queryable) {
  await q.run(
    `MERGE INTO user_category_interest t
     USING (${source}) s
        ON (t.user_id = :userId AND t.category_id = s.category_id)
      WHEN MATCHED THEN UPDATE SET t.score = ${decayed("t.score", "t.updated_at")} + :weight, t.updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (user_id, category_id, score) VALUES (:userId, s.category_id, :weight)`,
    { ...binds, userId: uuidToBuf(userId), weight },
  );
}
```

Plus `bumpTarget(userId, kind, id, weight)`, `bumpSlugs(userId, slugs, weight)` (source `SELECT id AS category_id FROM craft_categories WHERE slug IN (:s0, ...)`), and `scores(userId)` returning slug → decayed score. Export `decayed` for the home query.

- [ ] **Step 5: Service** `recordInterest`: map signal to weight and target to a repository call; `try { … } catch (error) { console.error("Interest was not recorded", error); }`. A unique-key race on the insert branch (ORA-00001) is retried once.

- [ ] **Step 6: Shared search matcher** `packages/shared/src/interest.ts`

```ts
const IGNORED = new Set(["handmade", "other", "and", "art"]);
/** Craft slugs a search names, by whole words: "ceramic mug" names pottery. */
export function categoriesForSearch(term: string): string[] {
  const words = term.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !IGNORED.has(w));
  return CRAFT_CATEGORIES.filter((category) => {
    const names = [category.slug, ...category.name.toLowerCase().split(/[^a-z]+/)].filter((w) => w.length >= 4 && !IGNORED.has(w));
    return words.some((w) => names.some((n) => n.startsWith(w) || w.startsWith(n)));
  }).map((category) => category.slug);
}
```
Unit test: "ceramic mug" → ["pottery"]; "Crochet bouquet" → ["crochet"]; "birthday gift" → []; "stitch" → ["embroidery"?]. Check real output and assert it; "stitch" must include "stitch-art".

- [ ] **Step 7: Hook the signals** (each after its write succeeds, awaited, never throwing):
  - `social.service`: `react` → reaction/post, `reactToShare` → reaction/share, `addComment` → comment/post, `addShareComment` → comment/share, `setSaved(true)` → save/post, `share` → share/post.
  - `postings.service.createPosting` → request/posting; `applications.service.apply` → bid/posting.
  - `search.routes` (signed in) → search/`categoriesForSearch(q)` when non-empty.
  - `postings.routes GET /postings` and `posts.routes GET /posts` (signed in, `category` set, `offset === 0`) → browse/`[category]`.

- [ ] **Step 8: Run → PASS.** Mutation: change the half-life to 60, confirm the decay test fails, restore.

### Task 2: The ranked `/home` endpoint

**Files:**
- Modify: `packages/shared/src/types.ts` (`HomeRequestDto`, `HomeItemDto`), `packages/shared/src/schemas/post.ts` (`homeQuerySchema`)
- Create: `apps/api/src/modules/home/home.repository.ts`, `home.service.ts`, `home.routes.ts`
- Modify: `apps/api/src/app.ts` (register), `apps/api/src/modules/posts/posts.service.ts` (export `assembleFeed`), `apps/api/src/modules/postings/postings.repository.ts` (`findManyByIds`)
- Test: `apps/api/src/test/home-feed.test.ts`

**Interfaces:**
- Produces:
  - `type HomeRequestDto = Omit<PostingDto, "applicationCount" | "commissionId">`
  - `type HomeItemDto = ({ kind: "post" } & FeedItemDto) | ({ kind: "request" } & HomeRequestDto)`
  - `GET /home?category=&limit=&offset=` → `Paginated<HomeItemDto>`

- [ ] **Step 1: Failing tests**

```ts
describe("GET /home", () => {
  it("shows a new open request to a signed-out visitor, without bid details", async () => { /* item kind request; no applicationCount/commissionId keys */ });
  it("leaves out cancelled, in-progress, removed and suspended clients' requests", async () => {});
  it("orders same-age items by each viewer's interests", async () => { /* ages 30h; pottery lover sees pottery first, jewelry lover jewelry first */ });
  it("keeps a 1-hour-old item above a 3-day-old favourite", async () => {});
  it("puts the viewer's own new request first for them only", async () => {});
  it("counts an artist's own crafts", async () => {});
  it("falls back to newest first with no interests", async () => {});
});
```
Items are aged with `UPDATE ... SET created_at = SYSTIMESTAMP - NUMTODSINTERVAL(:h, 'HOUR')`.

- [ ] **Step 2: Run → FAIL (404).**

- [ ] **Step 3: Repository query** `homeEntries(viewerId | null, { categorySlug?, limit, offset })` returning `{ entries: ({ kind: "post"; postId; shareId | null } | { kind: "request"; postingId })[]; total }` using the CTEs `candidates` (published posts, shares of published posts, open non-removed requests of active clients), `recent` (newest 500), `interest` (decayed scores UNION ALL `artist_categories` at 2, summed, `LEAST(…, 10)`), then the ordering from Global Constraints. Age in hours from `EXTRACT` on `SYSTIMESTAMP - at`. Viewer binds `NULL` when signed out.

- [ ] **Step 4: Service** loads posts with `assembleFeed` and requests with `findManyByIds`, strips `applicationCount` and `commissionId`, keeps entry order, adds `kind`.

- [ ] **Step 5: Route** `app.get("/home", { schema: { querystring: homeQuerySchema } }, …)`, `homeQuerySchema = paginationSchema.extend({ category })`.

- [ ] **Step 6: Run → PASS.** Mutations: drop `u.status = 'active'`, the 6-hour floor, and the own-item rule, one at a time; each makes a test fail; restore.

### Task 3: Client requests on profiles

**Files:**
- Modify: `apps/api/src/modules/postings/postings.repository.ts` (`list` accepts `statuses?: PostingStatus[]` and `excludeRemoved?: boolean`), `postings.service.ts` (`listForUser(username, paging)`), `postings.routes.ts` (`GET /users/:username/postings`)
- Test: `apps/api/src/test/home-feed.test.ts`

- [ ] **Step 1: Failing test**: open and in-progress requests listed newest first; cancelled, completed and removed are not; unknown or removed user 404.
- [ ] **Step 2: Implement**, reusing `list` with `clientId` resolved from the username (`users` status not `deleted`).
- [ ] **Step 3: Run → PASS.**

### Task 4: Web feed with request cards

**Files:**
- Create: `apps/web/src/components/FeedRequestCard.tsx`
- Modify: `apps/web/src/components/Feed.tsx`, `apps/web/src/pages/ProfilePage.tsx`
- Test: `apps/web/e2e-resilience/home-feed.spec.ts`

- [ ] **Step 1: Failing resilience tests**
  - Home with `/home` returning a post and a request: both render; the request card shows title, category, "from ₱1,500", client name, city, and a "View request" link to `/postings/:id`; it has no reaction, comment, save or share buttons.
  - `/home` answering 404: the feed still renders from `/feed`.
  - Request card at 320px and 1024px: no horizontal overflow.
  - Client profile with `/users/maya/postings` returning one open request: a "Requests" section lists it; with none, no section.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: `FeedRequestCard`**: `Card` with the category thread, first image in `ImageFrame` when present, eyebrow "Craft request", title (display font), 2-line clamped description, "from" budget in clay `Money`, client avatar and name linking to their profile, city, `daysAgo(createdAt)`, and `ButtonLink` "View request".
- [ ] **Step 4: `Feed.tsx`**: all tab queries `["feed", "home", viewer.key]` with `api.get<Paginated<HomeItemDto>>("/home?limit=12")`, catching `ApiError` 404 to call `/feed?limit=12` and map items to `{ kind: "post", ...item }`. Render by `kind`. Tab label "For you". Empty state "Nothing here yet" / "Work that artists share and requests that clients post appear here." Update the `OpenRequests` comment (requests now also appear in the feed as cards without social actions).
- [ ] **Step 5: `ProfilePage.tsx`**: `Requests` section (query `["postings", "user", username]`, `PostingCard` grid, heading "Your requests" for self), hidden when empty.
- [ ] **Step 6: Run → PASS.**

### Task 5: Verification

- [ ] `pnpm typecheck`, API tests, resilience, worker, e2e (add to `e2e/marketplace.spec.ts`: a client posts a request, goes home, sees it first).
- [ ] Re-seed the local database.
- [ ] Report; production needs migration 018 before the push.
