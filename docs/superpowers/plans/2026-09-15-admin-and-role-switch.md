# Admin screen, reporting and role switching: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the site owner a staff-only admin screen (reports, accounts with email-confirmed status, bug reports, removals, warnings, suspensions, audit log), let people report content and site bugs, and let accounts switch between Artist and Client under guards.

**Architecture:** One additive Oracle migration (014) holds the new columns and tables, with rules as constraints where possible. The API follows the existing `routes → service → repository` layering in a new `modules/admin` and `modules/moderation`, guarded by a database-read `requireStaff`. Every moderation write records a `moderation_actions` row in the same transaction. The web app adds a lazy `/admin` route, a Report dialog, a bug report dialog and an Account type section, all on existing primitives.

**Tech Stack:** Fastify 5 + Zod (fastify-type-provider-zod), oracledb Thin, Vitest against real Oracle, React 19 + React Router data router + TanStack Query 5, Tailwind 4, Playwright (resilience suite with stubbed API, e2e suite on the real stack).

**Spec:** `docs/superpowers/specs/2026-09-14-admin-and-role-switch-design.md`

## Global Constraints

- **Do not commit or deploy** until the developer says so. Each task ends at a green checkpoint instead of a commit.
- No AI attribution anywhere (no Co-Authored-By trailers, no mention in code or docs).
- No em dashes in any user-facing text or docs.
- Raw parameterised SQL only, and only in `*.repository.ts` files (the admin read queries live in `admin.repository.ts`). Table or column names interpolated into SQL must come from a constant map, never from input.
- Money stays integer centavos. Not touched here.
- Local tests run against Docker container `craftbid-oracle`. `pnpm --filter @craftbid/api test` empties the local database.
- Password inputs in Playwright are located with `getByRole("textbox", { name: "Password", exact: true })`.
- A new notification type means: add it to `NOTIFICATION_TYPES`, widen `ck_notifications_type` in the migration, add copy in `NotificationsPage.tsx`.
- Production migration runs before the push that needs it: `ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate`.
- Never smoke-test production by signing up through the site.
- Rule wording shown to users is placeholder text until the client supplies site rules.

## File map

API (`apps/api/src`):
- `db/migrations/014-moderation-and-roles.sql` (create)
- `plugins/auth.plugin.ts` (modify: write-time status check, `requireStaff`)
- `modules/users/users.repository.ts` (modify: `isStaff`, `roleChangedAt` on `UserRecord`)
- `modules/users/profiles.repository.ts` (modify: suspended profiles visible)
- `modules/users/users.service.ts` (modify: `isStaff` on `MeDto`)
- `modules/users/role-switch.repository.ts`, `role-switch.service.ts` (create)
- `modules/users/users.routes.ts` (modify: role switch routes)
- `modules/auth/auth.service.ts` (modify: export `startSession`, suspended sign-in message)
- `modules/auth/auth.routes.ts` (modify: export `setSession`)
- `modules/applications/applications.service.ts` (modify: suspended owner or artist checks)
- `modules/social/social.repository.ts` (modify: removed comments excluded)
- `modules/commissions/commissions.repository.ts`, `modules/reviews/reviews.repository.ts` (modify: "Removed account", review role)
- `modules/reports/reports.service.ts` (modify: comment target)
- `modules/moderation/moderation.repository.ts`, `moderation.service.ts` (create)
- `modules/admin/admin.repository.ts`, `admin.service.ts`, `admin.routes.ts`, `staff-cli.ts` (create)
- `modules/bug-reports/bug-reports.repository.ts`, `bug-reports.service.ts`, `bug-reports.routes.ts` (create)
- `app.ts` (modify: register admin and bug report routes)
- `test/helpers.ts` (modify: `resetData` covers new tables; `makeStaff`, `setStatus`)
- `test/role-switch.test.ts`, `test/moderation.test.ts`, `test/admin.test.ts` (create)
- `modules/reports/reports.service.ts` also gains the bid-receiver rule (Task 7)

Shared (`packages/shared/src`):
- `constants.ts` (modify), `types.ts` (modify), `schemas/moderation.ts` (create), `schemas/index` export (modify)

Web (`apps/web/src`):
- `lib/api.ts` (modify: `loadPrivateUrl`, `uploadForm`)
- `components/ReportButton.tsx`, `components/BugReportDialog.tsx`, `components/AccountTypeSection.tsx` (create)
- `components/FeedPost.tsx`, `components/CommentThread.tsx`, `pages/ProfilePage.tsx`, `pages/PostingDetailPage.tsx` (modify: Report)
- `components/layout/AccountMenu.tsx`, `components/layout/Header.tsx`, `components/layout/Shell.tsx` (modify: Admin item, bug report entry)
- `pages/SettingsPage.tsx` (modify: Account type), `pages/NotificationsPage.tsx` (modify: new copy)
- `pages/admin/AdminPage.tsx`, `AdminOverview.tsx`, `AdminReports.tsx`, `AdminUsers.tsx`, `AdminUserDetail.tsx`, `AdminBugs.tsx`, `AdminActivity.tsx`, `components/admin/ModerationDialog.tsx` (create)
- `App.tsx` (modify: `/admin` routes)
- `e2e-resilience/admin-and-reporting.spec.ts` (create), `e2e/moderation.spec.ts` (create)

---

### Task 1: Migration 014 and shared definitions

**Files:**
- Create: `apps/api/src/db/migrations/014-moderation-and-roles.sql`
- Modify: `packages/shared/src/constants.ts`, `packages/shared/src/types.ts`
- Create: `packages/shared/src/schemas/moderation.ts`; export it from the schemas index
- Modify: `apps/api/src/test/helpers.ts` (`resetData`)

**Interfaces:**
- Produces: `MODERATION_RULES`, `ModerationRule`, `MODERATION_RULE_COPY`, `MODERATION_ACTIONS`, `ModerationAction`, `BUG_REPORT_STATUSES`; `REPORT_TARGET_TYPES` gains `"comment"`; `NOTIFICATION_TYPES` gains `"account_warning"`, `"content_removed"`; `MeDto.isStaff: boolean`; `ReviewDto.reviewerRoleInCommission: UserRole`; DTOs `RoleSwitchStatusDto`, `AdminOverviewDto`, `AdminUserRowDto`, `AdminUserDetailDto`, `AdminReportDto`, `AdminBugReportDto`, `ModerationActionDto`; schemas `moderationInputSchema`, `resolveReportSchema`, `adminUsersQuerySchema`, `adminListQuerySchema`, `roleSwitchSchema`, `bugReportFieldsSchema`.

- [ ] **Step 1: Write the migration**

```sql
-- Moderation, bug reports, and switching between artist and client.
--
-- Additive only: every existing row stays valid, so this can run on
-- production before the code that uses it is deployed.

ALTER TABLE users ADD (
  is_staff        NUMBER(1) DEFAULT 0 NOT NULL,
  role_changed_at TIMESTAMP WITH TIME ZONE
);
ALTER TABLE users ADD CONSTRAINT ck_users_is_staff CHECK (is_staff IN (0, 1));

-- Comments become reportable, and a report records who closed it and why.
ALTER TABLE reports DROP CONSTRAINT ck_reports_target_type;
ALTER TABLE reports ADD CONSTRAINT ck_reports_target_type CHECK (target_type IN
  ('posting', 'user', 'artist_post', 'application', 'comment'));
ALTER TABLE reports ADD (
  resolved_by     RAW(16),
  resolved_at     TIMESTAMP WITH TIME ZONE,
  resolution_note VARCHAR2(1000 CHAR)
);
ALTER TABLE reports ADD CONSTRAINT fk_reports_resolved_by
  FOREIGN KEY (resolved_by) REFERENCES users (id);

-- A comment removed by staff is kept as evidence and hidden everywhere else.
ALTER TABLE post_comments ADD (
  removed_at TIMESTAMP WITH TIME ZONE,
  removed_by RAW(16)
);
ALTER TABLE post_comments ADD CONSTRAINT fk_post_comments_removed_by
  FOREIGN KEY (removed_by) REFERENCES users (id);

ALTER TABLE postings ADD (removed_at TIMESTAMP WITH TIME ZONE);

CREATE TABLE bug_reports (
  id              RAW(16)                  NOT NULL,
  reporter_id     RAW(16)                  NOT NULL,
  description     VARCHAR2(2000 CHAR)      NOT NULL,
  page_url        VARCHAR2(500 CHAR),
  user_agent      VARCHAR2(500 CHAR),
  -- Private storage key; screenshots can show someone's personal details.
  screenshot_key  VARCHAR2(300 CHAR),
  status          VARCHAR2(10 CHAR)        DEFAULT 'open' NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  resolved_at     TIMESTAMP WITH TIME ZONE,
  resolved_by     RAW(16),
  CONSTRAINT pk_bug_reports PRIMARY KEY (id),
  CONSTRAINT fk_bug_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_bug_reports_resolved_by FOREIGN KEY (resolved_by) REFERENCES users (id),
  CONSTRAINT ck_bug_reports_status CHECK (status IN ('open', 'resolved'))
);
CREATE INDEX ix_bug_reports_triage ON bug_reports (status, created_at DESC);

-- The audit log. Nothing in the application updates or deletes these rows.
CREATE TABLE moderation_actions (
  id          RAW(16)                  NOT NULL,
  staff_id    RAW(16)                  NOT NULL,
  action      VARCHAR2(30 CHAR)        NOT NULL,
  target_type VARCHAR2(20 CHAR)        NOT NULL,
  target_id   RAW(16)                  NOT NULL,
  -- The account the action concerns, so an account's history is one lookup.
  subject_user_id RAW(16),
  rule        VARCHAR2(30 CHAR),
  note        VARCHAR2(1000 CHAR),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_moderation_actions PRIMARY KEY (id),
  CONSTRAINT fk_moderation_actions_staff FOREIGN KEY (staff_id) REFERENCES users (id),
  CONSTRAINT ck_moderation_actions_action CHECK (action IN
    ('warn', 'suspend', 'unsuspend', 'remove_account', 'remove_post',
     'remove_posting', 'remove_comment', 'resolve_report', 'dismiss_report',
     'resolve_bug')),
  CONSTRAINT ck_moderation_actions_target CHECK (target_type IN
    ('user', 'artist_post', 'posting', 'comment', 'report', 'bug_report')),
  CONSTRAINT ck_moderation_actions_rule CHECK (rule IS NULL OR rule IN
    ('bullying_harassment', 'sexual_content', 'hate_speech', 'violence_threats',
     'scam_fraud', 'spam', 'stolen_work', 'impersonation', 'other'))
);
CREATE INDEX ix_moderation_actions_time ON moderation_actions (created_at DESC);
CREATE INDEX ix_moderation_actions_subject ON moderation_actions (subject_user_id, created_at DESC);

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN
  ('application_received', 'application_accepted', 'application_rejected',
   'commission_completed', 'review_received',
   'post_reaction', 'post_comment',
   'payment_submitted', 'payment_confirmed', 'payment_rejected',
   'work_finished', 'commission_shipped', 'problem_reported', 'problem_closed',
   'post_shared', 'balance_method_chosen',
   'account_warning', 'content_removed'));
```

Note: the spec listed an `account_suspended` notification; it is dropped because a suspended account cannot sign in to read it. The sign-in page message replaces it (Task 2). The spec's section 4 is already updated to match.

- [ ] **Step 2: Add shared constants** (append to `packages/shared/src/constants.ts`, and edit the two existing lists)

```ts
// In REPORT_TARGET_TYPES, add after "application":
  "comment",

// In NOTIFICATION_TYPES, add after "balance_method_chosen":
  "account_warning",
  "content_removed",

/**
 * Site rules staff act on. One list for warnings, removals and suspensions,
 * so a person is always told which rule, in the same words.
 *
 * The sentences are placeholders until the client supplies Craftbid's rules.
 */
export const MODERATION_RULES = [
  "bullying_harassment",
  "sexual_content",
  "hate_speech",
  "violence_threats",
  "scam_fraud",
  "spam",
  "stolen_work",
  "impersonation",
  "other",
] as const;
export type ModerationRule = (typeof MODERATION_RULES)[number];

export const MODERATION_RULE_COPY: Record<ModerationRule, { label: string; sentence: string }> = {
  bullying_harassment: {
    label: "Bullying or harassment",
    sentence: "Craftbid does not allow insulting, threatening or targeting other people.",
  },
  sexual_content: {
    label: "Sexual content",
    sentence: "Craftbid does not allow sexual or explicit content.",
  },
  hate_speech: {
    label: "Hate speech",
    sentence: "Craftbid does not allow attacks on people for who they are.",
  },
  violence_threats: {
    label: "Violence or threats",
    sentence: "Craftbid does not allow threats or content that promotes violence.",
  },
  scam_fraud: {
    label: "Scam or fraud",
    sentence: "Craftbid does not allow misleading people about work or payments.",
  },
  spam: {
    label: "Spam",
    sentence: "Craftbid does not allow repeated, irrelevant or promotional posting.",
  },
  stolen_work: {
    label: "Stolen work",
    sentence: "Only post work you made yourself or have the right to share.",
  },
  impersonation: {
    label: "Impersonation",
    sentence: "Craftbid does not allow pretending to be someone else.",
  },
  other: {
    label: "Breaking Craftbid's rules",
    sentence: "This goes against how Craftbid is meant to be used.",
  },
};

export const MODERATION_ACTIONS = [
  "warn",
  "suspend",
  "unsuspend",
  "remove_account",
  "remove_post",
  "remove_posting",
  "remove_comment",
  "resolve_report",
  "dismiss_report",
  "resolve_bug",
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const BUG_REPORT_STATUSES = ["open", "resolved"] as const;
export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number];

/** How long an account waits between switching artist and client. */
export const ROLE_SWITCH_COOLDOWN_DAYS = 30;
```

- [ ] **Step 3: Add shared types** (append to `packages/shared/src/types.ts`; add `isStaff` to `MeDto`; add `reviewerRoleInCommission` to `ReviewDto`)

```ts
// MeDto gains:
  /** Staff can open the admin screen. Granted only from the command line. */
  isStaff: boolean;

// ReviewDto gains:
  /** Which side the reviewer was on in that commission, whatever their role is now. */
  reviewerRoleInCommission: UserRole;

export interface RoleSwitchStatusDto {
  allowed: boolean;
  /** Plain sentences, one per reason the switch is refused. */
  blockers: string[];
  /** When the cooldown ends, if it is the reason. */
  nextAllowedAt: string | null;
}

export interface AdminOverviewDto {
  openReports: number;
  openBugReports: number;
  suspendedAccounts: number;
  unconfirmedAccounts: number;
  actionsThisWeek: number;
}

export interface AdminUserRowDto {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  isStaff: boolean;
  createdAt: string;
  /** Null when the account never confirmed its email. */
  emailConfirmedAt: string | null;
}

export interface ModerationActionDto {
  id: string;
  action: ModerationAction;
  targetType: string;
  targetId: string;
  subjectUser: { id: string; username: string } | null;
  staff: { id: string; username: string };
  rule: ModerationRule | null;
  note: string | null;
  createdAt: string;
}

export interface AdminContentItemDto {
  id: string;
  kind: "artist_post" | "posting" | "comment";
  text: string;
  createdAt: string;
  removed: boolean;
  /** Where it can be seen on the site, when it still can. */
  href: string | null;
}

export interface AdminUserDetailDto extends AdminUserRowDto {
  bio: string | null;
  history: ModerationActionDto[];
  reportsAgainst: { id: string; reason: string; status: ReportStatus; createdAt: string }[];
  recentContent: AdminContentItemDto[];
}

export interface AdminReportDto {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reporter: { id: string; username: string };
  /** What was reported, as it is now. Null when it no longer exists. */
  target: {
    text: string;
    href: string | null;
    removed: boolean;
    owner: { id: string; username: string } | null;
  } | null;
  resolution: { note: string | null; at: string; by: string } | null;
}

export interface AdminBugReportDto {
  id: string;
  description: string;
  pageUrl: string | null;
  userAgent: string | null;
  hasScreenshot: boolean;
  status: BugReportStatus;
  createdAt: string;
  reporter: { id: string; username: string; email: string };
}
```

Import `ModerationAction`, `ModerationRule`, `BugReportStatus`, `ReportStatus`, `ReportTargetType`, `UserStatus` from `./constants.js` at the top of `types.ts` alongside the existing imports.

- [ ] **Step 4: Add shared schemas** (`packages/shared/src/schemas/moderation.ts`)

```ts
import { z } from "zod";
import { MODERATION_RULES, USER_ROLES, USER_STATUSES } from "../constants.js";
import { optionalText, paginationSchema, uuidSchema } from "./common.js";

export const moderationInputSchema = z.object({
  rule: z.enum(MODERATION_RULES),
  note: optionalText(1000),
  /** The report this action settles, if it came from one. */
  reportId: uuidSchema.optional(),
});
export type ModerationInput = z.infer<typeof moderationInputSchema>;

export const unsuspendSchema = z.object({ note: optionalText(1000) });

export const resolveReportSchema = z.object({ note: optionalText(1000) });

export const adminListQuerySchema = paginationSchema.extend({
  status: z.string().max(20).optional(),
});

export const adminUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  email: z.enum(["confirmed", "unconfirmed"]).optional(),
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
});
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export const roleSwitchSchema = z.object({ role: z.enum(USER_ROLES) });

/** The text parts of a bug report; the screenshot arrives as a file part. */
export const bugReportFieldsSchema = z.object({
  description: z.string().trim().min(10).max(2000),
  pageUrl: z.string().trim().max(500).optional(),
  userAgent: z.string().trim().max(500).optional(),
});
```

Check `schemas/common.ts` exports `optionalText`, `paginationSchema`, `uuidSchema` (they are used by `review.ts` and `application.ts`). Export this file from wherever `schemas/review.ts` is re-exported (`packages/shared/src/index.ts`).

- [ ] **Step 5: Extend `resetData`** in `apps/api/src/test/helpers.ts`: insert before `DELETE FROM reports`:

```ts
    `DELETE FROM moderation_actions`,
    `DELETE FROM bug_reports`,
```

Nothing else changes: `post_comments` rows go with the `ON DELETE CASCADE` from `artist_posts` (migration 006), and every new foreign key to `users` sits on a table emptied before `DELETE FROM users`.

- [ ] **Step 6: Build, migrate, typecheck**

Run: `pnpm --filter @craftbid/shared build && pnpm db:migrate && pnpm --filter @craftbid/api typecheck && pnpm --filter @craftbid/web typecheck`
Expected: migration 014 applied; typecheck fails only where `MeDto.isStaff` and `ReviewDto.reviewerRoleInCommission` are not yet produced (`users.service.ts getMe`, `reviews.repository.ts`, web test stubs are untyped JSON so unaffected). Those are fixed in Tasks 2 and 3; to keep this checkpoint green, add them now: in `getMe` return `isStaff: row.isStaff === 1` (add `u.is_staff` to `PROFILE_SELECT` and `isStaff: number` to `ProfileRow`), and in `reviews.repository.ts` add `CASE WHEN cm.client_id = r.reviewer_id THEN 'client' ELSE 'artist' END AS reviewer_role_in_commission` with `JOIN commissions cm ON cm.id = r.commission_id`, mapped to `reviewerRoleInCommission`.

- [ ] **Step 7: Run the API suite** — `pnpm --filter @craftbid/api test`. Expected: all existing tests pass (160).

Checkpoint: no commit.

---

### Task 2: Account status enforcement

**Files:**
- Modify: `apps/api/src/modules/users/users.repository.ts`, `apps/api/src/plugins/auth.plugin.ts`, `apps/api/src/modules/users/profiles.repository.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/applications/applications.service.ts`, `apps/api/src/test/helpers.ts`
- Test: `apps/api/src/test/moderation.test.ts` (create; the `describe("account status")` block)

**Interfaces:**
- Produces: `UserRecord.isStaff: boolean`, `UserRecord.roleChangedAt: Date | null`; `fastify.requireStaff`; test helpers `setStatus(userId, status)`, `makeStaff(userId)`; error code `account_inactive` (403) for writes by a suspended or removed account; `account_suspended` (403) at sign-in.

- [ ] **Step 1: Test helpers** (append to `test/helpers.ts`)

```ts
export async function setStatus(userId: string, status: "active" | "suspended" | "deleted"): Promise<void> {
  await db.run(`UPDATE users SET status = :status WHERE id = :id`, { status, id: uuidToBuf(userId) });
}

export async function makeStaff(userId: string): Promise<void> {
  await db.run(`UPDATE users SET is_staff = 1 WHERE id = :id`, { id: uuidToBuf(userId) });
}
```

(`uuidToBuf` from `../db/ids.js`; add the import if `helpers.ts` lacks it.)

- [ ] **Step 2: Write the failing tests** (`test/moderation.test.ts`)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { bufToUuid, uuidToBuf } from "../db/ids.js";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  makeStaff,
  registerUser,
  resetData,
  setStatus,
  startCommission,
  type Session,
} from "./helpers.js";

let client: Session;
let artist: Session;

beforeEach(async () => {
  await resetData();
  client = await registerUser("client");
  artist = await registerUser("artist");
});

describe("account status", () => {
  /**
   * An access token lasts 15 minutes and carries no status. Without a check at
   * write time, a suspended account keeps posting until its token runs out.
   */
  it("stops a suspended account writing with a token issued before the suspension", async () => {
    const app = await getTestApp();
    await setStatus(artist.id, "suspended");

    const post = await app.inject({
      method: "POST",
      url: "/posts",
      headers: authHeaders(artist),
      payload: { caption: "Posted while suspended", imageIds: [] },
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().error.code).toBe("account_inactive");

    // Reading is harmless and still works for the rest of the token's life.
    expect((await app.inject({ method: "GET", url: "/feed", headers: authHeaders(artist) })).statusCode).toBe(200);
  });

  /**
   * After a switch, another device's access token still says the old role for
   * up to 15 minutes. Without this, an artist who switched to client could keep
   * bidding from a second device while posting requests from the first.
   */
  it("refuses a write carrying a role the account no longer has", async () => {
    const app = await getTestApp();
    await db.run(`UPDATE users SET role = 'client' WHERE id = :id`, { id: uuidToBuf(artist.id) });
    const post = await app.inject({
      method: "POST",
      url: "/posts",
      headers: authHeaders(artist),
      payload: { caption: "Posted with an old role", imageIds: [] },
    });
    expect(post.statusCode).toBe(401);
  });

  it("lets a suspended account sign out", async () => {
    const app = await getTestApp();
    await setStatus(client.id, "suspended");
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: authHeaders(client) });
    expect(out.statusCode).toBeLessThan(400);
  });

  it("tells a suspended account why sign-in fails, only after the right password", async () => {
    const app = await getTestApp();
    await setStatus(client.id, "suspended");
    const email = `${client.username}@example.com`;

    const wrong = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "not the password at all" } });
    expect(wrong.statusCode).toBe(401);

    const right = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "a sufficiently long password" } });
    expect(right.statusCode).toBe(403);
    expect(right.json().error.code).toBe("account_suspended");
  });

  it("keeps a suspended profile visible and hides a removed one", async () => {
    const app = await getTestApp();
    await setStatus(artist.id, "suspended");
    expect((await app.inject({ method: "GET", url: `/users/${artist.username}` })).statusCode).toBe(200);
    await setStatus(artist.id, "deleted");
    expect((await app.inject({ method: "GET", url: `/users/${artist.username}` })).statusCode).toBe(404);
  });

  it("pauses a suspended client's open request and a suspended artist's pending bid", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);

    await setStatus(client.id, "suspended");
    expect((await applyToPosting(artist, posting.id, posting.minBudgetCentavos)).statusCode).toBe(400);
    await setStatus(client.id, "active");

    const bid = await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    expect(bid.statusCode).toBe(201);
    await setStatus(artist.id, "suspended");
    const accept = await app.inject({
      method: "POST",
      url: `/applications/${bid.json().id}/accept`,
      headers: authHeaders(client),
    });
    expect(accept.statusCode).toBe(400);
  });
});
```

The file imports everything Task 5 adds to it, so later steps only append `describe` blocks. Add `import * as moderation from "../modules/moderation/moderation.service.js";` in Task 5, when the module exists.

- [ ] **Step 3: Run to confirm they fail**

Run: `pnpm --filter @craftbid/api exec vitest run src/test/moderation.test.ts`
Expected: FAIL on status codes (201/200 where 403/400 expected).

- [ ] **Step 4: Implement**

`users.repository.ts`: add `is_staff, role_changed_at` to `SELECT_USER`; `isStaff: number; roleChangedAt: Date | null` to `UserRow`; `isStaff: row.isStaff === 1, roleChangedAt: row.roleChangedAt` to `mapUser`; the same two fields on `UserRecord`.

`auth.plugin.ts`, inside the existing `onRequest` hook, after `request.user` is set:

```ts
    if (claims) {
      request.user = { id: claims.sub, role: claims.role };

      // Writes check the account is still active. The token cannot say: it
      // was issued before any suspension and stays valid for 15 minutes.
      // Signing out is always allowed.
      const writing = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (writing && request.url !== "/auth/logout") {
        const account = await findById(claims.sub);
        if (!account || account.status !== "active") {
          throw new AppError(403, "account_inactive", "This account cannot do that right now.");
        }
        // A token minted before a switch between artist and client still
        // carries the old role. A 401 makes the web app refresh, and the
        // refreshed token carries the role the account has now.
        if (account.role !== claims.role) {
          throw unauthorized("Your account changed. Please sign in again.");
        }
      }
    }
```

and a new decorator (declare `requireStaff` in the `FastifyInstance` interface):

```ts
  /**
   * The admin screen. Read from the database every time, so taking staff
   * access away, or suspending a staff account, applies to the next request.
   * A 404 rather than a 403: nothing tells a stranger the admin API exists.
   */
  app.decorate("requireStaff", async (request: FastifyRequest) => {
    if (!request.user) throw notFound();
    const account = await findById(request.user.id);
    if (!account?.isStaff || account.status !== "active") throw notFound();
  });
```

(`notFound` and `unauthorized` from `../lib/errors.js`; both take an optional message.)

`profiles.repository.ts` `findProfileByUsername`: `AND u.status IN ('active', 'suspended')`.

`auth.service.ts` `login`: replace the status check with

```ts
  if (user.status === "suspended") {
    throw new AppError(
      403,
      "account_suspended",
      "This account is suspended for breaking Craftbid's rules. If you think this is a mistake, contact Craftbid.",
    );
  }
  if (user.status !== "active") {
    throw unauthorized("This account is not active.");
  }
```

`applications.service.ts`: in `apply`, after the `posting.status !== "open"` check:

```ts
      const owner = await users.findById(posting.clientId, tx);
      if (owner?.status !== "active") {
        throw badRequest("This request is paused and is not taking bids right now.");
      }
```

in `accept`, after the `postingStatus` check (confirm `findContext` returns `artistId`; if not, add `a.artist_id` to that query and the type):

```ts
  const bidder = await users.findById(context.artistId);
  if (bidder?.status !== "active") {
    throw badRequest("This artist's account is paused, so their bid cannot be accepted right now.");
  }
```

(`import * as users from "../users/users.repository.js";`)

- [ ] **Step 5: Run the file, then the whole suite**

Run: `pnpm --filter @craftbid/api exec vitest run src/test/moderation.test.ts` → PASS.
Run: `pnpm --filter @craftbid/api test` → all pass.

- [ ] **Step 6: Mutation check** — comment out the `writing` block in `auth.plugin.ts`, rerun the first test, confirm it fails, restore.

Checkpoint: no commit.

---

### Task 3: Role switching (API)

**Files:**
- Create: `apps/api/src/modules/users/role-switch.repository.ts`, `apps/api/src/modules/users/role-switch.service.ts`
- Modify: `apps/api/src/modules/users/users.routes.ts`, `apps/api/src/modules/auth/auth.service.ts` (export `startSession`), `apps/api/src/modules/auth/auth.routes.ts` (export `setSession`)
- Test: `apps/api/src/test/role-switch.test.ts`

**Interfaces:**
- Consumes: `UserRecord.roleChangedAt`, `ROLE_SWITCH_COOLDOWN_DAYS`, `roleSwitchSchema`, `RoleSwitchStatusDto`.
- Produces: `GET /me/role-switch` → `RoleSwitchStatusDto`; `POST /me/role` `{ role }` → `{ user: MeDto, accessToken, refreshToken }` with session cookies set; `startSession(userId, role, persistent): Promise<SessionTokens>`; `setSession(reply, tokens)`.

- [ ] **Step 1: Write the failing tests** (`test/role-switch.test.ts`)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { uuidToBuf } from "../db/ids.js";
import {
  applyToPosting,
  authHeaders,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  startCommission,
  type Session,
} from "./helpers.js";

let client: Session;
let artist: Session;

beforeEach(async () => {
  await resetData();
  client = await registerUser("client");
  artist = await registerUser("artist");
});

async function status(session: Session) {
  const app = await getTestApp();
  return (await app.inject({ method: "GET", url: "/me/role-switch", headers: authHeaders(session) })).json() as {
    allowed: boolean;
    blockers: string[];
    nextAllowedAt: string | null;
  };
}

async function switchTo(session: Session, role: "client" | "artist") {
  const app = await getTestApp();
  return app.inject({ method: "POST", url: "/me/role", headers: authHeaders(session), payload: { role } });
}

describe("switching between artist and client", () => {
  it("switches an account with nothing open and hands back a session with the new role", async () => {
    expect((await status(client)).allowed).toBe(true);

    const response = await switchTo(client, "artist");
    expect(response.statusCode).toBe(200);
    const body = response.json() as { user: { role: string }; accessToken: string; refreshToken: string };
    expect(body.user.role).toBe("artist");

    // The new token can do artist things; the old one's role claim is stale
    // but the account's other sessions are gone.
    const app = await getTestApp();
    const artistOnly = await app.inject({
      method: "PATCH",
      url: "/me/artist-profile",
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: { headline: "New to making", acceptingCommissions: true, categorySlugs: ["crochet"], skills: [] },
    });
    expect(artistOnly.statusCode).toBe(200);
  });

  it("signs out every other session", async () => {
    const app = await getTestApp();
    const other = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `${client.username}@example.com`, password: "a sufficiently long password" },
    });
    const otherRefresh = (other.json() as { refreshToken: string }).refreshToken;

    await switchTo(client, "artist");

    const refreshed = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: otherRefresh } });
    expect(refreshed.statusCode).toBe(401);
  });

  it("refuses while a request is open, and says so", async () => {
    await createPosting(client);
    const view = await status(client);
    expect(view.allowed).toBe(false);
    expect(view.blockers.join(" ")).toMatch(/open craft request/i);
    expect((await switchTo(client, "artist")).statusCode).toBe(400);
  });

  it("refuses while a bid is pending", async () => {
    const posting = await createPosting(client);
    await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    expect((await status(artist)).blockers.join(" ")).toMatch(/bid/i);
    expect((await switchTo(artist, "client")).statusCode).toBe(400);
  });

  it("refuses while a commission is active, for both sides", async () => {
    await startCommission(client, artist);
    expect((await switchTo(client, "artist")).statusCode).toBe(400);
    expect((await switchTo(artist, "client")).statusCode).toBe(400);
  });

  /**
   * The reason the cooldown exists: an artist who could switch to client at
   * will could post a fake request, read every competitor's bid, and switch
   * back the same afternoon.
   */
  it("refuses a second switch within 30 days", async () => {
    expect((await switchTo(client, "artist")).statusCode).toBe(200);
    const again = await registerUser("client");
    await db.run(`UPDATE users SET role_changed_at = SYSTIMESTAMP - INTERVAL '29' DAY WHERE id = :id`, {
      id: uuidToBuf(again.id),
    });
    const view = await status(again);
    expect(view.allowed).toBe(false);
    expect(view.nextAllowedAt).not.toBeNull();
    expect((await switchTo(again, "artist")).statusCode).toBe(400);

    await db.run(`UPDATE users SET role_changed_at = SYSTIMESTAMP - INTERVAL '31' DAY WHERE id = :id`, {
      id: uuidToBuf(again.id),
    });
    expect((await switchTo(again, "artist")).statusCode).toBe(200);
  });

  it("refuses switching to the role the account already has", async () => {
    expect((await switchTo(client, "client")).statusCode).toBe(400);
  });

  it("keeps an artist's profile details through a round trip", async () => {
    const app = await getTestApp();
    await app.inject({
      method: "PATCH",
      url: "/me/artist-profile",
      headers: authHeaders(artist),
      payload: { headline: "Crochet to order", acceptingCommissions: true, categorySlugs: ["crochet"], skills: [] },
    });
    const toClient = await switchTo(artist, "client");
    expect(toClient.statusCode).toBe(200);
    await db.run(`UPDATE users SET role_changed_at = SYSTIMESTAMP - INTERVAL '31' DAY WHERE id = :id`, {
      id: uuidToBuf(artist.id),
    });
    const token = (toClient.json() as { accessToken: string }).accessToken;
    const back = await app.inject({
      method: "POST",
      url: "/me/role",
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "artist" },
    });
    expect(back.statusCode).toBe(200);
    expect((back.json() as { user: { artist?: { headline?: string } } }).user.artist?.headline).toBe("Crochet to order");
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `pnpm --filter @craftbid/api exec vitest run src/test/role-switch.test.ts` → FAIL (404 on the routes).

- [ ] **Step 3: Repository** (`modules/users/role-switch.repository.ts`)

```ts
import type { UserRole } from "@craftbid/shared";
import { uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export interface OpenWork {
  openRequests: number;
  pendingBids: number;
  activeCommissions: number;
  openProblems: number;
}

/** Everything that ties an account to its current role. */
export async function openWork(userId: string, q: Queryable = db): Promise<OpenWork> {
  const row = await q.one<{ openRequests: number; pendingBids: number; activeCommissions: number; openProblems: number }>(
    `SELECT
       (SELECT COUNT(*) FROM postings WHERE client_id = :id AND status = 'open') AS open_requests,
       (SELECT COUNT(*) FROM applications WHERE artist_id = :id AND status = 'pending') AS pending_bids,
       (SELECT COUNT(*) FROM commissions
         WHERE (client_id = :id OR artist_id = :id) AND status = 'active') AS active_commissions,
       (SELECT COUNT(*) FROM commission_problems pr
          JOIN commissions cm ON cm.id = pr.commission_id
         WHERE (cm.client_id = :id OR cm.artist_id = :id) AND pr.status = 'open') AS open_problems
     FROM dual`,
    { id: uuidToBuf(userId) },
  );
  return {
    openRequests: Number(row?.openRequests ?? 0),
    pendingBids: Number(row?.pendingBids ?? 0),
    activeCommissions: Number(row?.activeCommissions ?? 0),
    openProblems: Number(row?.openProblems ?? 0),
  };
}

export async function setRole(userId: string, role: UserRole, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE users SET role = :role, role_changed_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP WHERE id = :id`,
    { role, id: uuidToBuf(userId) },
  );
  if (role === "artist") {
    // Kept from an earlier spell as an artist, or created the first time.
    await tx.run(
      `INSERT INTO artist_profiles (user_id)
       SELECT :id FROM dual
        WHERE NOT EXISTS (SELECT 1 FROM artist_profiles WHERE user_id = :id)`,
      { id: uuidToBuf(userId) },
    );
  }
}
```

(`commission_problems.status` is `'open' | 'withdrawn' | 'resolved'`, migration 010.)

- [ ] **Step 4: Service** (`modules/users/role-switch.service.ts`)

```ts
import { ROLE_SWITCH_COOLDOWN_DAYS, type RoleSwitchStatusDto, type UserRole } from "@craftbid/shared";
import { withTransaction } from "../../db/query.js";
import { badRequest, notFound } from "../../lib/errors.js";
import * as sessions from "../auth/auth.repository.js";
import { startSession, type SessionTokens } from "../auth/auth.service.js";
import * as users from "./users.repository.js";
import * as repo from "./role-switch.repository.js";

const DAY_MS = 86_400_000;

async function assess(userId: string): Promise<RoleSwitchStatusDto & { role: UserRole }> {
  const user = await users.findById(userId);
  if (!user) throw notFound("Account not found.");

  const work = await repo.openWork(userId);
  const blockers: string[] = [];
  if (work.openRequests > 0) blockers.push("You have an open craft request. Cancel it or choose an artist first.");
  if (work.pendingBids > 0) blockers.push("You have a bid waiting for an answer. Withdraw it or wait for the client first.");
  if (work.activeCommissions > 0) blockers.push("You have a commission in progress. Finish or cancel it first.");
  if (work.openProblems > 0) blockers.push("A reported problem on one of your commissions is still open.");

  let nextAllowedAt: string | null = null;
  if (user.roleChangedAt) {
    const next = user.roleChangedAt.getTime() + ROLE_SWITCH_COOLDOWN_DAYS * DAY_MS;
    if (next > Date.now()) {
      nextAllowedAt = new Date(next).toISOString();
      blockers.push(`You switched recently. You can switch again after ${new Date(next).toDateString()}.`);
    }
  }

  return { role: user.role, allowed: blockers.length === 0, blockers, nextAllowedAt };
}

export async function getRoleSwitchStatus(userId: string): Promise<RoleSwitchStatusDto> {
  const { allowed, blockers, nextAllowedAt } = await assess(userId);
  return { allowed, blockers, nextAllowedAt };
}

/**
 * Changes the account's role and starts a fresh session carrying it.
 *
 * Every existing session is revoked, which signs out the account's other
 * devices; the caller gets the new session back, so the device that switched
 * stays signed in. The new session is persistent only if the one presented was.
 */
export async function switchRole(
  userId: string,
  role: UserRole,
  presentedRefreshToken: string | undefined,
): Promise<SessionTokens> {
  const status = await assess(userId);
  if (status.role === role) throw badRequest(`This account is already a ${role}.`);
  if (!status.allowed) throw badRequest(status.blockers.join(" "));

  const persistent = presentedRefreshToken
    ? Boolean((await sessions.findByTokenHash(hashRefreshToken(presentedRefreshToken)))?.persistent)
    : false;

  await withTransaction(async (tx) => {
    // Re-checked inside the transaction so a request posted a moment ago
    // cannot slip past the assessment above.
    const work = await repo.openWork(userId, tx);
    if (work.openRequests + work.pendingBids + work.activeCommissions + work.openProblems > 0) {
      throw badRequest("Something is still open on this account. Reload and check again.");
    }
    await repo.setRole(userId, role, tx);
    await sessions.revokeAllForUser(userId, tx);
  });

  return startSession(userId, role, persistent);
}
```

Add `import { hashRefreshToken } from "../../lib/tokens.js";`. Confirm `sessions.findByTokenHash` returns `persistent` (it does, per `refresh`).

In `auth.service.ts`, rename nothing; add below `issueTokens`:

```ts
/** A new session for an account whose details just changed. */
export function startSession(userId: string, role: UserRole, persistent: boolean): Promise<SessionTokens> {
  return issueTokens(userId, role, persistent);
}
```

In `auth.routes.ts`, change `function setSession` to `export function setSession`.

- [ ] **Step 5: Routes** (append inside `userRoutes` in `users.routes.ts`)

```ts
  app.get(
    "/me/role-switch",
    { preHandler: fastify.requireAuth },
    async (request) => roleSwitch.getRoleSwitchStatus(request.user!.id),
  );

  app.post(
    "/me/role",
    {
      preHandler: fastify.requireAuth,
      schema: { body: roleSwitchSchema.extend({ refreshToken: z.string().optional() }) },
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const tokens = await roleSwitch.switchRole(
        request.user!.id,
        request.body.role,
        request.cookies?.[REFRESH_COOKIE] ?? request.body.refreshToken,
      );
      setSession(reply, tokens);
      return reply.send({
        user: await service.getMe(tokens.userId),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    },
  );
```

Imports: `roleSwitchSchema` from `@craftbid/shared`; `* as roleSwitch from "./role-switch.service.js"`; `{ setSession } from "../auth/auth.routes.js"`; `{ REFRESH_COOKIE } from "../../lib/tokens.js"`.

- [ ] **Step 6: Run the file, mutation-check the cooldown (set `ROLE_SWITCH_COOLDOWN_DAYS` use to `0` locally, confirm the cooldown test fails, restore), run the whole suite.**

Checkpoint: no commit.

---

### Task 4: Role switching (web) and review roles

**Files:**
- Create: `apps/web/src/components/AccountTypeSection.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/pages/ProfilePage.tsx` (Reviews list), `apps/web/src/lib/auth.tsx` (no change expected; `setQueryData(["me"])` is enough)
- Test: `apps/web/e2e-resilience/admin-and-reporting.spec.ts` (create; `describe("account type")`)

**Interfaces:**
- Consumes: `GET /me/role-switch`, `POST /me/role`, `RoleSwitchStatusDto`, `ReviewDto.reviewerRoleInCommission`, `RoleBadge`, `Dialog`.

- [ ] **Step 1: Write the failing resilience tests**

Create `e2e-resilience/admin-and-reporting.spec.ts` with the same `stubApi(page, me, extra)` helper, `base`, `CLIENT`, `ARTIST`, `json` definitions as `e2e-resilience/profile-and-payments.spec.ts` (copy them verbatim, and add `isStaff: false` to `base`), then:

```ts
test.describe("account type", () => {
  test("shows why a switch is not possible", async ({ page }) => {
    await stubApi(page, () => CLIENT, (route, path) =>
      path === "/me/role-switch"
        ? route.fulfill(json({ allowed: false, blockers: ["You have an open craft request. Cancel it or choose an artist first."], nextAllowedAt: null }))
        : undefined,
    );
    await page.goto("/settings#account-type");
    const section = page.getByRole("region", { name: "Account type" });
    await expect(section.getByText("Client", { exact: true })).toBeVisible();
    await expect(section.getByText(/open craft request/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Switch to artist" })).toBeDisabled();
  });

  test("confirms, switches, and shows the new role", async ({ page }) => {
    let me: object = CLIENT;
    const posts: unknown[] = [];
    await stubApi(page, () => me, (route, path, method) => {
      if (path === "/me/role-switch") return route.fulfill(json({ allowed: true, blockers: [], nextAllowedAt: null }));
      if (path === "/me/role" && method === "POST") {
        posts.push(route.request().postDataJSON());
        me = { ...ARTIST, id: CLIENT.id, username: CLIENT.username, displayName: CLIENT.displayName };
        return route.fulfill(json({ user: me, accessToken: "x", refreshToken: "y" }));
      }
      return undefined;
    });
    await page.goto("/settings#account-type");
    const section = page.getByRole("region", { name: "Account type" });
    await section.getByRole("button", { name: "Switch to artist" }).click();

    const dialog = page.getByRole("dialog", { name: "Switch to an artist account?" });
    await expect(dialog.getByText(/signed out on your other devices/)).toBeVisible();
    expect(posts).toHaveLength(0);
    await dialog.getByRole("button", { name: "Switch to artist" }).click();

    await expect(section.getByText("Artist", { exact: true })).toBeVisible();
    expect(posts).toEqual([{ role: "artist" }]);
  });
});
```

- [ ] **Step 2: Build and run to confirm failure** — `cd apps/web && pnpm build && npx playwright test -c playwright.resilience.config.ts e2e-resilience/admin-and-reporting.spec.ts` → FAIL (no region).

- [ ] **Step 3: Component** (`components/AccountTypeSection.tsx`)

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeDto, RoleSwitchStatusDto } from "@craftbid/shared";
import { api } from "../lib/api.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Card, RoleBadge, ThreadRule } from "./ui/Primitives.js";
import { FormError } from "./ui/States.js";

const WHAT_CHANGES = {
  artist: [
    "You can build a portfolio and bid on craft requests.",
    "You can no longer post craft requests.",
    "Your reviews stay, marked with the role you had.",
  ],
  client: [
    "You can post craft requests and choose artists.",
    "You can no longer bid. Your portfolio stays on your profile as past work.",
    "Your payment details are kept for if you switch back.",
  ],
} as const;

/**
 * Switching between artist and client.
 *
 * The server decides whether it is allowed and why not; this only shows its
 * answer. The confirmation says plainly that other devices are signed out,
 * because that is the part nobody expects.
 */
export function AccountTypeSection({ me }: { me: MeDto }) {
  const queryClient = useQueryClient();
  const target = me.role === "client" ? "artist" : "client";
  const [confirming, setConfirming] = useState(false);

  const status = useQuery({
    queryKey: ["role-switch", me.id, me.role],
    queryFn: () => api.get<RoleSwitchStatusDto>("/me/role-switch"),
  });

  const change = useMutation({
    mutationFn: () => api.post<{ user: MeDto }>("/me/role", { role: target }),
    onSuccess: ({ user }) => {
      setConfirming(false);
      queryClient.setQueryData(["me"], user);
      void queryClient.invalidateQueries();
    },
  });

  return (
    <section id="account-type" aria-labelledby="account-type-title" className="scroll-mt-24">
      <Card className="p-6">
        <div className="pl-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="account-type-title" className="font-display text-xl">
              Account type
            </h2>
            <RoleBadge role={me.role} />
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {me.role === "client"
              ? "You commission work. Switch to an artist account to make and sell it instead."
              : "You make work. Switch to a client account to commission it instead."}
          </p>
          <ThreadRule className="my-4 w-14" />

          {status.data && !status.data.allowed && (
            <ul className="mb-4 space-y-1 text-sm text-rust">
              {status.data.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}

          <Button
            type="button"
            variant="secondary"
            disabled={!status.data?.allowed}
            onClick={() => setConfirming(true)}
          >
            Switch to {target}
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Switch to ${target === "artist" ? "an artist" : "a client"} account?`}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" loading={change.isPending} onClick={() => change.mutate()}>
              Switch to {target}
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {WHAT_CHANGES[target].map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>You stay signed in here and are signed out on your other devices.</li>
          <li>You cannot switch again for 30 days.</li>
        </ul>
        <FormError error={change.error} />
      </Dialog>
    </section>
  );
}
```

Check `api.post` accepts a body and returns typed JSON (it does in `api.ts`), and `Dialog` renders `actions`.

- [ ] **Step 4: Wire it in** `SettingsPage.tsx`: import and render `<AccountTypeSection me={user} />` as the last child of the `space-y-6` container (after "Where else to find you").

In `ProfilePage.tsx` `Reviews`, under the reviewer's name, add:

```tsx
<span className="text-xs text-ink-faint">
  {review.reviewerRoleInCommission === "client" ? "Client on this commission" : "Artist on this commission"}
</span>
```

- [ ] **Step 5: Build, run the spec file (PASS), then `pnpm test:resilience` (all pass).**

Checkpoint: no commit.

---

### Task 5: Moderation service (removals, warnings, suspensions, reports) with the audit log

**Files:**
- Create: `apps/api/src/modules/moderation/moderation.repository.ts`, `apps/api/src/modules/moderation/moderation.service.ts`
- Modify: `apps/api/src/modules/social/social.repository.ts` (removed comments excluded), `apps/api/src/modules/commissions/commissions.repository.ts` and `apps/api/src/modules/reviews/reviews.repository.ts` ("Removed account")
- Test: `apps/api/src/test/moderation.test.ts` (add `describe` blocks)

**Interfaces:**
- Consumes: `ModerationInput`, `notifications.notify`, `sessions.revokeAllForUser`, `postingsRepo.rejectPendingApplications(postingId, tx)`, `users.findById` (with `isStaff`).
- Produces (all `staffId` first, all `Promise<void>`): `warn(staffId, userId, input)`, `suspend(staffId, userId, input)`, `unsuspend(staffId, userId, note?)`, `removeAccount(staffId, userId, input)`, `removePost(staffId, postId, input)`, `removePosting(staffId, postingId, input)`, `removeComment(staffId, commentId, input)`, `closeReport(staffId, reportId, outcome: "reviewed" | "dismissed", note?)`, `resolveBug(staffId, bugId)`. Notification payloads: `account_warning` `{ rule, note }`; `content_removed` `{ kind: "post" | "posting" | "comment", excerpt, rule, note }`. Errors are `AppError` with `statusCode` (400 refusals, 404 missing).

- [ ] **Step 1: Write the failing tests** (append to `test/moderation.test.ts` and add `import * as moderation from "../modules/moderation/moderation.service.js";`; the other imports are already there from Task 2)

```ts
async function actionsFor(targetId: string): Promise<string[]> {
  const rows = await db.many<{ action: string }>(
    `SELECT action FROM moderation_actions WHERE target_id = :id ORDER BY created_at`,
    { id: uuidToBuf(targetId) },
  );
  return rows.map((row) => row.action);
}

async function notificationsOf(session: Session) {
  const app = await getTestApp();
  const response = await app.inject({ method: "GET", url: "/notifications?limit=50", headers: authHeaders(session) });
  return (response.json() as { items: { type: string; payload: Record<string, unknown> }[] }).items;
}

describe("moderation", () => {
  let staff: Session;
  beforeEach(async () => {
    staff = await registerUser("client");
    await makeStaff(staff.id);
  });

  it("removes a post from every public place, tells the artist which rule, and logs it", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist, "Something against the rules");

    await moderation.removePost(staff.id, post.id, { rule: "stolen_work", note: "Reported by the original maker." });

    expect((await app.inject({ method: "GET", url: `/posts/${post.id}` })).statusCode).toBe(404);
    const feed = (await app.inject({ method: "GET", url: "/feed" })).json() as { items: { id: string }[] };
    expect(feed.items.map((item) => item.id)).not.toContain(post.id);

    const notice = (await notificationsOf(artist)).find((item) => item.type === "content_removed");
    expect(notice?.payload).toMatchObject({ kind: "post", rule: "stolen_work", note: "Reported by the original maker." });
    expect(await actionsFor(post.id)).toEqual(["remove_post"]);
  });

  it("hides a removed comment, keeps it for the record, and stops it counting", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist);
    const created = await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeaders(client),
      payload: { body: "A comment that breaks the rules." },
    });
    const commentId = (created.json() as { id: string }).id;

    await moderation.removeComment(staff.id, commentId, { rule: "bullying_harassment" });

    const comments = (await app.inject({ method: "GET", url: `/posts/${post.id}/comments` })).json() as { id: string }[];
    expect(comments).toHaveLength(0);
    const detail = (await app.inject({ method: "GET", url: `/posts/${post.id}` })).json() as { commentCount: number };
    expect(detail.commentCount).toBe(0);
    const kept = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM post_comments WHERE id = :id AND removed_at IS NOT NULL`,
      { id: uuidToBuf(commentId) },
    );
    expect(Number(kept?.cnt)).toBe(1);
    expect((await notificationsOf(client)).map((item) => item.type)).toContain("content_removed");
  });

  it("removes an open request and declines its bids, but refuses one already under way", async () => {
    const posting = await createPosting(client);
    await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    await moderation.removePosting(staff.id, posting.id, { rule: "scam_fraud" });

    const row = await db.one<{ status: string; removedAt: Date | null }>(
      `SELECT status, removed_at FROM postings WHERE id = :id`,
      { id: uuidToBuf(posting.id) },
    );
    expect(row?.status).toBe("cancelled");
    expect(row?.removedAt).not.toBeNull();

    const busyArtist = await registerUser("artist");
    const busyClient = await registerUser("client");
    const commissionId = await startCommission(busyClient, busyArtist);
    const busy = await db.one<{ postingId: Buffer }>(`SELECT posting_id FROM commissions WHERE id = :id`, {
      id: uuidToBuf(commissionId),
    });
    await expect(
      moderation.removePosting(staff.id, bufToUuid(busy!.postingId)!, { rule: "scam_fraud" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("warns an account with the rule and the note", async () => {
    await moderation.warn(staff.id, client.id, { rule: "spam", note: "Please stop posting the same request." });
    const notice = (await notificationsOf(client)).find((item) => item.type === "account_warning");
    expect(notice?.payload).toMatchObject({ rule: "spam", note: "Please stop posting the same request." });
    expect(await actionsFor(client.id)).toEqual(["warn"]);
  });

  it("suspends and unsuspends, signing the account out", async () => {
    const app = await getTestApp();
    const credentials = { email: `${client.username}@example.com`, password: "a sufficiently long password" };
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: credentials });
    const refreshToken = (login.json() as { refreshToken: string }).refreshToken;

    await moderation.suspend(staff.id, client.id, { rule: "bullying_harassment" });
    expect((await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } })).statusCode).toBe(401);

    await moderation.unsuspend(staff.id, client.id, "Cleared after review.");
    expect((await app.inject({ method: "POST", url: "/auth/login", payload: credentials })).statusCode).toBe(200);
    expect(await actionsFor(client.id)).toEqual(["suspend", "unsuspend"]);
  });

  it("removes an account's public content but keeps its commissions for the other person", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist);
    const commissionId = await startCommission(client, artist);

    await moderation.removeAccount(staff.id, artist.id, { rule: "impersonation" });

    expect((await app.inject({ method: "GET", url: `/users/${artist.username}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/posts/${post.id}` })).statusCode).toBe(404);
    const view = await app.inject({ method: "GET", url: `/commissions/${commissionId}`, headers: authHeaders(client) });
    expect(view.statusCode).toBe(200);
    expect((view.json() as { artist: { displayName: string } }).artist.displayName).toBe("Removed account");
  });

  it("refuses to act on the staff member's own account or another staff account", async () => {
    const colleague = await registerUser("artist");
    await makeStaff(colleague.id);
    await expect(moderation.suspend(staff.id, staff.id, { rule: "other" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(moderation.warn(staff.id, colleague.id, { rule: "other" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("settles the report an action came from", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist);
    const report = await app.inject({
      method: "POST",
      url: "/reports",
      headers: authHeaders(client),
      payload: { targetType: "artist_post", targetId: post.id, reason: "stolen_work" },
    });
    const reportId = (report.json() as { id: string }).id;

    await moderation.removePost(staff.id, post.id, { rule: "stolen_work", reportId });
    const row = await db.one<{ status: string; resolvedBy: Buffer | null }>(
      `SELECT status, resolved_by FROM reports WHERE id = :id`,
      { id: uuidToBuf(reportId) },
    );
    expect(row?.status).toBe("reviewed");
    expect(bufToUuid(row!.resolvedBy)).toBe(staff.id);
  });
});
```

Before running, open `lib/errors.ts` and confirm the `AppError` property holding the HTTP status is `statusCode`; if it is named differently, use that name in the matchers.

- [ ] **Step 2: Run to confirm failure** → FAIL (module not found).

- [ ] **Step 3: Repository** (`modules/moderation/moderation.repository.ts`)

```ts
import type { ModerationAction, ModerationRule } from "@craftbid/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export type ActionTarget = "user" | "artist_post" | "posting" | "comment" | "report" | "bug_report";

export async function recordAction(
  input: {
    staffId: string;
    action: ModerationAction;
    targetType: ActionTarget;
    targetId: string;
    subjectUserId: string | null;
    rule?: ModerationRule;
    note?: string;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO moderation_actions (id, staff_id, action, target_type, target_id, subject_user_id, rule, note)
     VALUES (:id, :staffId, :action, :targetType, :targetId, :subjectUserId, :rule, :note)`,
    {
      id: uuidToBuf(newId()),
      staffId: uuidToBuf(input.staffId),
      action: input.action,
      targetType: input.targetType,
      targetId: uuidToBuf(input.targetId),
      subjectUserId: input.subjectUserId ? uuidToBuf(input.subjectUserId) : null,
      rule: input.rule ?? null,
      note: input.note ?? null,
    },
  );
}

/** Conditional on the current status, so two staff acting at once cannot both succeed. */
export async function setUserStatus(
  userId: string,
  from: "active" | "suspended",
  to: "active" | "suspended" | "deleted",
  tx: Queryable,
): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE users SET status = :toStatus, updated_at = SYSTIMESTAMP WHERE id = :id AND status = :fromStatus`,
    { id: uuidToBuf(userId), fromStatus: from, toStatus: to },
  );
  return changed === 1;
}

/** Takes down everything a removed account shows the public. Commissions stay. */
export async function hideAccountContent(userId: string, staffId: string, tx: Queryable): Promise<void> {
  const id = uuidToBuf(userId);
  await tx.run(`UPDATE artist_posts SET status = 'removed' WHERE artist_id = :id AND status <> 'removed'`, { id });
  await tx.run(
    `UPDATE applications SET status = 'rejected'
      WHERE status = 'pending'
        AND posting_id IN (SELECT id FROM postings WHERE client_id = :id AND status = 'open')`,
    { id },
  );
  await tx.run(
    `UPDATE postings SET status = 'cancelled', removed_at = SYSTIMESTAMP WHERE client_id = :id AND status = 'open'`,
    { id },
  );
  await tx.run(`UPDATE applications SET status = 'withdrawn' WHERE artist_id = :id AND status = 'pending'`, { id });
  await tx.run(
    `UPDATE post_comments SET removed_at = SYSTIMESTAMP, removed_by = :staffId WHERE author_id = :id AND removed_at IS NULL`,
    { id, staffId: uuidToBuf(staffId) },
  );
  await tx.run(`DELETE FROM post_shares WHERE user_id = :id`, { id });
  await tx.run(`DELETE FROM post_reactions WHERE user_id = :id`, { id });
}

export async function findPost(id: string, q: Queryable = db) {
  const row = await q.one<{ artistId: Buffer; caption: string; status: string }>(
    `SELECT artist_id, caption, status FROM artist_posts WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row ? { artistId: bufToUuid(row.artistId)!, caption: row.caption, status: row.status } : null;
}

export async function removePost(id: string, tx: Queryable): Promise<void> {
  await tx.run(`UPDATE artist_posts SET status = 'removed' WHERE id = :id`, { id: uuidToBuf(id) });
}

export async function findPosting(id: string, q: Queryable = db) {
  const row = await q.one<{ clientId: Buffer; title: string; status: string; removedAt: Date | null }>(
    `SELECT client_id, title, status, removed_at FROM postings WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row
    ? { clientId: bufToUuid(row.clientId)!, title: row.title, status: row.status, removedAt: row.removedAt }
    : null;
}

export async function removePosting(id: string, tx: Queryable): Promise<void> {
  await tx.run(`UPDATE postings SET status = 'cancelled', removed_at = SYSTIMESTAMP WHERE id = :id`, {
    id: uuidToBuf(id),
  });
}

export async function findComment(id: string, q: Queryable = db) {
  const row = await q.one<{ authorId: Buffer; body: string; removedAt: Date | null }>(
    `SELECT author_id, body, removed_at FROM post_comments WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row ? { authorId: bufToUuid(row.authorId)!, body: row.body, removedAt: row.removedAt } : null;
}

export async function removeComment(id: string, staffId: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE post_comments SET removed_at = SYSTIMESTAMP, removed_by = :staffId WHERE id = :id AND removed_at IS NULL`,
    { id: uuidToBuf(id), staffId: uuidToBuf(staffId) },
  );
}

export async function closeReport(
  reportId: string,
  staffId: string,
  outcome: "reviewed" | "dismissed",
  note: string | undefined,
  tx: Queryable,
): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE reports
        SET status = :outcome, resolved_by = :staffId, resolved_at = SYSTIMESTAMP, resolution_note = :note
      WHERE id = :id AND status = 'open'`,
    { id: uuidToBuf(reportId), staffId: uuidToBuf(staffId), outcome, note: note ?? null },
  );
  return changed === 1;
}

export async function resolveBug(bugId: string, staffId: string, tx: Queryable): Promise<boolean> {
  const changed = await tx.run(
    `UPDATE bug_reports SET status = 'resolved', resolved_at = SYSTIMESTAMP, resolved_by = :staffId
      WHERE id = :id AND status = 'open'`,
    { id: uuidToBuf(bugId), staffId: uuidToBuf(staffId) },
  );
  return changed === 1;
}
```

If `artist_posts`, `postings` or `applications` have an `updated_at` column (check migrations 002 and 003), add `updated_at = SYSTIMESTAMP` to the matching UPDATEs, as the existing repositories do.

- [ ] **Step 4: Service** (`modules/moderation/moderation.service.ts`)

```ts
import type { ModerationInput } from "@craftbid/shared";
import { withTransaction, type Queryable } from "../../db/query.js";
import { badRequest, notFound } from "../../lib/errors.js";
import * as sessions from "../auth/auth.repository.js";
import * as notifications from "../notifications/notifications.repository.js";
import * as postingsRepo from "../postings/postings.repository.js";
import * as users from "../users/users.repository.js";
import * as repo from "./moderation.repository.js";

/**
 * Everything staff can do to people and their content.
 *
 * Each action and its audit row commit together, so the log cannot miss an
 * action or record one that did not happen.
 */

const excerpt = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}...` : text);

/** Staff never act on themselves or on each other: that is how an admin gets locked out. */
async function moderatable(staffId: string, userId: string) {
  if (staffId === userId) throw badRequest("You cannot do this to your own account.");
  const user = await users.findById(userId);
  if (!user || user.status === "deleted") throw notFound("That account does not exist.");
  if (user.isStaff) throw badRequest("Staff accounts cannot be moderated from the admin screen.");
  return user;
}

/** Closes the report an action came from, if there was one and it is still open. */
async function settle(staffId: string, input: ModerationInput, tx: Queryable): Promise<void> {
  if (!input.reportId) return;
  if (await repo.closeReport(input.reportId, staffId, "reviewed", input.note, tx)) {
    await repo.recordAction(
      { staffId, action: "resolve_report", targetType: "report", targetId: input.reportId, subjectUserId: null, note: input.note },
      tx,
    );
  }
}

export async function warn(staffId: string, userId: string, input: ModerationInput): Promise<void> {
  await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    await notifications.notify(
      { userId, type: "account_warning", payload: { rule: input.rule, note: input.note ?? null } },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "warn", targetType: "user", targetId: userId, subjectUserId: userId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function suspend(staffId: string, userId: string, input: ModerationInput): Promise<void> {
  await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    if (!(await repo.setUserStatus(userId, "active", "suspended", tx))) {
      throw badRequest("This account is not active.");
    }
    await sessions.revokeAllForUser(userId, tx);
    await repo.recordAction(
      { staffId, action: "suspend", targetType: "user", targetId: userId, subjectUserId: userId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function unsuspend(staffId: string, userId: string, note?: string): Promise<void> {
  await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    if (!(await repo.setUserStatus(userId, "suspended", "active", tx))) {
      throw badRequest("This account is not suspended.");
    }
    await repo.recordAction(
      { staffId, action: "unsuspend", targetType: "user", targetId: userId, subjectUserId: userId, note },
      tx,
    );
  });
}

export async function removeAccount(staffId: string, userId: string, input: ModerationInput): Promise<void> {
  const user = await moderatable(staffId, userId);
  await withTransaction(async (tx) => {
    const from = user.status === "suspended" ? "suspended" : "active";
    if (!(await repo.setUserStatus(userId, from, "deleted", tx))) {
      throw badRequest("This account changed while you were looking at it. Reload and try again.");
    }
    await sessions.revokeAllForUser(userId, tx);
    await repo.hideAccountContent(userId, staffId, tx);
    await repo.recordAction(
      { staffId, action: "remove_account", targetType: "user", targetId: userId, subjectUserId: userId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function removePost(staffId: string, postId: string, input: ModerationInput): Promise<void> {
  const post = await repo.findPost(postId);
  if (!post || post.status === "removed") throw notFound("That post does not exist or is already removed.");
  await withTransaction(async (tx) => {
    await repo.removePost(postId, tx);
    await notifications.notify(
      {
        userId: post.artistId,
        type: "content_removed",
        payload: { kind: "post", excerpt: excerpt(post.caption), rule: input.rule, note: input.note ?? null },
      },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "remove_post", targetType: "artist_post", targetId: postId, subjectUserId: post.artistId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function removePosting(staffId: string, postingId: string, input: ModerationInput): Promise<void> {
  const posting = await repo.findPosting(postingId);
  if (!posting || posting.removedAt) throw notFound("That request does not exist or is already removed.");
  if (posting.status !== "open") {
    throw badRequest(
      "An artist is already working on this request, or it is closed. Handle it through the commission instead.",
    );
  }
  await withTransaction(async (tx) => {
    await postingsRepo.rejectPendingApplications(postingId, tx);
    await repo.removePosting(postingId, tx);
    await notifications.notify(
      {
        userId: posting.clientId,
        type: "content_removed",
        payload: { kind: "posting", excerpt: excerpt(posting.title), rule: input.rule, note: input.note ?? null },
      },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "remove_posting", targetType: "posting", targetId: postingId, subjectUserId: posting.clientId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function removeComment(staffId: string, commentId: string, input: ModerationInput): Promise<void> {
  const comment = await repo.findComment(commentId);
  if (!comment || comment.removedAt) throw notFound("That comment does not exist or is already removed.");
  await withTransaction(async (tx) => {
    await repo.removeComment(commentId, staffId, tx);
    await notifications.notify(
      {
        userId: comment.authorId,
        type: "content_removed",
        payload: { kind: "comment", excerpt: excerpt(comment.body), rule: input.rule, note: input.note ?? null },
      },
      tx,
    );
    await repo.recordAction(
      { staffId, action: "remove_comment", targetType: "comment", targetId: commentId, subjectUserId: comment.authorId, rule: input.rule, note: input.note },
      tx,
    );
    await settle(staffId, input, tx);
  });
}

export async function closeReport(
  staffId: string,
  reportId: string,
  outcome: "reviewed" | "dismissed",
  note?: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    if (!(await repo.closeReport(reportId, staffId, outcome, note, tx))) {
      throw notFound("That report does not exist or is already closed.");
    }
    await repo.recordAction(
      {
        staffId,
        action: outcome === "reviewed" ? "resolve_report" : "dismiss_report",
        targetType: "report",
        targetId: reportId,
        subjectUserId: null,
        note,
      },
      tx,
    );
  });
}

export async function resolveBug(staffId: string, bugId: string): Promise<void> {
  await withTransaction(async (tx) => {
    if (!(await repo.resolveBug(bugId, staffId, tx))) {
      throw notFound("That bug report does not exist or is already resolved.");
    }
    await repo.recordAction(
      { staffId, action: "resolve_bug", targetType: "bug_report", targetId: bugId, subjectUserId: null },
      tx,
    );
  });
}
```

- [ ] **Step 5: Hide removed comments** in `social.repository.ts`:
  - comment list (`WHERE c.post_id = :postId`): add `AND c.removed_at IS NULL`
  - comment counts (`WHERE post_id IN (${sql}) GROUP BY post_id`): add `AND removed_at IS NULL` before `GROUP BY`
  - `findComment` (`WHERE id = :id`): add `AND removed_at IS NULL`, so an author cannot hard-delete a comment staff removed
  - activity union (`FROM post_comments c WHERE c.author_id = :userId`): add `AND c.removed_at IS NULL`

- [ ] **Step 6: "Removed account"** in `commissions.repository.ts` `COMMISSION_SELECT`: replace `cl.display_name AS client_display_name` with `CASE WHEN cl.status = 'deleted' THEN 'Removed account' ELSE cl.display_name END AS client_display_name`, and `ar.display_name AS artist_display_name` likewise. In `reviews.repository.ts` and the review query in `commissions.repository.ts` (around line 97): `CASE WHEN u.status = 'deleted' THEN 'Removed account' ELSE u.display_name END AS reviewer_display_name`.

- [ ] **Step 7: Run the file (PASS), then the whole API suite.** Mutation check: drop `AND c.removed_at IS NULL` from the comment list, confirm the comment test fails, restore.

Checkpoint: no commit.

---

### Task 6: Admin API and staff CLI

**Files:**
- Create: `apps/api/src/modules/admin/admin.repository.ts`, `admin.service.ts`, `admin.routes.ts`, `staff-cli.ts`
- Modify: `apps/api/src/app.ts` (register `adminRoutes` next to `communityRoutes`), `apps/api/package.json` (script `"staff": "tsx src/modules/admin/staff-cli.ts"`)
- Test: `apps/api/src/test/admin.test.ts`

**Interfaces:**
- Consumes: `fastify.requireStaff` (Task 2), moderation service (Task 5), shared DTOs and schemas (Task 1).
- Produces: `GET /admin/overview`; `GET /admin/reports?status&limit&offset`; `POST /admin/reports/:id/resolve|dismiss` `{ note? }`; `GET /admin/users?q&email&status&role&limit&offset`; `GET /admin/users/:id`; `POST /admin/users/:id/warn|suspend|remove` (`moderationInputSchema`); `POST /admin/users/:id/unsuspend` `{ note? }`; `POST /admin/posts/:id/remove`, `/admin/postings/:id/remove`, `/admin/comments/:id/remove` (`moderationInputSchema`); `GET /admin/bugs?status`, `GET /admin/bugs/:id/screenshot`, `POST /admin/bugs/:id/resolve`; `GET /admin/actions?limit&offset`. Lists answer `{ items, total, limit, offset }`; changes answer 204; everything answers 404 to non-staff.

- [ ] **Step 1: Write the failing tests** (`test/admin.test.ts`)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { uuidToBuf } from "../db/ids.js";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  freshImageSeed,
  getTestApp,
  makeStaff,
  registerUser,
  resetData,
  testImage,
  type Session,
} from "./helpers.js";

let staff: Session;
let client: Session;
let artist: Session;

beforeEach(async () => {
  await resetData();
  staff = await registerUser("client");
  await makeStaff(staff.id);
  client = await registerUser("client");
  artist = await registerUser("artist");
});

async function get(session: Session | null, url: string) {
  const app = await getTestApp();
  return app.inject({ method: "GET", url, headers: session ? authHeaders(session) : {} });
}

async function post(session: Session, url: string, payload: Record<string, unknown> = {}) {
  const app = await getTestApp();
  return app.inject({ method: "POST", url, headers: authHeaders(session), payload });
}

describe("the admin API", () => {
  it("does not exist for anyone but staff", async () => {
    for (const url of ["/admin/overview", "/admin/reports", "/admin/users", "/admin/actions", "/admin/bugs"]) {
      expect((await get(null, url)).statusCode, url).toBe(404);
      expect((await get(client, url)).statusCode, url).toBe(404);
      expect((await get(staff, url)).statusCode, url).toBe(200);
    }
    expect((await post(client, `/admin/users/${artist.id}/warn`, { rule: "spam" })).statusCode).toBe(404);
  });

  it("stops working the moment staff access is taken away", async () => {
    expect((await get(staff, "/admin/overview")).statusCode).toBe(200);
    await db.run(`UPDATE users SET is_staff = 0 WHERE id = :id`, { id: uuidToBuf(staff.id) });
    expect((await get(staff, "/admin/overview")).statusCode).toBe(404);
  });

  /** The developer asked to see, per account, whether its email was confirmed. */
  it("lists accounts with whether each email is confirmed, and filters on it", async () => {
    await db.run(`UPDATE users SET email_verified_at = NULL WHERE id = :id`, { id: uuidToBuf(client.id) });
    await db.run(`UPDATE users SET email_verified_at = SYSTIMESTAMP WHERE id = :id`, { id: uuidToBuf(artist.id) });

    const all = (await get(staff, "/admin/users?limit=50")).json() as {
      items: { id: string; email: string; emailConfirmedAt: string | null }[];
    };
    const byId = new Map(all.items.map((row) => [row.id, row]));
    expect(byId.get(client.id)?.emailConfirmedAt).toBeNull();
    expect(byId.get(artist.id)?.emailConfirmedAt).not.toBeNull();
    expect(byId.get(client.id)?.email).toBe(`${client.username}@example.com`);

    const unconfirmed = (await get(staff, "/admin/users?email=unconfirmed&limit=50")).json() as { items: { id: string }[] };
    expect(unconfirmed.items.map((row) => row.id)).toContain(client.id);
    expect(unconfirmed.items.map((row) => row.id)).not.toContain(artist.id);

    const search = (await get(staff, `/admin/users?q=${artist.username}`)).json() as { items: { id: string }[] };
    expect(search.items.map((row) => row.id)).toEqual([artist.id]);
  });

  it("shows a report with what was reported, and removes it from there", async () => {
    const created = await createArtistPost(artist, "Reported piece");
    const report = await post(client, "/reports", { targetType: "artist_post", targetId: created.id, reason: "stolen_work" });
    const reportId = (report.json() as { id: string }).id;

    const queue = (await get(staff, "/admin/reports?status=open")).json() as {
      items: { id: string; target: { text: string; owner: { id: string } } | null }[];
    };
    const item = queue.items.find((row) => row.id === reportId);
    expect(item?.target?.text).toContain("Reported piece");
    expect(item?.target?.owner.id).toBe(artist.id);

    expect((await post(staff, `/admin/posts/${created.id}/remove`, { rule: "stolen_work", reportId })).statusCode).toBe(204);
    const open = (await get(staff, "/admin/reports?status=open")).json() as { items: { id: string }[] };
    expect(open.items.map((row) => row.id)).not.toContain(reportId);

    const log = (await get(staff, "/admin/actions")).json() as { items: { action: string }[] };
    expect(log.items.map((row) => row.action)).toEqual(expect.arrayContaining(["remove_post", "resolve_report"]));
  });

  it("shows an account's history and content", async () => {
    await createArtistPost(artist, "One of their pieces");
    await post(staff, `/admin/users/${artist.id}/warn`, { rule: "spam", note: "First warning." });
    const detail = (await get(staff, `/admin/users/${artist.id}`)).json() as {
      history: { action: string; note: string | null }[];
      recentContent: { kind: string; text: string }[];
    };
    expect(detail.history[0]).toMatchObject({ action: "warn", note: "First warning." });
    expect(detail.recentContent.some((row) => row.text.includes("One of their pieces"))).toBe(true);
  });

  it("counts what needs attention", async () => {
    await db.run(`UPDATE users SET email_verified_at = NULL WHERE id = :id`, { id: uuidToBuf(client.id) });
    const overview = (await get(staff, "/admin/overview")).json() as { unconfirmedAccounts: number; openReports: number };
    expect(overview.unconfirmedAccounts).toBeGreaterThanOrEqual(1);
    expect(overview.openReports).toBe(0);
  });
});
```

The test app runs with verification off, so the tests set `email_verified_at` directly.

- [ ] **Step 2: Run to confirm failure** → FAIL (404 for staff too).

- [ ] **Step 3: Repository** (`modules/admin/admin.repository.ts`)

```ts
import type {
  AdminBugReportDto,
  AdminContentItemDto,
  AdminOverviewDto,
  AdminUserRowDto,
  AdminUsersQuery,
  ModerationAction,
  ModerationActionDto,
  ModerationRule,
  ReportStatus,
  ReportTargetType,
  UserRole,
  UserStatus,
} from "@craftbid/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue } from "../../db/query.js";

/** Read queries for the admin screen. Every change goes through the moderation service. */

export async function overview(): Promise<AdminOverviewDto> {
  const row = await db.one<{
    openReports: number;
    openBugReports: number;
    suspendedAccounts: number;
    unconfirmedAccounts: number;
    actionsThisWeek: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports,
       (SELECT COUNT(*) FROM bug_reports WHERE status = 'open') AS open_bug_reports,
       (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended_accounts,
       (SELECT COUNT(*) FROM users WHERE status <> 'deleted' AND email_verified_at IS NULL) AS unconfirmed_accounts,
       (SELECT COUNT(*) FROM moderation_actions WHERE created_at > SYSTIMESTAMP - INTERVAL '7' DAY) AS actions_this_week
     FROM dual`,
  );
  return {
    openReports: Number(row?.openReports ?? 0),
    openBugReports: Number(row?.openBugReports ?? 0),
    suspendedAccounts: Number(row?.suspendedAccounts ?? 0),
    unconfirmedAccounts: Number(row?.unconfirmedAccounts ?? 0),
    actionsThisWeek: Number(row?.actionsThisWeek ?? 0),
  };
}

interface UserRow {
  id: Buffer;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  isStaff: number;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  bio: string | null;
}

const USER_COLUMNS = `id, username, display_name, email, role, status, is_staff, created_at, email_verified_at, bio`;

function mapUserRow(row: UserRow): AdminUserRowDto {
  return {
    id: bufToUuid(row.id)!,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    isStaff: row.isStaff === 1,
    createdAt: row.createdAt.toISOString(),
    emailConfirmedAt: row.emailVerifiedAt ? row.emailVerifiedAt.toISOString() : null,
  };
}

export async function listUsers(query: AdminUsersQuery): Promise<{ items: AdminUserRowDto[]; total: number }> {
  const where: string[] = [];
  const binds: Record<string, BindValue> = {};
  if (query.q) {
    where.push("(UPPER(username) LIKE :q OR UPPER(display_name) LIKE :q OR UPPER(email) LIKE :q)");
    // % and _ are LIKE wildcards; a search is always a plain substring.
    binds.q = `%${query.q.toUpperCase().replace(/[%_]/g, "")}%`;
  }
  if (query.email === "confirmed") where.push("email_verified_at IS NOT NULL");
  if (query.email === "unconfirmed") where.push("email_verified_at IS NULL");
  if (query.status) {
    where.push("status = :status");
    binds.status = query.status;
  }
  if (query.role) {
    where.push("role = :role");
    binds.role = query.role;
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM users ${whereClause}`, binds),
    db.many<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users ${whereClause}
        ORDER BY created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset: query.offset, limit: query.limit },
    ),
  ]);
  return { items: rows.map(mapUserRow), total: Number(count?.cnt ?? 0) };
}

export async function findUser(id: string): Promise<(AdminUserRowDto & { bio: string | null }) | null> {
  const row = await db.one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = :id`, { id: uuidToBuf(id) });
  return row ? { ...mapUserRow(row), bio: row.bio } : null;
}

interface ActionRow {
  id: Buffer;
  action: ModerationAction;
  targetType: string;
  targetId: Buffer;
  subjectUserId: Buffer | null;
  subjectUsername: string | null;
  staffId: Buffer;
  staffUsername: string;
  rule: ModerationRule | null;
  note: string | null;
  createdAt: Date;
}

const ACTION_SELECT = `
  SELECT m.id, m.action, m.target_type, m.target_id, m.subject_user_id, su.username AS subject_username,
         m.staff_id, st.username AS staff_username, m.rule, m.note, m.created_at
    FROM moderation_actions m
    JOIN users st ON st.id = m.staff_id
    LEFT JOIN users su ON su.id = m.subject_user_id
`;

function mapAction(row: ActionRow): ModerationActionDto {
  return {
    id: bufToUuid(row.id)!,
    action: row.action,
    targetType: row.targetType,
    targetId: bufToUuid(row.targetId)!,
    subjectUser: row.subjectUserId ? { id: bufToUuid(row.subjectUserId)!, username: row.subjectUsername ?? "" } : null,
    staff: { id: bufToUuid(row.staffId)!, username: row.staffUsername },
    rule: row.rule,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listActions(
  limit: number,
  offset: number,
  subjectUserId?: string,
): Promise<{ items: ModerationActionDto[]; total: number }> {
  const where = subjectUserId ? "WHERE m.subject_user_id = :subject" : "";
  const binds: Record<string, BindValue> = subjectUserId ? { subject: uuidToBuf(subjectUserId) } : {};
  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM moderation_actions m ${where}`, binds),
    db.many<ActionRow>(
      `${ACTION_SELECT} ${where} ORDER BY m.created_at DESC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset, limit },
    ),
  ]);
  return { items: rows.map(mapAction), total: Number(count?.cnt ?? 0) };
}

export async function reportsAgainst(userId: string) {
  const rows = await db.many<{ id: Buffer; reason: string; status: ReportStatus; createdAt: Date }>(
    `SELECT r.id, r.reason, r.status, r.created_at
       FROM reports r
      WHERE (r.target_type = 'user' AND r.target_id = :id)
         OR (r.target_type = 'artist_post' AND r.target_id IN (SELECT id FROM artist_posts WHERE artist_id = :id))
         OR (r.target_type = 'posting' AND r.target_id IN (SELECT id FROM postings WHERE client_id = :id))
         OR (r.target_type = 'comment' AND r.target_id IN (SELECT id FROM post_comments WHERE author_id = :id))
         OR (r.target_type = 'application' AND r.target_id IN (SELECT id FROM applications WHERE artist_id = :id))
      ORDER BY r.created_at DESC
      FETCH FIRST 50 ROWS ONLY`,
    { id: uuidToBuf(userId) },
  );
  return rows.map((row) => ({
    id: bufToUuid(row.id)!,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

function hrefFor(kind: string, id: string, postId: string | null, username: string | null): string | null {
  if (kind === "artist_post") return `/posts/${id}`;
  if (kind === "posting") return `/postings/${id}`;
  if (kind === "comment") return postId ? `/posts/${postId}` : null;
  if (kind === "user") return username ? `/artists/${username}` : null;
  return null;
}

export async function recentContent(userId: string): Promise<AdminContentItemDto[]> {
  const rows = await db.many<{
    id: Buffer;
    kind: AdminContentItemDto["kind"];
    text: string;
    createdAt: Date;
    removed: number;
    postId: Buffer | null;
  }>(
    `SELECT id, kind, text, created_at, removed, post_id FROM (
       SELECT id, CAST('artist_post' AS VARCHAR2(12)) AS kind, CAST(caption AS VARCHAR2(2000 CHAR)) AS text, created_at,
              CASE WHEN status = 'removed' THEN 1 ELSE 0 END AS removed, CAST(NULL AS RAW(16)) AS post_id
         FROM artist_posts WHERE artist_id = :id
       UNION ALL
       SELECT id, 'posting', title, created_at, CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END, NULL
         FROM postings WHERE client_id = :id
       UNION ALL
       SELECT id, 'comment', body, created_at, CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END, post_id
         FROM post_comments WHERE author_id = :id
     ) ORDER BY created_at DESC FETCH FIRST 30 ROWS ONLY`,
    { id: uuidToBuf(userId) },
  );
  return rows.map((row) => {
    const id = bufToUuid(row.id)!;
    const removed = row.removed === 1;
    return {
      id,
      kind: row.kind,
      text: row.text,
      createdAt: row.createdAt.toISOString(),
      removed,
      href: removed ? null : hrefFor(row.kind, id, bufToUuid(row.postId), null),
    };
  });
}

export interface ReportRow {
  id: Buffer;
  targetType: ReportTargetType;
  targetId: Buffer;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: Date;
  reporterId: Buffer;
  reporterUsername: string;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolverUsername: string | null;
}

export async function listReports(status: string | undefined, limit: number, offset: number) {
  const where = status ? "WHERE r.status = :status" : "";
  const binds: Record<string, BindValue> = status ? { status } : {};
  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM reports r ${where}`, binds),
    db.many<ReportRow>(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
              rp.id AS reporter_id, rp.username AS reporter_username,
              r.resolution_note, r.resolved_at, rs.username AS resolver_username
         FROM reports r
         JOIN users rp ON rp.id = r.reporter_id
         LEFT JOIN users rs ON rs.id = r.resolved_by
         ${where}
        ORDER BY r.created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset, limit },
    ),
  ]);
  return { rows, total: Number(count?.cnt ?? 0) };
}

/**
 * What a report points at, as it is now: one small query per target type,
 * picked from this fixed map, so no table name comes from the request.
 */
const TARGET_QUERIES: Record<ReportTargetType, string> = {
  artist_post: `SELECT p.caption AS text, CASE WHEN p.status = 'removed' THEN 1 ELSE 0 END AS removed,
                       u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
                  FROM artist_posts p JOIN users u ON u.id = p.artist_id WHERE p.id = :id`,
  posting: `SELECT p.title AS text, CASE WHEN p.removed_at IS NOT NULL THEN 1 ELSE 0 END AS removed,
                   u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
              FROM postings p JOIN users u ON u.id = p.client_id WHERE p.id = :id`,
  comment: `SELECT c.body AS text, CASE WHEN c.removed_at IS NOT NULL THEN 1 ELSE 0 END AS removed,
                   u.id AS owner_id, u.username AS owner_username, c.post_id
              FROM post_comments c JOIN users u ON u.id = c.author_id WHERE c.id = :id`,
  user: `SELECT u.display_name || ' (@' || u.username || ')' AS text, CASE WHEN u.status = 'deleted' THEN 1 ELSE 0 END AS removed,
                u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
           FROM users u WHERE u.id = :id`,
  application: `SELECT a.cover_letter AS text, 0 AS removed,
                       u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
                  FROM applications a JOIN users u ON u.id = a.artist_id WHERE a.id = :id`,
};

export async function reportTarget(type: ReportTargetType, targetId: Buffer) {
  const row = await db.one<{ text: string; removed: number; ownerId: Buffer; ownerUsername: string; postId: Buffer | null }>(
    TARGET_QUERIES[type],
    { id: targetId },
  );
  if (!row) return null;
  const removed = row.removed === 1;
  return {
    text: row.text,
    removed,
    href: removed ? null : hrefFor(type, bufToUuid(targetId)!, bufToUuid(row.postId), row.ownerUsername),
    owner: { id: bufToUuid(row.ownerId)!, username: row.ownerUsername },
  };
}

export async function listBugs(
  status: string | undefined,
  limit: number,
  offset: number,
): Promise<{ items: AdminBugReportDto[]; total: number }> {
  const where = status ? "WHERE b.status = :status" : "";
  const binds: Record<string, BindValue> = status ? { status } : {};
  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM bug_reports b ${where}`, binds),
    db.many<{
      id: Buffer;
      description: string;
      pageUrl: string | null;
      userAgent: string | null;
      screenshotKey: string | null;
      status: "open" | "resolved";
      createdAt: Date;
      reporterId: Buffer;
      reporterUsername: string;
      reporterEmail: string;
    }>(
      `SELECT b.id, b.description, b.page_url, b.user_agent, b.screenshot_key, b.status, b.created_at,
              u.id AS reporter_id, u.username AS reporter_username, u.email AS reporter_email
         FROM bug_reports b JOIN users u ON u.id = b.reporter_id
         ${where}
        ORDER BY b.created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset, limit },
    ),
  ]);
  return {
    total: Number(count?.cnt ?? 0),
    items: rows.map((row) => ({
      id: bufToUuid(row.id)!,
      description: row.description,
      pageUrl: row.pageUrl,
      userAgent: row.userAgent,
      hasScreenshot: Boolean(row.screenshotKey),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reporter: { id: bufToUuid(row.reporterId)!, username: row.reporterUsername, email: row.reporterEmail },
    })),
  };
}

export async function bugScreenshotKey(id: string): Promise<string | null> {
  const row = await db.one<{ screenshotKey: string | null }>(
    `SELECT screenshot_key FROM bug_reports WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row?.screenshotKey ?? null;
}

export async function setStaff(email: string, isStaff: boolean): Promise<boolean> {
  const changed = await db.run(`UPDATE users SET is_staff = :flag WHERE email = :email`, {
    flag: isStaff ? 1 : 0,
    email: email.toLowerCase(),
  });
  return changed === 1;
}

export async function listStaff(): Promise<{ email: string; username: string; status: string }[]> {
  return db.many<{ email: string; username: string; status: string }>(
    `SELECT email, username, status FROM users WHERE is_staff = 1 ORDER BY username`,
  );
}
```

- [ ] **Step 4: Service** (`modules/admin/admin.service.ts`)

```ts
import type { AdminReportDto, AdminUserDetailDto } from "@craftbid/shared";
import { bufToUuid } from "../../db/ids.js";
import { notFound } from "../../lib/errors.js";
import { getStorage } from "../../lib/storage/index.js";
import * as repo from "./admin.repository.js";

export const overview = repo.overview;
export const listUsers = repo.listUsers;
export const listBugs = repo.listBugs;

export function listActions(limit: number, offset: number) {
  return repo.listActions(limit, offset);
}

export async function listReports(status: string | undefined, limit: number, offset: number) {
  const { rows, total } = await repo.listReports(status, limit, offset);
  const items: AdminReportDto[] = await Promise.all(
    rows.map(async (row) => ({
      id: bufToUuid(row.id)!,
      targetType: row.targetType,
      targetId: bufToUuid(row.targetId)!,
      reason: row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reporter: { id: bufToUuid(row.reporterId)!, username: row.reporterUsername },
      target: await repo.reportTarget(row.targetType, row.targetId),
      resolution: row.resolvedAt
        ? { note: row.resolutionNote, at: row.resolvedAt.toISOString(), by: row.resolverUsername ?? "" }
        : null,
    })),
  );
  return { items, total };
}

export async function userDetail(id: string): Promise<AdminUserDetailDto> {
  const user = await repo.findUser(id);
  if (!user) throw notFound("That account does not exist.");
  const [history, reportsAgainst, recentContent] = await Promise.all([
    repo.listActions(50, 0, id),
    repo.reportsAgainst(id),
    repo.recentContent(id),
  ]);
  return { ...user, history: history.items, reportsAgainst, recentContent };
}

export async function bugScreenshot(id: string): Promise<Buffer> {
  const key = await repo.bugScreenshotKey(id);
  if (!key) throw notFound("That bug report has no screenshot.");
  const body = await getStorage().getPrivate(key);
  if (!body) throw notFound("That screenshot is no longer stored.");
  return body;
}
```

- [ ] **Step 5: Routes** (`modules/admin/admin.routes.ts`)

```ts
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  adminListQuerySchema,
  adminUsersQuerySchema,
  moderationInputSchema,
  paginationSchema,
  resolveReportSchema,
  unsuspendSchema,
  uuidSchema,
  type ModerationInput,
} from "@craftbid/shared";
import * as moderation from "../moderation/moderation.service.js";
import * as service from "./admin.service.js";

const idParams = z.object({ id: uuidSchema });

type Act = (staffId: string, targetId: string, input: ModerationInput) => Promise<void>;

/**
 * The admin screen's API. Staff-only through a hook that reads the flag from
 * the database on every request; every change goes through the moderation
 * service, which writes the audit row in the same transaction.
 *
 * Registered as an ordinary (encapsulated) plugin, so the hook applies to
 * these routes and nothing else.
 */
export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook("preHandler", fastify.requireStaff);

  const page = <T>(result: { items: T[]; total: number }, query: { limit: number; offset: number }) => ({
    items: result.items,
    total: result.total,
    limit: query.limit,
    offset: query.offset,
  });

  app.get("/admin/overview", async () => service.overview());

  app.get("/admin/reports", { schema: { querystring: adminListQuerySchema } }, async (request) =>
    page(await service.listReports(request.query.status, request.query.limit, request.query.offset), request.query),
  );

  for (const outcome of ["resolve", "dismiss"] as const) {
    app.post(
      `/admin/reports/:id/${outcome}`,
      { schema: { params: idParams, body: resolveReportSchema } },
      async (request, reply) => {
        await moderation.closeReport(
          request.user!.id,
          request.params.id,
          outcome === "resolve" ? "reviewed" : "dismissed",
          request.body.note,
        );
        return reply.code(204).send();
      },
    );
  }

  app.get("/admin/users", { schema: { querystring: adminUsersQuerySchema } }, async (request) =>
    page(await service.listUsers(request.query), request.query),
  );
  app.get("/admin/users/:id", { schema: { params: idParams } }, async (request) =>
    service.userDetail(request.params.id),
  );

  const actions: [string, Act][] = [
    ["/admin/users/:id/warn", moderation.warn],
    ["/admin/users/:id/suspend", moderation.suspend],
    ["/admin/users/:id/remove", moderation.removeAccount],
    ["/admin/posts/:id/remove", moderation.removePost],
    ["/admin/postings/:id/remove", moderation.removePosting],
    ["/admin/comments/:id/remove", moderation.removeComment],
  ];
  for (const [path, act] of actions) {
    app.post(path, { schema: { params: idParams, body: moderationInputSchema } }, async (request, reply) => {
      await act(request.user!.id, request.params.id, request.body);
      return reply.code(204).send();
    });
  }

  app.post(
    "/admin/users/:id/unsuspend",
    { schema: { params: idParams, body: unsuspendSchema } },
    async (request, reply) => {
      await moderation.unsuspend(request.user!.id, request.params.id, request.body.note);
      return reply.code(204).send();
    },
  );

  app.get("/admin/bugs", { schema: { querystring: adminListQuerySchema } }, async (request) =>
    page(await service.listBugs(request.query.status, request.query.limit, request.query.offset), request.query),
  );
  app.get("/admin/bugs/:id/screenshot", { schema: { params: idParams } }, async (request, reply) =>
    reply
      .header("content-type", "image/webp")
      // A screenshot can show someone's details: never kept by any cache.
      .header("cache-control", "private, no-store")
      .send(await service.bugScreenshot(request.params.id)),
  );
  app.post("/admin/bugs/:id/resolve", { schema: { params: idParams } }, async (request, reply) => {
    await moderation.resolveBug(request.user!.id, request.params.id);
    return reply.code(204).send();
  });

  app.get("/admin/actions", { schema: { querystring: paginationSchema } }, async (request) =>
    page(await service.listActions(request.query.limit, request.query.offset), request.query),
  );
};
```

The global `onSend` cache hook runs after this route's own header and must not overwrite it: the hook sets `private, no-store` for any authenticated read, which is the same value, so no conflict.

- [ ] **Step 6: Staff CLI** (`modules/admin/staff-cli.ts`), plus the `staff` script in `apps/api/package.json`

```ts
import { config } from "../../config.js";

/**
 * Who can open the admin screen. Only from here: nothing over HTTP grants it.
 *
 *   pnpm --filter @craftbid/api staff list
 *   pnpm --filter @craftbid/api staff grant <email>
 *   pnpm --filter @craftbid/api staff revoke <email>
 *
 * Point it at production with ENV_FILE=.env.adb, as with migrations.
 */
async function main(): Promise<void> {
  const [command, email] = process.argv.slice(2);
  const { initPool } = await import("../../db/pool.js");
  await initPool();
  const repo = await import("./admin.repository.js");

  console.log(`Database: ${config.db.connectString}\n`);

  if (command === "list" || !command) {
    const staff = await repo.listStaff();
    console.log(
      staff.length ? staff.map((s) => `@${s.username} <${s.email}> ${s.status}`).join("\n") : "No staff accounts.",
    );
    return;
  }

  if ((command === "grant" || command === "revoke") && email) {
    const changed = await repo.setStaff(email, command === "grant");
    console.log(
      changed
        ? `${command === "grant" ? "Granted" : "Revoked"} staff access for ${email}.`
        : `No account uses ${email}.`,
    );
    return;
  }

  throw new Error("Usage: staff list | staff grant <email> | staff revoke <email>");
}

main()
  .then(async () => {
    const { closePool } = await import("../../db/pool.js");
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error((error as Error).message ?? error);
    const { closePool } = await import("../../db/pool.js");
    await closePool();
    process.exit(1);
  });
```

- [ ] **Step 7: Run `admin.test.ts` (PASS), the whole suite, and a mutation check** (comment out the `addHook` line, confirm "does not exist for anyone but staff" fails, restore). Run `pnpm --filter @craftbid/api staff list` against the local database to confirm the CLI starts.

Checkpoint: no commit.

---

### Task 7: Reporting comments, and bug reports (API)

**Files:**
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Create: `apps/api/src/modules/bug-reports/bug-reports.repository.ts`, `bug-reports.service.ts`, `bug-reports.routes.ts`
- Modify: `apps/api/src/app.ts` (register `bugReportRoutes`)
- Test: `apps/api/src/test/admin.test.ts` (add `describe("reporting")`)

**Interfaces:**
- Produces: `POST /reports` accepts `targetType: "comment"`, refuses reporting your own post or comment (400), and accepts a bid report only from the client who received the bid (404 for anyone else); `POST /bug-reports` (multipart: `description`, `pageUrl?`, `userAgent?`, optional file `screenshot`) → 201 `{ id }`, limit 10 per hour, signed in only.

- [ ] **Step 1: Write the failing tests** (append to `admin.test.ts`)

```ts
function multipart(boundary: string, fields: Record<string, string>, file?: { name: string; body: Buffer }) {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\n`),
      file.body,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

describe("reporting", () => {
  it("accepts a report on a comment, once, and never on your own", async () => {
    const created = await createArtistPost(artist);
    const comment = await post(client, `/posts/${created.id}/comments`, { body: "Something unkind." });
    const commentId = (comment.json() as { id: string }).id;

    expect((await post(artist, "/reports", { targetType: "comment", targetId: commentId, reason: "harassment" })).statusCode).toBe(201);
    expect((await post(artist, "/reports", { targetType: "comment", targetId: commentId, reason: "harassment" })).statusCode).toBe(409);
    expect((await post(client, "/reports", { targetType: "comment", targetId: commentId, reason: "other" })).statusCode).toBe(400);
  });

  /** A bid is private to the client it was sent to, so only that client can report it. */
  it("lets only the client who received a bid report it", async () => {
    const posting = await createPosting(client);
    const bid = await applyToPosting(artist, posting.id, posting.minBudgetCentavos);
    const bidId = (bid.json() as { id: string }).id;
    const stranger = await registerUser("client");

    expect((await post(stranger, "/reports", { targetType: "application", targetId: bidId, reason: "spam" })).statusCode).toBe(404);
    expect((await post(client, "/reports", { targetType: "application", targetId: bidId, reason: "spam" })).statusCode).toBe(201);
  });

  it("takes a bug report with a screenshot that only staff can see", async () => {
    const app = await getTestApp();
    const boundary = "----craftbidbug";
    const created = await app.inject({
      method: "POST",
      url: "/bug-reports",
      headers: { ...authHeaders(client), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart(
        boundary,
        { description: "The Save changes button does nothing on my phone.", pageUrl: "/commissions/abc" },
        { name: "screenshot", body: await testImage(freshImageSeed()) },
      ),
    });
    expect(created.statusCode).toBe(201);
    const bugId = (created.json() as { id: string }).id;

    const list = (await get(staff, "/admin/bugs?status=open")).json() as {
      items: { id: string; hasScreenshot: boolean; reporter: { email: string } }[];
    };
    expect(list.items.find((row) => row.id === bugId)).toMatchObject({
      hasScreenshot: true,
      reporter: { email: `${client.username}@example.com` },
    });

    const shot = await get(staff, `/admin/bugs/${bugId}/screenshot`);
    expect(shot.statusCode).toBe(200);
    expect(shot.headers["cache-control"]).toBe("private, no-store");
    expect((await get(client, `/admin/bugs/${bugId}/screenshot`)).statusCode).toBe(404);

    expect((await post(staff, `/admin/bugs/${bugId}/resolve`)).statusCode).toBe(204);
  });

  it("refuses a bug report that says nothing useful", async () => {
    const app = await getTestApp();
    const boundary = "----craftbidbug";
    const response = await app.inject({
      method: "POST",
      url: "/bug-reports",
      headers: { ...authHeaders(client), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, { description: "broken" }),
    });
    expect(response.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

- [ ] **Step 3: Reports** — in `reports.service.ts`, add `comment: "post_comments"` to `TARGET_TABLES`; after the existing self-report check add:

```ts
  // Reporting your own work is not a report. The column name is one of two
  // literals, never taken from the request.
  if (input.targetType === "comment" || input.targetType === "artist_post") {
    const ownerColumn = input.targetType === "comment" ? "author_id" : "artist_id";
    const own = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ${table} WHERE id = :id AND ${ownerColumn} = :reporterId`,
      { id: uuidToBuf(input.targetId), reporterId: uuidToBuf(reporterId) },
    );
    if (Number(own?.cnt ?? 0) > 0) throw badRequest("You cannot report your own post or comment.");
  }

  // A bid is visible only to the client it went to; anyone else is told it
  // does not exist, exactly as the bid routes do.
  if (input.targetType === "application") {
    const receiver = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM applications a JOIN postings p ON p.id = a.posting_id
        WHERE a.id = :id AND p.client_id = :reporterId`,
      { id: uuidToBuf(input.targetId), reporterId: uuidToBuf(reporterId) },
    );
    if (Number(receiver?.cnt ?? 0) === 0) throw notFound("That item does not exist.");
  }
```

Replace the module comment's "Deliberately not a moderation system" paragraph with: "Where reports land. Staff work through them on the admin screen (modules/admin)."

- [ ] **Step 4: Bug reports**

`bug-reports.repository.ts`:

```ts
import { uuidToBuf } from "../../db/ids.js";
import { db } from "../../db/query.js";

export async function insert(input: {
  id: string;
  reporterId: string;
  description: string;
  pageUrl?: string;
  userAgent?: string;
  screenshotKey: string | null;
}): Promise<void> {
  await db.run(
    `INSERT INTO bug_reports (id, reporter_id, description, page_url, user_agent, screenshot_key)
     VALUES (:id, :reporterId, :description, :pageUrl, :userAgent, :screenshotKey)`,
    {
      id: uuidToBuf(input.id),
      reporterId: uuidToBuf(input.reporterId),
      description: input.description,
      pageUrl: input.pageUrl ?? null,
      userAgent: input.userAgent ?? null,
      screenshotKey: input.screenshotKey,
    },
  );
}
```

`bug-reports.service.ts`:

```ts
import { bugReportFieldsSchema } from "@craftbid/shared";
import { newId } from "../../db/ids.js";
import { badRequest } from "../../lib/errors.js";
import { getStorage } from "../../lib/storage/index.js";
import { normaliseImage } from "../images/images.service.js";
import * as repo from "./bug-reports.repository.js";

const TOO_SHORT = "Say what went wrong in at least a sentence.";

export async function create(
  reporterId: string,
  fields: Record<string, string>,
  screenshot: Buffer | null,
): Promise<{ id: string }> {
  const parsed = bugReportFieldsSchema.safeParse(fields);
  if (!parsed.success) throw badRequest(TOO_SHORT, { description: TOO_SHORT });

  const id = newId();
  const storage = getStorage();
  let screenshotKey: string | null = null;
  if (screenshot) {
    // Re-encoded like every upload, which drops EXIF and anything hidden in
    // the file, and private, because a screenshot can show someone's details.
    const image = await normaliseImage(screenshot);
    screenshotKey = `bug-reports/${id}.webp`;
    await storage.putPrivate(screenshotKey, image.data, "image/webp");
  }

  try {
    await repo.insert({ id, reporterId, ...parsed.data, screenshotKey });
  } catch (error) {
    if (screenshotKey) await storage.removePrivate(screenshotKey).catch(() => {});
    throw error;
  }
  return { id };
}
```

`bug-reports.routes.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { UPLOAD } from "@craftbid/shared";
import { badRequest } from "../../lib/errors.js";
import * as service from "./bug-reports.service.js";

export const bugReportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/bug-reports",
    { preHandler: fastify.requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const fields: Record<string, string> = {};
      let screenshot: Buffer | null = null;

      for await (const part of request.parts({ limits: { fileSize: UPLOAD.maxBytes, files: 1 } })) {
        if (part.type === "file") {
          const body = await part.toBuffer();
          if (part.file.truncated) {
            throw badRequest(`Screenshots must be under ${Math.floor(UPLOAD.maxBytes / (1024 * 1024))} MB.`);
          }
          if (part.fieldname === "screenshot") screenshot = body;
        } else if (typeof part.value === "string") {
          fields[part.fieldname] = part.value;
        }
      }

      return reply.code(201).send(await service.create(request.user!.id, fields, screenshot));
    },
  );
};
```

Register `bugReportRoutes` in `app.ts`. The global multipart registration already limits `fields: 10`.

- [ ] **Step 5: Run the file (PASS) and the whole suite.**

Checkpoint: no commit.

---

### Task 8: Report and bug report on the site (web)

**Files:**
- Modify: `apps/web/src/lib/api.ts` (add `loadPrivateUrl`, `postForm`)
- Create: `apps/web/src/components/ReportButton.tsx`, `apps/web/src/components/BugReportDialog.tsx`
- Modify: `apps/web/src/components/FeedPost.tsx`, `apps/web/src/components/CommentThread.tsx`, `apps/web/src/pages/ProfilePage.tsx`, `apps/web/src/pages/PostingDetailPage.tsx`, `apps/web/src/pages/PostingApplicationsPage.tsx`, `apps/web/src/components/layout/AccountMenu.tsx`, `apps/web/src/components/layout/Header.tsx`, `apps/web/src/components/layout/Shell.tsx`, `apps/web/src/pages/NotificationsPage.tsx`
- Test: `apps/web/e2e-resilience/admin-and-reporting.spec.ts` (`describe("reporting")`)

**Interfaces:**
- Consumes: `POST /reports`, `POST /bug-reports`, `useRequireAccount`, `Dialog`, `MODERATION_RULE_COPY`.
- Produces: `<ReportButton targetType targetId label? />`, `<BugReportDialog open onClose />`, `postForm<T>(path, form)`, `loadPrivateUrl(path)`; the account menu (desktop and phone) gets "Report a problem with the site", which opens `BugReportDialog`.

- [ ] **Step 1: Write the failing resilience tests** (append to `admin-and-reporting.spec.ts`)

```ts
const POST_ID = "01920000-0000-7000-8000-0000000000aa";
const OTHER_ARTIST = { ...ARTIST, id: "01920000-0000-7000-8000-000000000009", username: "lito", displayName: "Lito Weaves" };
const POST = {
  id: POST_ID,
  caption: "Abaca table runner",
  coverImage: null,
  images: [],
  artist: OTHER_ARTIST,
  createdAt: "2026-09-10T00:00:00.000Z",
  reactions: { love: 0, support: 0, like: 0, total: 0, mine: null },
  commentCount: 0,
  shareCount: 0,
  saved: false,
  shared: false,
};

test.describe("reporting", () => {
  test("reports a post with a reason, and says it was received", async ({ page }) => {
    const reports: unknown[] = [];
    await stubApi(page, () => CLIENT, (route, path, method) => {
      if (path === "/feed") return route.fulfill(json({ items: [POST], total: 1, limit: 12, offset: 0 }));
      if (path === "/reports" && method === "POST") {
        reports.push(route.request().postDataJSON());
        return route.fulfill(json({ id: "r1" }, 201));
      }
      return undefined;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "More options for this post" }).click();
    await page.getByRole("button", { name: "Report", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Report this post" });
    await dialog.getByRole("radio", { name: "It's stolen work" }).check();
    await dialog.getByLabel("Anything else? (optional)").fill("This is my photo.");
    await dialog.getByRole("button", { name: "Send report" }).click();

    await expect(dialog.getByText("Thanks. Craftbid will review it.")).toBeVisible();
    expect(reports).toEqual([{ targetType: "artist_post", targetId: POST_ID, reason: "stolen_work", details: "This is my photo." }]);
  });

  test("a second report on the same thing says so instead of failing", async ({ page }) => {
    await stubApi(page, () => CLIENT, (route, path, method) => {
      if (path === "/feed") return route.fulfill(json({ items: [POST], total: 1, limit: 12, offset: 0 }));
      if (path === "/reports" && method === "POST") {
        return route.fulfill(json({ error: { code: "conflict", message: "You have already reported this." } }, 409));
      }
      return undefined;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "More options for this post" }).click();
    await page.getByRole("button", { name: "Report", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Report this post" });
    await dialog.getByRole("radio", { name: "Spam" }).check();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByText("You already reported this. Craftbid will review it.")).toBeVisible();
  });

  test("signed out, reporting asks for an account first", async ({ page }) => {
    await stubApi(page, () => null, (route, path) =>
      path === "/feed" ? route.fulfill(json({ items: [POST], total: 1, limit: 12, offset: 0 })) : undefined,
    );
    await page.goto("/");
    await page.getByRole("button", { name: "More options for this post" }).click();
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "You need an account for that" })).toBeVisible();
  });

  test("sends a bug report from the account menu with the page filled in", async ({ page }) => {
    let body = "";
    await stubApi(page, () => CLIENT, (route, path, method) => {
      if (path === "/bug-reports" && method === "POST") {
        body = route.request().postData() ?? "";
        return route.fulfill(json({ id: "b1" }, 201));
      }
      return undefined;
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/postings");
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("banner").getByRole("button", { name: "Report a problem with the site" }).click();

    const dialog = page.getByRole("dialog", { name: "Report a problem with the site" });
    await expect(dialog.getByText("/postings")).toBeVisible();
    await dialog.getByLabel("What went wrong?").fill("The search box does not open on my tablet.");
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect(dialog.getByText("Thanks. This goes straight to the people who fix Craftbid.")).toBeVisible();
    expect(body).toContain("The search box does not open on my tablet.");
    expect(body).toContain("/postings");
  });
});
```

Confirm the sign-in popup title in `lib/authPrompt.tsx` is exactly "You need an account for that"; use whatever that file renders.

- [ ] **Step 2: Build and run to confirm failure.**

- [ ] **Step 3: API helpers** (add to `lib/api.ts`)

```ts
/** Sends a multipart form the same way as an upload, and parses the answer. */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const accessToken = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new ApiError(response.status, text ? (JSON.parse(text) as ApiErrorDto) : null);
  return (text ? JSON.parse(text) : null) as T;
}

/** Any private image the API streams (receipts, bug screenshots), as an object URL. */
export async function loadPrivateUrl(path: string): Promise<string> {
  const accessToken = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  });
  if (!response.ok) throw new ApiError(response.status, null);
  return URL.createObjectURL(await response.blob());
}
```

Then make `loadPrivateImage(commissionId, fileId)` a one-liner: `return loadPrivateUrl(\`/commissions/${commissionId}/files/${fileId}\`);`.

- [ ] **Step 4: `components/ReportButton.tsx`**

```tsx
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ReportTargetType } from "@craftbid/shared";
import { ApiError, api } from "../lib/api.js";
import { useRequireAccount } from "../lib/authPrompt.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Field, TextArea } from "./ui/Field.js";
import { FormError } from "./ui/States.js";

const REASONS = [
  { value: "harassment", label: "Bullying or harassment" },
  { value: "inappropriate", label: "Sexual or inappropriate content" },
  { value: "scam", label: "A scam or fraud" },
  { value: "stolen_work", label: "It's stolen work" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
] as const;

const NOUN: Record<ReportTargetType, string> = {
  artist_post: "post",
  comment: "comment",
  posting: "request",
  user: "profile",
  application: "bid",
};

/**
 * Report something to Craftbid. A plain dialog: a reason, optional details,
 * and an answer that does not change whether it was the first report or not,
 * so nobody learns how many other people reported the same thing.
 */
export function ReportDialog({
  open,
  onClose,
  targetType,
  targetId,
}: {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
}) {
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const name = useId();

  const send = useMutation({
    mutationFn: () =>
      api.post("/reports", { targetType, targetId, reason, ...(details.trim() ? { details: details.trim() } : {}) }),
  });
  const already = send.error instanceof ApiError && send.error.status === 409;
  const done = send.isSuccess || already;

  const close = () => {
    onClose();
    setReason("");
    setDetails("");
    send.reset();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Report this ${NOUN[targetType]}`}
      size="md"
      actions={
        done ? (
          <Button type="button" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="button" disabled={!reason} loading={send.isPending} onClick={() => send.mutate()}>
              Send report
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p>{already ? "You already reported this. Craftbid will review it." : "Thanks. Craftbid will review it."}</p>
      ) : (
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium text-ink">What is wrong with it?</legend>
            {REASONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2.5 text-sm text-ink-soft">
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <Field label="Anything else? (optional)">
            {({ id }) => (
              <TextArea id={id} value={details} maxLength={1000} onChange={(event) => setDetails(event.target.value)} />
            )}
          </Field>
          {!already && <FormError error={send.error} />}
        </div>
      )}
    </Dialog>
  );
}

/** A "Report" button for a place with room for one, which opens the dialog. */
export function ReportButton({
  targetType,
  targetId,
  className,
}: {
  targetType: ReportTargetType;
  targetId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const requireAccount = useRequireAccount();
  return (
    <>
      <button
        type="button"
        className={className ?? "text-sm text-ink-faint hover:text-rust hover:underline"}
        onClick={() => requireAccount("report something") && setOpen(true)}
      >
        Report
      </button>
      <ReportDialog open={open} onClose={() => setOpen(false)} targetType={targetType} targetId={targetId} />
    </>
  );
}
```

`requireAccount` returns false and opens the right popup for a signed-out visitor ("You need an account for that") or an unverified account ("Confirm your email first"), the same as saving or reacting.

- [ ] **Step 5: Place the Report entry points**

`FeedPost.tsx`: after the save button in the header, when the viewer is not the artist, add a "More options" disclosure holding the Report button:

```tsx
{user?.id !== post.artist.id && <PostMoreMenu postId={post.id} />}
```

with, in the same file:

```tsx
/** The "..." on a post. Only Report lives here for now. */
function PostMoreMenu({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const requireAccount = useRequireAccount();
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More options for this post"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="press rounded-md p-2 text-ink-faint transition-colors hover:bg-paper-sunk hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
          <circle cx="4" cy="9" r="1.4" />
          <circle cx="9" cy="9" r="1.4" />
          <circle cx="14" cy="9" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-md border border-fiber bg-paper-raised shadow-lift">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-rust hover:bg-rust-wash"
            onClick={() => {
              setOpen(false);
              if (requireAccount("report something")) setReporting(true);
            }}
          >
            Report
          </button>
        </div>
      )}
      <ReportDialog open={reporting} onClose={() => setReporting(false)} targetType="artist_post" targetId={postId} />
    </div>
  );
}
```

(`useAuth` is already imported in `FeedPost.tsx`; import `useState` if missing, `ReportDialog` from `./ReportButton.js`, `useRequireAccount` from `../lib/authPrompt.js`.)

`CommentThread.tsx` `Comment`: in the row under the bubble, next to Delete, when `!comment.mine`:

```tsx
{!comment.mine && <ReportButton targetType="comment" targetId={comment.id} className="hover:text-rust" />}
```

`ProfilePage.tsx`: below the username line, when `!isSelf`:

```tsx
{!isSelf && <ReportButton targetType="user" targetId={profile.id} />}
```

`PostingDetailPage.tsx`: in the category and status row, when `!isOwner`:

```tsx
{!isOwner && <ReportButton targetType="posting" targetId={posting.id} className="ml-auto text-sm text-ink-faint hover:text-rust hover:underline" />}
```

`PostingApplicationsPage.tsx` `ApplicationRow` (only the owning client reaches this page): beside the artist's `UserChip`:

```tsx
<ReportButton targetType="application" targetId={application.id} />
```

- [ ] **Step 6: `components/BugReportDialog.tsx`**

```tsx
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { postForm } from "../lib/api.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Field, TextArea } from "./ui/Field.js";
import { FormError } from "./ui/States.js";

/**
 * "Report a problem with the site". The page and browser are filled in and
 * shown before sending, so nothing is collected that the person cannot see.
 */
export function BugReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname, search } = useLocation();
  const pageUrl = `${pathname}${search}`;
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);

  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("description", description.trim());
      form.append("pageUrl", pageUrl);
      form.append("userAgent", navigator.userAgent.slice(0, 500));
      if (screenshot) form.append("screenshot", screenshot);
      return postForm<{ id: string }>("/bug-reports", form);
    },
  });

  const close = () => {
    onClose();
    setDescription("");
    setScreenshot(null);
    send.reset();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Report a problem with the site"
      size="md"
      actions={
        send.isSuccess ? (
          <Button type="button" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={description.trim().length < 10}
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              Send
            </Button>
          </>
        )
      }
    >
      {send.isSuccess ? (
        <p>Thanks. This goes straight to the people who fix Craftbid.</p>
      ) : (
        <div className="space-y-4">
          <Field label="What went wrong?" hint="What you did, what you expected, and what happened instead.">
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                value={description}
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
          <Field label="Screenshot (optional)">
            {({ id }) => (
              <input
                id={id}
                type="file"
                accept="image/*"
                className="block w-full text-sm text-ink-soft"
                onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)}
              />
            )}
          </Field>
          <dl className="rounded-md bg-paper-sunk px-3 py-2 text-xs text-ink-faint">
            <div>
              <dt className="inline font-medium">Page: </dt>
              <dd className="inline break-all">{pageUrl}</dd>
            </div>
            <div className="mt-1">
              <dt className="inline font-medium">Browser: </dt>
              <dd className="inline break-all">{navigator.userAgent}</dd>
            </div>
          </dl>
          <FormError error={send.error} />
        </div>
      )}
    </Dialog>
  );
}
```

- [ ] **Step 7: Entry points for bug reports.** `AccountMenu.tsx`: add a prop `onReportBug: () => void` and, in the bottom block above Sign out, a button with the same classes as the links: "Report a problem with the site", which closes the menu and calls `onReportBug`. `Header.tsx`: hold `const [reportingBug, setReportingBug] = useState(false)`, pass `onReportBug={() => setReportingBug(true)}`, add the same entry as a ghost `Button` in the phone menu before Sign out (closing the menu first), and render `<BugReportDialog open={reportingBug} onClose={() => setReportingBug(false)} />` beside the sign-out Dialog.

Footer (`Shell.tsx`): for a signed-in reader, add a third footer column:

```tsx
{user && (
  <div>
    <h2 className="eyebrow mb-3">Help</h2>
    <ul className="space-y-2 text-ink-soft">
      <li>
        <button type="button" className="hover:text-ink hover:underline" onClick={() => setReportingBug(true)}>
          Report a problem with the site
        </button>
      </li>
    </ul>
  </div>
)}
```

with `const { user } = useAuth();`, `const [reportingBug, setReportingBug] = useState(false);` and `<BugReportDialog open={reportingBug} onClose={() => setReportingBug(false)} />` inside `Shell`. The dialog reads `useLocation`, so it must render inside the router, which `Shell` is.

- [ ] **Step 8: Notification copy** (`NotificationsPage.tsx`)

```ts
// COPY additions:
  account_warning: "A warning from Craftbid.",
  content_removed: "Craftbid removed something you posted.",
```

and in `describe`:

```ts
  if (notification.type === "account_warning" || notification.type === "content_removed") {
    const payload = notification.payload as { rule?: ModerationRule; note?: string | null; kind?: string; excerpt?: string };
    const rule = payload.rule ? MODERATION_RULE_COPY[payload.rule] : null;
    const what = { post: "post", posting: "request", comment: "comment" }[payload.kind ?? ""] ?? "post";
    const head =
      notification.type === "account_warning"
        ? `Warning from Craftbid${rule ? `: ${rule.label}.` : "."}`
        : `We removed your ${what}${payload.excerpt ? ` "${payload.excerpt}"` : ""}${rule ? `: ${rule.label}.` : "."}`;
    return [head, rule?.sentence, payload.note].filter(Boolean).join(" ");
  }
```

and in `linkFor`, before the fallback: `if (notification.type === "account_warning" || notification.type === "content_removed") return "/notifications";`. Import `MODERATION_RULE_COPY` and `type ModerationRule` from `@craftbid/shared`.

- [ ] **Step 9: Build, run the spec file (PASS), run `pnpm test:resilience` (all pass), `pnpm --filter @craftbid/web typecheck`.**

Checkpoint: no commit.

---

### Task 9: Admin screen (web)

**Files:**
- Create: `apps/web/src/pages/admin/AdminPage.tsx`, `AdminOverview.tsx`, `AdminReports.tsx`, `AdminUsers.tsx`, `AdminUserDetail.tsx`, `AdminBugs.tsx`, `AdminActivity.tsx`, `apps/web/src/components/admin/ModerationDialog.tsx`, `apps/web/src/components/admin/adminCopy.ts`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/layout/AccountMenu.tsx` (`accountLinks` adds Admin for staff)
- Test: `apps/web/e2e-resilience/admin-and-reporting.spec.ts` (`describe("admin screen")`)

**Interfaces:**
- Consumes: every `/admin/*` route (Task 6, 7), `MeDto.isStaff`, `MODERATION_RULES`, `MODERATION_RULE_COPY`, `RoleBadge`, `Dialog`, `loadPrivateUrl`.
- Produces: routes `/admin` (tabs through `?tab=overview|reports|users|bugs|activity`) and `/admin/users/:id`.

- [ ] **Step 1: Write the failing resilience tests** (append to `admin-and-reporting.spec.ts`)

```ts
const STAFF = { ...CLIENT, id: "01920000-0000-7000-8000-0000000000ff", username: "ptheusen", displayName: "Ptheusen", isStaff: true };
const USERS = [
  { id: CLIENT.id, username: "maya", displayName: "Maya Dela Cruz", email: "maya@example.com", role: "client", status: "active", isStaff: false, createdAt: "2026-09-01T00:00:00.000Z", emailConfirmedAt: "2026-09-02T03:00:00.000Z" },
  { id: ARTIST.id, username: "nena", displayName: "Nena Hooks", email: "nena@example.com", role: "artist", status: "suspended", isStaff: false, createdAt: "2026-09-03T00:00:00.000Z", emailConfirmedAt: null },
];

test.describe("admin screen", () => {
  test("is not there for someone who is not staff", async ({ page }) => {
    const calls = await stubApi(page, () => CLIENT);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
    expect(calls.some((call) => call.includes("/admin/"))).toBe(false);

    await page.getByRole("button", { name: "Account and settings" }).click();
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("lists accounts with confirmed and not confirmed emails, and filters", async ({ page }) => {
    const urls: string[] = [];
    await stubApi(page, () => STAFF, (route, path) => {
      if (path === "/admin/users") {
        urls.push(route.request().url());
        const email = new URL(route.request().url()).searchParams.get("email");
        const items = email === "unconfirmed" ? USERS.filter((u) => !u.emailConfirmedAt) : USERS;
        return route.fulfill(json({ items, total: items.length, limit: 25, offset: 0 }));
      }
      return undefined;
    });
    await page.goto("/admin?tab=users");

    const maya = page.getByRole("row", { name: /maya@example.com/ });
    await expect(maya.getByText("Email confirmed")).toBeVisible();
    const nena = page.getByRole("row", { name: /nena@example.com/ });
    await expect(nena.getByText("Not confirmed")).toBeVisible();
    await expect(nena.getByText("Suspended")).toBeVisible();

    await page.getByLabel("Email").selectOption("unconfirmed");
    await expect(page.getByRole("row", { name: /maya@example.com/ })).toHaveCount(0);
    expect(urls.at(-1)).toContain("email=unconfirmed");
  });

  test("removes a reported post with a rule, and the report leaves the queue", async ({ page }) => {
    let open = true;
    const removals: unknown[] = [];
    await stubApi(page, () => STAFF, (route, path, method) => {
      if (path === "/admin/reports") {
        const items = open
          ? [{
              id: "01920000-0000-7000-8000-0000000000r1",
              targetType: "artist_post",
              targetId: POST_ID,
              reason: "stolen_work",
              details: "This is my photo.",
              status: "open",
              createdAt: "2026-09-14T00:00:00.000Z",
              reporter: { id: CLIENT.id, username: "maya" },
              target: { text: "Abaca table runner", href: `/posts/${POST_ID}`, removed: false, owner: { id: OTHER_ARTIST.id, username: "lito" } },
              resolution: null,
            }]
          : [];
        return route.fulfill(json({ items, total: items.length, limit: 25, offset: 0 }));
      }
      if (path === `/admin/posts/${POST_ID}/remove` && method === "POST") {
        removals.push(route.request().postDataJSON());
        open = false;
        return route.fulfill({ status: 204 });
      }
      return undefined;
    });
    await page.goto("/admin?tab=reports");

    const report = page.getByRole("article", { name: /Abaca table runner/ });
    await expect(report.getByText("This is my photo.")).toBeVisible();
    await report.getByRole("button", { name: "Remove post" }).click();

    const dialog = page.getByRole("dialog", { name: "Remove this post" });
    await dialog.getByLabel("Rule").selectOption("stolen_work");
    await expect(dialog.getByText(/Only post work you made yourself/)).toBeVisible();
    await dialog.getByRole("button", { name: "Remove post" }).click();

    await expect(page.getByText("No open reports")).toBeVisible();
    expect(removals).toEqual([{ rule: "stolen_work", reportId: "01920000-0000-7000-8000-0000000000r1" }]);
  });

  test("works at phone width without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stubApi(page, () => STAFF, (route, path) =>
      path === "/admin/users" ? route.fulfill(json({ items: USERS, total: 2, limit: 25, offset: 0 })) : undefined,
    );
    await page.goto("/admin?tab=users");
    await expect(page.getByText("nena@example.com")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
```

Add a stub default for `/admin/overview` in the tests that land on the overview (not needed above), and make `stubApi` in this file return `calls` like the other spec.

- [ ] **Step 2: Build and run to confirm failure.**

- [ ] **Step 3: Shared admin copy** (`components/admin/adminCopy.ts`)

```ts
import type { ModerationAction, UserStatus } from "@craftbid/shared";

export const ACTION_LABEL: Record<ModerationAction, string> = {
  warn: "Warned",
  suspend: "Suspended",
  unsuspend: "Unsuspended",
  remove_account: "Removed account",
  remove_post: "Removed post",
  remove_posting: "Removed request",
  remove_comment: "Removed comment",
  resolve_report: "Resolved report",
  dismiss_report: "Dismissed report",
  resolve_bug: "Resolved bug report",
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  deleted: "Removed",
};

export const REPORT_REASON_LABEL: Record<string, string> = {
  harassment: "Bullying or harassment",
  inappropriate: "Sexual or inappropriate",
  scam: "Scam or fraud",
  stolen_work: "Stolen work",
  spam: "Spam",
  other: "Something else",
};

export const TARGET_LABEL: Record<"artist_post" | "posting" | "comment" | "user" | "application", string> = {
  artist_post: "Post",
  posting: "Request",
  comment: "Comment",
  user: "Profile",
  application: "Bid",
};

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}
```

- [ ] **Step 4: `components/admin/ModerationDialog.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MODERATION_RULES, MODERATION_RULE_COPY, type ModerationRule } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { Field, Select, TextArea } from "../ui/Field.js";
import { FormError } from "../ui/States.js";

export interface ModerationTarget {
  /** Dialog title and button, for example "Remove post". */
  verb: string;
  /** Title noun, for example "this post". */
  noun: string;
  path: string;
  reportId?: string;
  /** Whether the person is told, and how, shown before sending. */
  preview: (rule: ModerationRule | null) => string;
  danger?: boolean;
}

/**
 * Every staff action goes through this: a rule, an optional note, and the
 * exact words the person will see, before anything is sent.
 */
export function ModerationDialog({ target, onClose }: { target: ModerationTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rule, setRule] = useState<ModerationRule | "">("");
  const [note, setNote] = useState("");

  const act = useMutation({
    mutationFn: () =>
      api.post(target!.path, {
        rule,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(target!.reportId ? { reportId: target!.reportId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      close();
    },
  });

  function close() {
    setRule("");
    setNote("");
    act.reset();
    onClose();
  }

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      title={target ? `${target.verb.split(" ")[0]} ${target.noun}` : ""}
      size="md"
      actions={
        <>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={target?.danger ? "danger" : "primary"}
            disabled={!rule}
            loading={act.isPending}
            onClick={() => act.mutate()}
          >
            {target?.verb}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Rule" required>
          {({ id }) => (
            <Select id={id} value={rule} onChange={(event) => setRule(event.target.value as ModerationRule)}>
              <option value="" disabled>
                Choose the rule it broke
              </option>
              {MODERATION_RULES.map((value) => (
                <option key={value} value={value}>
                  {MODERATION_RULE_COPY[value].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Note to them (optional)">
          {({ id }) => <TextArea id={id} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        {target && (
          <div className="rounded-md bg-paper-sunk px-3 py-2 text-sm text-ink-soft">
            <p className="eyebrow mb-1">What they will see</p>
            <p>
              {/* Built the way the notification is: "We removed your post: Stolen work." */}
              {target.preview(rule || null).replace(/\.$/, "")}
              {rule ? `: ${MODERATION_RULE_COPY[rule].label}. ${MODERATION_RULE_COPY[rule].sentence}` : "."} {note.trim()}
            </p>
          </div>
        )}
        <FormError error={act.error} />
      </div>
    </Dialog>
  );
}
```

The dialog title for "Remove post" with noun "this post" reads "Remove this post", matching the test.

- [ ] **Step 5: `pages/admin/AdminPage.tsx`**

```tsx
import { useSearchParams } from "react-router-dom";
import { Page } from "../../components/layout/Shell.js";
import { cx } from "../../lib/cx.js";
import { PageHeading } from "../../components/ui/States.js";
import { AdminActivity } from "./AdminActivity.js";
import { AdminBugs } from "./AdminBugs.js";
import { AdminOverview } from "./AdminOverview.js";
import { AdminReports } from "./AdminReports.js";
import { AdminUsers } from "./AdminUsers.js";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reports", label: "Reports" },
  { key: "users", label: "Users" },
  { key: "bugs", label: "Bug reports" },
  { key: "activity", label: "Activity log" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** The staff screen. The tab lives in the address so a link can open straight to it. */
export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((item) => item.key === params.get("tab"))?.key ?? "overview") as Tab;

  return (
    <Page>
      <PageHeading eyebrow="Staff only" title="Admin" />
      <nav aria-label="Admin sections" className="-mx-4 mb-6 overflow-x-auto px-4">
        <ul className="flex w-max gap-1 rounded-md border border-fiber bg-paper-raised p-1">
          {TABS.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                aria-current={tab === item.key ? "page" : undefined}
                onClick={() => setParams({ tab: item.key })}
                className={cx(
                  "whitespace-nowrap rounded-sm px-3 py-1.5 text-sm transition-colors",
                  tab === item.key ? "bg-indigo text-paper-raised" : "text-ink-soft hover:text-ink",
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {tab === "overview" && <AdminOverview />}
      {tab === "reports" && <AdminReports />}
      {tab === "users" && <AdminUsers />}
      {tab === "bugs" && <AdminBugs />}
      {tab === "activity" && <AdminActivity />}
    </Page>
  );
}
```

- [ ] **Step 6: `pages/admin/AdminOverview.tsx`**

```tsx
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AdminOverviewDto } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Card } from "../../components/ui/Primitives.js";
import { ErrorState, RowSkeleton } from "../../components/ui/States.js";

export function AdminOverview() {
  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<AdminOverviewDto>("/admin/overview"),
  });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <RowSkeleton count={2} />;

  const tiles = [
    { label: "Open reports", value: data.openReports, to: "/admin?tab=reports" },
    { label: "Open bug reports", value: data.openBugReports, to: "/admin?tab=bugs" },
    { label: "Suspended accounts", value: data.suspendedAccounts, to: "/admin?tab=users" },
    { label: "Emails not confirmed", value: data.unconfirmedAccounts, to: "/admin?tab=users" },
    { label: "Actions this week", value: data.actionsThisWeek, to: "/admin?tab=activity" },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <li key={tile.label}>
          <Link to={tile.to} className="block">
            <Card interactive className="p-5">
              <p className="pl-3 text-sm text-ink-soft">{tile.label}</p>
              <p className="pl-3 font-display text-4xl tabular">{tile.value}</p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: `pages/admin/AdminUsers.tsx`**

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AdminUserRowDto, Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { cx } from "../../lib/cx.js";
import { Field, Select, TextInput } from "../../components/ui/Field.js";
import { RoleBadge } from "../../components/ui/Primitives.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { STATUS_LABEL, when } from "../../components/admin/adminCopy.js";

/** Whether the account proved its address by following the emailed link. */
export function EmailBadge({ confirmedAt }: { confirmedAt: string | null }) {
  return (
    <span
      title={confirmedAt ? `Confirmed ${when(confirmedAt)}` : "Never followed the confirmation link"}
      className={cx(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold",
        confirmedAt ? "bg-sage-wash text-sage" : "bg-amber-wash text-amber",
      )}
    >
      {confirmedAt ? "Email confirmed" : "Not confirmed"}
    </span>
  );
}

export function AdminUsers() {
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");

  const params = new URLSearchParams({ limit: "25" });
  if (q.trim()) params.set("q", q.trim());
  if (email) params.set("email", email);
  if (status) params.set("status", status);
  if (role) params.set("role", role);

  const { data, error, refetch, isPending } = useQuery({
    queryKey: ["admin", "users", params.toString()],
    queryFn: () => api.get<Paginated<AdminUserRowDto>>(`/admin/users?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search">
          {({ id }) => <TextInput id={id} type="search" placeholder="Name, username or email" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <Field label="Email">
          {({ id }) => (
            <Select id={id} value={email} onChange={(e) => setEmail(e.target.value)}>
              <option value="">Any</option>
              <option value="confirmed">Confirmed</option>
              <option value="unconfirmed">Not confirmed</option>
            </Select>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Removed</option>
            </Select>
          )}
        </Field>
        <Field label="Role">
          {({ id }) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Any</option>
              <option value="client">Client</option>
              <option value="artist">Artist</option>
            </Select>
          )}
        </Field>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <RowSkeleton count={5} />
      ) : data!.items.length === 0 ? (
        <EmptyState title="No accounts match" description="Try a different search or filter." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-fiber bg-paper-raised">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Accounts</caption>
            <thead className="border-b border-fiber text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Account</th>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {data!.items.map((user) => (
                <tr key={user.id} className="border-b border-fiber last:border-0">
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${user.id}`} className="font-medium text-indigo hover:underline">
                      {user.displayName}
                    </Link>
                    <span className="block text-xs text-ink-faint">@{user.username}{user.isStaff ? " · staff" : ""}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="block break-all">{user.email}</span>
                    <EmailBadge confirmedAt={user.emailConfirmedAt} />
                  </td>
                  <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                  <td className={cx("px-4 py-3", user.status !== "active" && "font-medium text-rust")}>{STATUS_LABEL[user.status]}</td>
                  <td className="px-4 py-3 text-ink-soft">{when(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-fiber px-4 py-2 text-xs text-ink-faint">
            Showing {data!.items.length} of {data!.total}
          </p>
        </div>
      )}
    </div>
  );
}
```

The table sits in its own `overflow-x-auto` box, so the page never scrolls sideways at 375px. Check `Paginated` is exported from `@craftbid/shared` (it is) and `amber-wash`/`amber` tokens exist (they do, `index.css`).

- [ ] **Step 8: `pages/admin/AdminReports.tsx`**

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminReportDto, Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Primitives.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { ModerationDialog, type ModerationTarget } from "../../components/admin/ModerationDialog.js";
import { REPORT_REASON_LABEL, TARGET_LABEL, when } from "../../components/admin/adminCopy.js";

const REMOVE: Record<string, { path: string; verb: string; noun: string; kind: string } | undefined> = {
  artist_post: { path: "posts", verb: "Remove post", noun: "this post", kind: "post" },
  posting: { path: "postings", verb: "Remove request", noun: "this request", kind: "request" },
  comment: { path: "comments", verb: "Remove comment", noun: "this comment", kind: "comment" },
};

export function AdminReports() {
  const [status, setStatus] = useState<"open" | "reviewed" | "dismissed">("open");
  const [target, setTarget] = useState<ModerationTarget | null>(null);
  const queryClient = useQueryClient();

  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "reports", status],
    queryFn: () => api.get<Paginated<AdminReportDto>>(`/admin/reports?status=${status}&limit=25`),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/admin/reports/${id}/dismiss`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {(["open", "reviewed", "dismissed"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={status === value ? "primary" : "secondary"} onClick={() => setStatus(value)}>
            {value === "open" ? "Open" : value === "reviewed" ? "Acted on" : "Dismissed"}
          </Button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <RowSkeleton count={3} />
      ) : data.items.length === 0 ? (
        <EmptyState title={status === "open" ? "No open reports" : "Nothing here"} description="Reports people send from the site land here." />
      ) : (
        <ul className="space-y-4">
          {data.items.map((report) => {
            const removal = REMOVE[report.targetType];
            const headingId = `report-${report.id}`;
            return (
              <li key={report.id}>
                <article aria-labelledby={headingId}>
                  <Card className="p-5">
                    <div className="space-y-3 pl-3">
                      <p className="text-xs text-ink-faint">
                        {TARGET_LABEL[report.targetType]} · {REPORT_REASON_LABEL[report.reason] ?? report.reason} · reported by @{report.reporter.username} · {when(report.createdAt)}
                      </p>
                      <h3 id={headingId} className="whitespace-pre-wrap break-words font-medium text-ink">
                        {report.target ? report.target.text : "This no longer exists."}
                        {report.target?.removed && <span className="ml-2 text-xs font-semibold uppercase text-rust">Removed</span>}
                      </h3>
                      {report.details && <p className="rounded-md bg-paper-sunk px-3 py-2 text-sm text-ink-soft">{report.details}</p>}
                      {report.target?.owner && (
                        <p className="text-sm text-ink-soft">
                          By <Link className="text-indigo hover:underline" to={`/admin/users/${report.target.owner.id}`}>@{report.target.owner.username}</Link>
                          {report.target.href && (
                            <>
                              {" · "}
                              <Link className="text-indigo hover:underline" to={report.target.href}>View on the site</Link>
                            </>
                          )}
                        </p>
                      )}
                      {report.resolution && (
                        <p className="text-xs text-ink-faint">
                          Closed by @{report.resolution.by} · {when(report.resolution.at)}{report.resolution.note ? ` · ${report.resolution.note}` : ""}
                        </p>
                      )}
                      {report.status === "open" && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {removal && report.target && !report.target.removed && (
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                setTarget({
                                  verb: removal.verb,
                                  noun: removal.noun,
                                  path: `/admin/${removal.path}/${report.targetId}/remove`,
                                  reportId: report.id,
                                  danger: true,
                                  preview: () => `We removed your ${removal.kind}.`,
                                })
                              }
                            >
                              {removal.verb}
                            </Button>
                          )}
                          {report.target?.owner && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setTarget({
                                  verb: "Warn",
                                  noun: `@${report.target!.owner!.username}`,
                                  path: `/admin/users/${report.target!.owner!.id}/warn`,
                                  reportId: report.id,
                                  preview: () => "Warning from Craftbid.",
                                })
                              }
                            >
                              Warn @{report.target.owner.username}
                            </Button>
                          )}
                          <Button type="button" size="sm" variant="ghost" loading={dismiss.isPending && dismiss.variables === report.id} onClick={() => dismiss.mutate(report.id)}>
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <ModerationDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
```

- [ ] **Step 9: `pages/admin/AdminUserDetail.tsx`**

```tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MODERATION_RULE_COPY, type AdminUserDetailDto } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { Page } from "../../components/layout/Shell.js";
import { Button } from "../../components/ui/Button.js";
import { Card, RoleBadge, ThreadRule } from "../../components/ui/Primitives.js";
import { ErrorState, FormError, PageHeading, RowSkeleton } from "../../components/ui/States.js";
import { ModerationDialog, type ModerationTarget } from "../../components/admin/ModerationDialog.js";
import { ACTION_LABEL, REPORT_REASON_LABEL, STATUS_LABEL, TARGET_LABEL, when } from "../../components/admin/adminCopy.js";
import { EmailBadge } from "./AdminUsers.js";

const CONTENT_PATH = { artist_post: "posts", posting: "postings", comment: "comments" } as const;

export function AdminUserDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ModerationTarget | null>(null);

  const { data: user, error, refetch } = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: () => api.get<AdminUserDetailDto>(`/admin/users/${id}`),
  });
  const unsuspend = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/unsuspend`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });

  if (error) return <Page><ErrorState error={error} onRetry={() => void refetch()} /></Page>;
  if (!user) return <Page><RowSkeleton count={4} /></Page>;

  const actionable = user.status !== "deleted" && !user.isStaff;
  const at = (verb: string, path: string, preview: string, danger = false): ModerationTarget => ({
    verb,
    noun: `@${user.username}`,
    path: `/admin/users/${user.id}/${path}`,
    preview: () => preview,
    danger,
  });

  return (
    <Page>
      <p className="mb-4 text-sm"><Link to="/admin?tab=users" className="text-indigo hover:underline">Back to accounts</Link></p>
      <PageHeading eyebrow="Account" title={user.displayName} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <dl className="grid gap-3 pl-3 text-sm sm:grid-cols-2">
              <div><dt className="eyebrow">Username</dt><dd>@{user.username}</dd></div>
              <div><dt className="eyebrow">Role</dt><dd><RoleBadge role={user.role} /></dd></div>
              <div className="sm:col-span-2">
                <dt className="eyebrow">Email</dt>
                <dd className="flex flex-wrap items-center gap-2"><span className="break-all">{user.email}</span><EmailBadge confirmedAt={user.emailConfirmedAt} /></dd>
                {user.emailConfirmedAt && <dd className="text-xs text-ink-faint">Confirmed {when(user.emailConfirmedAt)}</dd>}
              </div>
              <div><dt className="eyebrow">Status</dt><dd>{STATUS_LABEL[user.status]}{user.isStaff ? " · staff" : ""}</dd></div>
              <div><dt className="eyebrow">Joined</dt><dd>{when(user.createdAt)}</dd></div>
            </dl>
          </Card>

          <section aria-labelledby="content-title">
            <h2 id="content-title" className="font-display text-xl">Recent posts, requests and comments</h2>
            <ThreadRule className="my-3 w-12" />
            {user.recentContent.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing posted.</p>
            ) : (
              <ul className="space-y-2">
                {user.recentContent.map((item) => (
                  <li key={item.id} className="rounded-md border border-fiber bg-paper-raised px-4 py-3 text-sm">
                    <p className="text-xs text-ink-faint">{TARGET_LABEL[item.kind]} · {when(item.createdAt)}{item.removed ? " · removed" : ""}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-ink">{item.text}</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {item.href && <Link to={item.href} className="text-indigo hover:underline">View</Link>}
                      {!item.removed && actionable && (
                        <button
                          type="button"
                          className="text-rust hover:underline"
                          onClick={() =>
                            setTarget({
                              verb: `Remove ${TARGET_LABEL[item.kind].toLowerCase()}`,
                              noun: `this ${TARGET_LABEL[item.kind].toLowerCase()}`,
                              path: `/admin/${CONTENT_PATH[item.kind]}/${item.id}/remove`,
                              preview: () => `We removed your ${TARGET_LABEL[item.kind].toLowerCase()}.`,
                              danger: true,
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="history-title">
            <h2 id="history-title" className="font-display text-xl">Moderation history</h2>
            <ThreadRule className="my-3 w-12" />
            {user.history.length === 0 ? (
              <p className="text-sm text-ink-faint">No actions taken.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {user.history.map((entry) => (
                  <li key={entry.id} className="rounded-md bg-paper-sunk px-3 py-2">
                    <span className="font-medium">{ACTION_LABEL[entry.action]}</span>
                    {entry.rule && ` · ${MODERATION_RULE_COPY[entry.rule].label}`} · by @{entry.staff.username} · {when(entry.createdAt)}
                    {entry.note && <span className="block text-ink-soft">{entry.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="reports-title">
            <h2 id="reports-title" className="font-display text-xl">Reports about this account</h2>
            <ThreadRule className="my-3 w-12" />
            {user.reportsAgainst.length === 0 ? (
              <p className="text-sm text-ink-faint">None.</p>
            ) : (
              <ul className="space-y-1 text-sm text-ink-soft">
                {user.reportsAgainst.map((report) => (
                  <li key={report.id}>{REPORT_REASON_LABEL[report.reason] ?? report.reason} · {report.status} · {when(report.createdAt)}</li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside>
          <Card className="p-5">
            <div className="space-y-2 pl-3">
              <h2 className="font-display text-lg">Actions</h2>
              {!actionable ? (
                <p className="text-sm text-ink-faint">{user.isStaff ? "Staff accounts cannot be moderated here." : "This account was removed."}</p>
              ) : (
                <>
                  <Button type="button" variant="secondary" className="w-full" onClick={() => setTarget(at("Warn", "warn", "Warning from Craftbid."))}>
                    Send a warning
                  </Button>
                  {user.status === "suspended" ? (
                    <Button type="button" variant="secondary" className="w-full" loading={unsuspend.isPending} onClick={() => unsuspend.mutate()}>
                      Unsuspend
                    </Button>
                  ) : (
                    <Button type="button" variant="danger" className="w-full" onClick={() => setTarget(at("Suspend account", "suspend", "This account is suspended for breaking Craftbid's rules.", true))}>
                      Suspend
                    </Button>
                  )}
                  <Button type="button" variant="danger" className="w-full" onClick={() => setTarget(at("Remove account", "remove", "Their profile, posts, requests and comments disappear. Commissions stay for the other person.", true))}>
                    Remove account
                  </Button>
                  <FormError error={unsuspend.error} />
                </>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <ModerationDialog target={target} onClose={() => setTarget(null)} />
    </Page>
  );
}
```

`ModerationDialog`'s title is the first word of `verb` plus `noun`, so these read "Warn @maya", "Suspend @maya" and "Remove @maya".

- [ ] **Step 10: `pages/admin/AdminBugs.tsx` and `AdminActivity.tsx`**

```tsx
// AdminBugs.tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminBugReportDto, Paginated } from "@craftbid/shared";
import { api, loadPrivateUrl } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Primitives.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { when } from "../../components/admin/adminCopy.js";

function Screenshot({ bugId }: { bugId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let created: string | null = null;
    loadPrivateUrl(`/admin/bugs/${bugId}/screenshot`)
      .then((value) => {
        created = value;
        if (active) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [bugId]);
  return url ? <img src={url} alt="Screenshot sent with the report" className="max-h-80 rounded-md border border-fiber" /> : null;
}

export function AdminBugs() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "bugs", status],
    queryFn: () => api.get<Paginated<AdminBugReportDto>>(`/admin/bugs?status=${status}&limit=25`),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/admin/bugs/${id}/resolve`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(["open", "resolved"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={status === value ? "primary" : "secondary"} onClick={() => setStatus(value)}>
            {value === "open" ? "Open" : "Resolved"}
          </Button>
        ))}
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <RowSkeleton count={3} />
      ) : data.items.length === 0 ? (
        <EmptyState title={status === "open" ? "No open bug reports" : "Nothing resolved yet"} description="Problems people report from the account menu land here." />
      ) : (
        <ul className="space-y-4">
          {data.items.map((bug) => (
            <li key={bug.id}>
              <Card className="p-5">
                <div className="space-y-2 pl-3 text-sm">
                  <p className="text-xs text-ink-faint">@{bug.reporter.username} &lt;{bug.reporter.email}&gt; · {when(bug.createdAt)}</p>
                  <p className="whitespace-pre-wrap break-words text-ink">{bug.description}</p>
                  {bug.pageUrl && <p className="break-all text-ink-soft">Page: {bug.pageUrl}</p>}
                  {bug.userAgent && <p className="break-all text-xs text-ink-faint">{bug.userAgent}</p>}
                  {bug.hasScreenshot && <Screenshot bugId={bug.id} />}
                  {bug.status === "open" && (
                    <Button type="button" size="sm" variant="secondary" loading={resolve.isPending && resolve.variables === bug.id} onClick={() => resolve.mutate(bug.id)}>
                      Mark resolved
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```tsx
// AdminActivity.tsx
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MODERATION_RULE_COPY, type ModerationActionDto, type Paginated } from "@craftbid/shared";
import { api } from "../../lib/api.js";
import { EmptyState, ErrorState, RowSkeleton } from "../../components/ui/States.js";
import { ACTION_LABEL, when } from "../../components/admin/adminCopy.js";

export function AdminActivity() {
  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "actions"],
    queryFn: () => api.get<Paginated<ModerationActionDto>>("/admin/actions?limit=50"),
  });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <RowSkeleton count={4} />;
  if (data.items.length === 0) return <EmptyState title="No actions yet" description="Every warning, removal and suspension is recorded here." />;
  return (
    <ul className="divide-y divide-fiber rounded-md border border-fiber bg-paper-raised text-sm">
      {data.items.map((entry) => (
        <li key={entry.id} className="px-4 py-3">
          <span className="font-medium">{ACTION_LABEL[entry.action]}</span>
          {entry.subjectUser && (
            <>
              {" "}
              <Link to={`/admin/users/${entry.subjectUser.id}`} className="text-indigo hover:underline">@{entry.subjectUser.username}</Link>
            </>
          )}
          {entry.rule && ` · ${MODERATION_RULE_COPY[entry.rule].label}`}
          <span className="block text-xs text-ink-faint">by @{entry.staff.username} · {when(entry.createdAt)}</span>
          {entry.note && <span className="block text-ink-soft">{entry.note}</span>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 11: Routes and menu.** `App.tsx`: lazy-load `AdminPage` and `AdminUserDetail` like the other pages; add

```tsx
function RequireStaff({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Page><RowSkeleton count={3} /></Page>;
  // Anyone else sees the ordinary not-found page, not a "staff only" notice.
  if (!user?.isStaff) return <NotFound />;
  return <>{children}</>;
}
```

Extract the existing `path="*"` element into `function NotFound()` so both use it, and register `<Route path="admin" element={<RequireStaff><AdminPage /></RequireStaff>} />` and `<Route path="admin/users/:id" element={<RequireStaff><AdminUserDetail /></RequireStaff>} />`.

`AccountMenu.tsx` `accountLinks`: append `...(user.isStaff ? [{ to: "/admin", label: "Admin" }] : [])`. The phone menu uses the same list.

- [ ] **Step 12: Build, run the spec file (PASS), `pnpm test:resilience` (all pass, including the header width tests at 1024px, which the new menu item does not affect because it lives inside the menu), web typecheck.**

Checkpoint: no commit.

---

### Task 10: End-to-end and full verification

**Files:**
- Create: `apps/web/e2e/moderation.spec.ts`, `apps/web/e2e/images.ts`
- Modify: `apps/web/e2e/payments.spec.ts` (import `receiptPng` from `./images.js`)

- [ ] **Step 1: Share the PNG generator.** Move `receiptPng` out of `e2e/payments.spec.ts` into a new `e2e/images.ts` as `export function receiptPng(red: number): Buffer` (unchanged body, with its `randomBytes`, `deflateSync` and `crc32` imports), and import it back into `payments.spec.ts`.

- [ ] **Step 2: Write the e2e test** (`e2e/moderation.spec.ts`)

```ts
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { confirmEmail } from "./email.js";
import { receiptPng } from "./images.js";

/**
 * The moderation loop through the real stack: someone reports a post, staff
 * remove it from the admin screen, it leaves the feed, and the artist is told
 * which rule it broke. Staff access is granted with the real CLI, so this also
 * proves nothing on the website can grant it.
 */

const PASSWORD = "a sufficiently long password";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** Each person in their own browser, sized for the project (desktop or phone). */
async function newPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...testInfo.project.use });
  return context.newPage();
}

async function register(page: Page, role: "client" | "artist"): Promise<{ username: string; email: string }> {
  const username = unique(role);
  const email = `${username}@example.com`;
  await page.goto("/register");
  await page
    .getByRole("radio", { name: new RegExp(role === "client" ? "I want something made" : "I make things") })
    .check({ force: true });
  await page.getByLabel("Display name").fill(`Test ${role}`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await confirmEmail(page, email);
  return { username, email };
}

test("a reported post is removed from the admin screen and the artist is told why", async ({ browser }, testInfo) => {
  test.slow();
  const artist = await newPage(browser, testInfo);
  const client = await newPage(browser, testInfo);
  const staff = await newPage(browser, testInfo);

  // --- An artist posts a piece ------------------------------------------------
  const artistAccount = await register(artist, "artist");
  const caption = `E2E reported piece ${Date.now()}`;
  await artist.goto("/posts/new");
  await artist
    .locator('input[type="file"]')
    .setInputFiles({ name: "piece.png", mimeType: "image/png", buffer: receiptPng(90) });
  await expect(artist.getByRole("button", { name: "Remove this image" })).toBeVisible({ timeout: 20_000 });
  await artist.getByLabel("Caption").fill(caption);
  await artist.getByRole("button", { name: "Add to portfolio" }).click();
  await expect(artist).toHaveURL(new RegExp(`/artists/${artistAccount.username}`), { timeout: 20_000 });

  // --- A client reports it --------------------------------------------------------
  await register(client, "client");
  await client.goto("/");
  const card = client.getByRole("article").filter({ hasText: caption });
  await card.getByRole("button", { name: "More options for this post" }).click();
  await card.getByRole("button", { name: "Report", exact: true }).click();
  const reportDialog = client.getByRole("dialog", { name: "Report this post" });
  await reportDialog.getByRole("radio", { name: "It's stolen work" }).check();
  await reportDialog.getByRole("button", { name: "Send report" }).click();
  await expect(reportDialog.getByText("Thanks. Craftbid will review it.")).toBeVisible();

  // --- Staff remove it --------------------------------------------------------------
  const staffAccount = await register(staff, "client");
  execSync(`pnpm --filter @craftbid/api staff grant ${staffAccount.email}`, { cwd: repoRoot, stdio: "pipe" });
  await staff.goto("/admin?tab=reports");
  const report = staff.getByRole("article", { name: new RegExp(caption) });
  await report.getByRole("button", { name: "Remove post" }).click();
  const removeDialog = staff.getByRole("dialog", { name: "Remove this post" });
  await removeDialog.getByLabel("Rule").selectOption("stolen_work");
  await removeDialog.getByRole("button", { name: "Remove post" }).click();
  await expect(report).toHaveCount(0, { timeout: 20_000 });

  // --- It is gone, and the artist knows why ----------------------------------------
  await client.goto("/");
  await expect(client.getByText(caption)).toHaveCount(0);
  await artist.goto("/notifications");
  await expect(artist.getByText(/We removed your post/)).toBeVisible({ timeout: 20_000 });
  await expect(artist.getByText(/Stolen work/).first()).toBeVisible();

  // Signed-in pages left open keep polling the API into the next test.
  await Promise.all([artist, client, staff].map((page) => page.context().close()));
});
```

- [ ] **Step 3: Run everything**

```bash
pnpm typecheck
pnpm --filter @craftbid/api test
pnpm --filter @craftbid/web test:resilience
pnpm test:e2e
pnpm --filter @craftbid/web test:worker
```

Expected: all green. Re-seed afterwards if the local demo data is wanted: `pnpm db:reset && pnpm --filter @craftbid/api seed`.

- [ ] **Step 4: Update the handoff facts in memory** (production migration pending: 014; staff CLI exists; admin at `/admin`).

Checkpoint: no commit. Report to the developer and wait for "commit and deploy".

---

### Task 11: Deploy (only when the developer says so)

- [ ] Run migration 014 on production and confirm: `ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate` then `migrate:status` shows 14.
- [ ] Commit (no AI attribution) and push to `master`.
- [ ] Watch: new `assets/index-*.js` in the live HTML; `GET https://craftbid-api.onrender.com/admin/overview` returns 404 (not a Fastify "route not found" shape, but either way 404) and `GET /me/role-switch` without a session returns 401; `gh run list --limit 1` green.
- [ ] Grant staff to the developer's account: `ENV_FILE=.env.adb pnpm --filter @craftbid/api staff grant <developer email>`, then `staff list`. (The developer runs this if the permission system blocks production writes from the session.)
- [ ] Verify on production with WebKit iPhone 13: signed out, `/admin` shows the not-found page; the developer signs in and sees Admin in the menu, the Users tab shows email confirmation badges.
