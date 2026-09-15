# Batch 4: Staff Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily 4 PM summary email to the owner, commission problems and every payment record (with receipts) in the admin screen, an in-app notice for chat left unread an hour, and cleanup of chat images never sent.

**Architecture:** Migration 020 adds `job_runs` (a run is claimed by inserting its key), nudge columns on `conversations`, and widens the moderation-action, target and notification-type lists. An in-process runner in the API ticks every 5 minutes (the Cloudflare keep-alive keeps Render awake) and runs three idempotent jobs. Admin gets Problems and Payments tabs backed by staff-only routes; resolving a problem and opening a receipt both write `moderation_actions` rows in the same transaction as the change or read.

**Tech Stack:** Fastify, node-oracledb, Brevo mailer port (outbox in tests), React Query, Playwright, Vitest on Oracle.

**Spec:** `docs/superpowers/specs/2026-09-15-fixes-feed-chat-images-staff-tools-design.md` (Batch 4)

## Global Constraints

- Summary: once per Manila day at or after 16:00 Asia/Manila (08:00 UTC); covers new user reports, bug reports and commission problems since the previous summary run (or the last 24 hours on the first); sends nothing when all three are empty but still records the run; to `OWNER_ALERT_EMAIL` only; unset means log and skip.
- Unread notice: in-app `chat_unread` notification only, when a side has an unread message from the other person older than 60 minutes and has not been nudged since that side last read; once per unread stretch; not for closed conversations.
- Chat files unattached for more than 24 hours are deleted from storage and the table.
- Staff routes answer 404 to non-staff (existing hook). Problem resolution reuses `resolveProblem`; a second resolve is refused.
- Every receipt opened by staff writes one `payment_file_viewed` action.
- Jobs never start when `NODE_ENV=test`; tests call them directly with an injected clock.
- Migration 020 runs on production before the push; `OWNER_ALERT_EMAIL` is added in Render by the developer.
- No em dashes; no AI attribution; commit only when told.

---

### Task 1: Migration 020, job runner and the three jobs

**Files:**
- Create: `apps/api/src/db/migrations/020-staff-tools.sql`
- Create: `apps/api/src/jobs/runner.ts`, `apps/api/src/jobs/owner-summary.ts`, `apps/api/src/jobs/chat-nudges.ts`, `apps/api/src/jobs/chat-file-cleanup.ts`, `apps/api/src/jobs/job-runs.repository.ts`
- Modify: `apps/api/src/config.ts` (`OWNER_ALERT_EMAIL` optional email → `config.mail.ownerAlertEmail`), `apps/api/src/index.ts` (start the runner after listen; stop on shutdown)
- Modify: `packages/shared/src/constants.ts` (`chat_unread` notification type; `resolve_problem`, `payment_file_viewed` actions)
- Modify: `apps/web/src/pages/NotificationsPage.tsx` (copy and link for `chat_unread`), `apps/web/src/components/admin/adminCopy.ts` (labels)
- Modify: `apps/api/src/test/helpers.ts` (`resetData` deletes `job_runs`)
- Test: `apps/api/src/test/jobs.test.ts`

**Interfaces:**
- Produces:
  - `claimRun(name: string, runKey: string, q?): Promise<boolean>` and `lastRunAt(name: string): Promise<Date | null>`
  - `runOwnerSummary(now: Date): Promise<"not_yet" | "already_ran" | "nothing_new" | "sent" | "no_recipient">`
  - `runChatNudges(now: Date): Promise<number>` (notices created)
  - `runChatFileCleanup(now: Date): Promise<number>` (files removed)
  - `startJobs(log): () => void` (returns a stop function)

- [ ] **Step 1: Migration**

```sql
CREATE TABLE job_runs (
  name    VARCHAR2(40 CHAR)        NOT NULL,
  run_key VARCHAR2(40 CHAR)        NOT NULL,
  ran_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_job_runs PRIMARY KEY (name, run_key)
);

ALTER TABLE conversations ADD (client_nudged_at TIMESTAMP WITH TIME ZONE, artist_nudged_at TIMESTAMP WITH TIME ZONE);

ALTER TABLE moderation_actions DROP CONSTRAINT ck_moderation_actions_action;
ALTER TABLE moderation_actions ADD CONSTRAINT ck_moderation_actions_action CHECK (action IN
  ('warn', 'suspend', 'unsuspend', 'remove_account', 'remove_post',
   'remove_posting', 'remove_comment', 'resolve_report', 'dismiss_report',
   'resolve_bug', 'resolve_problem', 'payment_file_viewed'));
ALTER TABLE moderation_actions DROP CONSTRAINT ck_moderation_actions_target;
ALTER TABLE moderation_actions ADD CONSTRAINT ck_moderation_actions_target CHECK (target_type IN
  ('user', 'artist_post', 'posting', 'comment', 'report', 'bug_report', 'problem', 'payment'));

ALTER TABLE notifications DROP CONSTRAINT ck_notifications_type;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_type CHECK (type IN ( ...017 list..., 'chat_unread'));
```

- [ ] **Step 2: Failing tests** (`jobs.test.ts`)
  - Summary at 15:59 Manila → `not_yet`; at 16:00 with one bug report → `sent`, one outbox message to `OWNER_ALERT_EMAIL` whose text names the bug report and a link to `/admin?tab=bugs`; again at 16:30 the same day → `already_ran`, still one message.
  - Next day 16:05 with nothing new since → `nothing_new`, no message, run recorded; the day after, a new report and a new problem → `sent` covering only those.
  - Recipient unset → `no_recipient`, no message.
  - Nudge: artist writes; at +59 min nothing; at +61 min one `chat_unread` for the client with `conversationId` and the artist's name; a second tick creates none; client reads, artist writes again, +61 min → a second notice. The sender is never nudged about their own message. A rejected bid's conversation is not nudged.
  - Cleanup: an unattached chat file 25 hours old is removed from storage and the table; one 23 hours old and an attached one 25 hours old stay.
  - Mutations: remove the run claim (summary sends twice); remove the `nudged_at` condition (second tick nudges again).

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: `job-runs.repository.ts`**: `claimRun` inserts and returns false on a unique violation; `lastRunAt(name)` selects `MAX(ran_at)`.

- [ ] **Step 5: `owner-summary.ts`**: compute the Manila date and hour from `now`; before 16 return `not_yet`; `claimRun("owner-summary", date)` false → `already_ran`; `since = lastRunAt before this claim ?? now - 24h` (read before claiming); query counts and the first 10 of each kind created after `since`; all zero → `nothing_new`; no recipient → `no_recipient` (logged); else send plain text + simple HTML with sections and links `${publicWebUrl}/admin?tab=reports|bugs|problems`. A failed send deletes the claim so the next tick retries.

- [ ] **Step 6: `chat-nudges.ts`**: for each side, one `UPDATE conversations SET <side>_nudged_at = :now WHERE ...` guarded conditions, preceded by a `SELECT` of the matching conversation ids with `FOR UPDATE SKIP LOCKED` inside a transaction, inserting a notification per id with payload `{ conversationId, postingTitle, fromName }`. Conditions: an unread message from the other party older than 60 minutes, `<side>_nudged_at IS NULL OR <side>_nudged_at < NVL(<side>_last_read_at, epoch)`, and the conversation still open (bid pending on an open request, or accepted with a non-cancelled commission). Column names chosen from a fixed map.

- [ ] **Step 7: `chat-file-cleanup.ts`**: select unattached files older than 24 hours (max 50 per tick), delete rows in a transaction, then `removePrivate` each key (log failures).

- [ ] **Step 8: `runner.ts`**: `setInterval` every 5 minutes plus one run 30 seconds after start; each job wrapped so one failure never stops the others; skips a tick while the previous is still running. `index.ts` starts it after `listen` when `NODE_ENV !== "test"` and stops it on SIGTERM.

- [ ] **Step 9: Web copy**: `chat_unread` → "You have an unread message." with payload name/title when present ("Nena Hooks sent you a message about Crochet wedding bouquet."); link `/messages/${conversationId}`.

- [ ] **Step 10: Run → PASS**; mutations above.

### Task 2: Problems and payments in the admin API

**Files:**
- Modify: `apps/api/src/modules/admin/admin.repository.ts`, `admin.service.ts`, `admin.routes.ts`
- Modify: `apps/api/src/modules/moderation/moderation.service.ts` (`resolveProblem(staffId, problemId, outcome, note)` wrapping the payments service with the audit row in the same transaction), `apps/api/src/modules/moderation/moderation.repository.ts` (`ActionTarget` gains `problem`, `payment`)
- Modify: `apps/api/src/modules/commission-payments/commission-payments.service.ts` (`resolveProblem` accepts an optional transaction hook `onResolved(tx)`)
- Modify: `packages/shared/src/types.ts` (`AdminProblemDto`, `AdminPaymentDto`, `AdminOverviewDto.openProblems`), `packages/shared/src/schemas/moderation.ts` (`resolveProblemSchema`, `adminPaymentsQuerySchema`)
- Test: `apps/api/src/test/admin-problems-payments.test.ts`

**Interfaces:**
- Produces:
  - `GET /admin/problems?status=open|closed` → `Paginated<AdminProblemDto>`
  - `POST /admin/problems/:id/resolve` `{ outcome: "continue" | "cancel", note: string (5..1000) }` → 204
  - `GET /admin/payments?status=&q=` → `Paginated<AdminPaymentDto>`
  - `GET /admin/payments/:id/receipt` → image, `private, no-store`, audited
  - `AdminProblemDto = { id; commissionId; postingTitle; reason; details; status; resolution; createdAt; closedAt; openedBy: {id, username}; client: {id, username, email}; artist: {id, username, email}; payments: AdminPaymentDto[] }`
  - `AdminPaymentDto = { id; commissionId; postingTitle; kind; method; status; replaced: boolean; amountCentavos; referenceNumber; paidOn; hasReceipt; client: {id, username}; artist: {id, username}; recordedBy: {id, username}; paidTo: { name; number; bank } | null; submittedAt; decidedAt }`

- [ ] **Step 1: Failing tests**
  - Non-staff get 404 on all four routes.
  - Problems list shows an open problem with both parties, reason, details and its commission's payments; resolve `cancel` cancels the commission, notifies both, writes one `resolve_problem` action; resolving again → 400; `closed` filter lists it with the resolution note.
  - Payments list includes a confirmed down payment, a rejected one marked `replaced: true` when a later one of the same kind exists, and a submitted balance; filter `status=rejected`; search by client username and by reference number.
  - Receipt stream returns WebP with `private, no-store` and writes exactly one `payment_file_viewed` action per request (subject: the client); a cash balance with no receipt → 404.
  - Overview includes `openProblems`.
  - Mutation: remove the audit insert; the receipt test fails.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** repository queries (joins commissions, postings, users; `replaced` via `EXISTS` a later payment of the same commission and kind), service mapping, routes. Search `q` matches `LOWER(username)` of either party or `reference_number` exactly (bound).
- [ ] **Step 4: Run → PASS.**

### Task 3: Admin screen tabs

**Files:**
- Create: `apps/web/src/pages/admin/AdminProblems.tsx`, `apps/web/src/pages/admin/AdminPayments.tsx`, `apps/web/src/components/admin/PaymentRecordRow.tsx`
- Modify: `apps/web/src/pages/admin/AdminPage.tsx` (tabs), `AdminOverview.tsx` (tile), `apps/web/src/components/admin/adminCopy.ts` (labels for reasons, methods, statuses, new actions)
- Test: `apps/web/e2e-resilience/admin-and-reporting.spec.ts`

- [ ] **Step 1: Failing resilience tests**
  - Problems tab lists an open problem with both parties and the payment rows; "Resolve" opens a dialog with Continue/Cancel the commission and a required note; submitting posts `{ outcome, note }` and the item leaves the open list.
  - Payments tab lists rows with client and artist, "Recorded by", kind, method, amount, reference, state (including "Replaced"); "View receipt" loads `/admin/payments/:id/receipt` and shows the image; the status filter and search send `status` and `q`.
  - Both tabs fit at 320px without horizontal page overflow (tables scroll inside their own container).
  - Overview shows "Open commission problems".
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** following `AdminBugs.tsx` patterns (Card list, filter buttons, `loadPrivateUrl` image, `Dialog` for resolve).
- [ ] **Step 4: Run → PASS.**

### Task 4: Verification and docs

- [ ] `pnpm typecheck`, API, resilience, worker, e2e; screenshots of both tabs at 390px and 1280px.
- [ ] Update `problems-cli.ts` header comment (the admin tab is now the main route) and the resolve doc comment in the payments service.
- [ ] Re-seed. Report; production needs migration 020 first and `OWNER_ALERT_EMAIL` in Render.
