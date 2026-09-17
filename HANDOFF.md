# Craftbid: full project handoff

Written 2026-09-14, updated 2026-09-15 twice (Philippine time; the second
update covers the four batches in 13.30 to 13.36 and decision 13). Everything needed to
pick this project up cold: what it is, where every piece lives, how it is
deployed, what broke and how it was fixed, what the client decided, and what is
still open.

> **Start here if you are picking this up on or after 2026-09-18.** Sections 19
> and 20 (balance options, second audit fixes) and section 21 (the PLDT
> workaround, the comment cleanup and the signed-out console error) are all
> committed and deployed. **Share `https://craftbid-6w5p.onrender.com`**, not the
> workers.dev address: PLDT and Smart users cannot reach the latter (21.1).
> Section 20 corrects section 18.1, whose diagnosis was wrong. What is still
> open is in 21.5.

State at the time of writing: **everything below is committed, pushed and live.**
Production database at migration 022. ImageKit "Restrict unnamed image
transformations" is on (receipts still load). `PROXY_SHARED_SECRET` is set in
Render, but **the Cloudflare side is not taking effect** (21.5). Email
verification switched on in production through Brevo.
**`OWNER_ALERT_EMAIL` must be set in Render** for the daily summary (section 9).

---

## Contents

1. Snapshot
2. People, roles and working rules
3. Locations: paths, services, accounts, secrets
4. Architecture and repository map
5. Database and migrations
6. API reference
7. Web app: routes, pages and key components
8. How the important mechanisms work
9. Environment variables
10. Commands
11. Deploying safely
12. Testing
13. Bug and fix log
14. Client decisions and conversation history
15. Weaknesses, gaps and risks
16. Open items and future plans
17. Code worth knowing
18. Audit of 2026-09-17: findings and the fix plan
19. Balance options change (shipped 2026-09-18)
20. Second audit of 2026-09-17 and its fixes (shipped 2026-09-18)
21. Reaching PLDT users, comment cleanup, console error (shipped 2026-09-18)

---

## 1. Snapshot

**What it is.** A Philippine marketplace where people commission handmade work
(crochet, weaving, pottery, embroidery and more) from Filipino craft artists.

- A **client** posts a craft request with a starting budget in pesos and
  reference photos.
- **Artists** bid privately, with a message and portfolio samples. A bid may be
  below the starting budget, but then the artist must say why.
- The client and each bidding artist can **chat** privately about the request.
- The client picks one, which opens a **commission**. The chat carries on into
  it. The client pays the artist directly (50% down, 50% balance after delivery
  or at a meet-up) and Craftbid records each payment.
- When it is finished, both sides review each other.
- Artists keep a public **portfolio**. The home page is a personal feed of
  portfolio work, shares of it, and open craft requests, ordered by each
  person's craft interests with anything new on top (8, Home feed).
- The client and artist can send **images in chat**, attached or pasted.
- A **staff admin screen** handles reports, bug reports, commission problems,
  every payment record with its receipt, warnings, removals and suspensions.
  A daily 4 PM email summarises what came in.

**The rule that shapes everything:** bidding is private. An artist never sees
another artist's bid, price, reason or conversation. That is why every social
feature attaches only to portfolio posts and shares, never to craft requests
(requests in the home feed are cards with no reactions, comments, saves,
shares or bid count), and why chat is limited to one client and one bidding
artist. Tests fail if any of that changes.

| | |
|---|---|
| Live site (share this one) | https://craftbid-6w5p.onrender.com (Render Static Site `craftbid`, see 21.1) |
| Live site (Cloudflare) | https://craftbid.pgeagoni.workers.dev (unreachable for some PLDT/Smart users) |
| API (direct) | https://craftbid-api.onrender.com |
| API (as the sites call it) | `/api` on either site's own origin |
| Health check | https://craftbid-api.onrender.com/health |
| Repository | https://github.com/Yus3n10/craftbid (branch `master`, commits go straight to master) |
| Local path | `D:\Claude Local\raxtan` (folder still has the project's old name) |
| Admin screen | https://craftbid.pgeagoni.workers.dev/admin (staff only, see 8) |

---

## 2. People, roles and working rules

- **Ptheusen Geagoni** (the developer, GitHub `Yus3n10`, site username `yus3n`)
  builds and runs it, and is the only staff account.
- **The client** owns the business. Not technical. Relays bugs from real phones,
  usually Messenger's in-app browser on an iPhone.

Rules that came from the developer during this project, keep them:

- **Steps for the developer go in the chat, not in a separate markdown file.**
  (This handoff was explicitly requested, which is the exception.)
- **No em dashes** in anything written for the developer or the client.
- **No AI attribution** in commits, code or docs (no Co-Authored-By trailers).
- **Hands-off:** proceed on routine work without asking; ask only for decisions
  that are genuinely the developer's or the client's (money, accounts, what a
  feature means, visible layout changes).
- **Commit and deploy only when told** ("commit this and deploy it").
- **Inspect before building.** Large requests start with a read-only inspection
  and a plan the developer approves; big work ships in batches.
- **Verify client-reported bugs on WebKit** (Playwright iPhone 13 profile)
  against production before theorising. Chromium-only testing missed the
  biggest bug of the project (13.11).
- **Measure, do not guess.** Every fix in section 13 was reproduced first.

---

## 3. Locations: paths, services, accounts, secrets

### On the development machine (Windows 11)

| What | Where |
|---|---|
| Repository | `D:\Claude Local\raxtan` (a copy of this handoff also exists under `C:\Users\LENOVO\Claude Local\raxtan`; the D: repo is the real one) |
| Local env (development, local Oracle in Docker) | `D:\Claude Local\raxtan\.env` (gitignored) |
| Production env (points at the cloud database) | `D:\Claude Local\raxtan\.env.adb` (gitignored) |
| Oracle wallet for the cloud database | `D:\Ptheusen Personal\craftbid-wallet\` (never inside the repo) |
| Local Oracle container | Docker, container `craftbid-oracle`, port 1521 (Docker Desktop must be running) |
| Email outbox used by tests | `apps/api/.outbox/` (gitignored) |
| Private file store in local dev | `apps/api/.storage-private/` (gitignored) |
| Public file store in local dev | `apps/api/.storage/` (gitignored) |
| Design spec and plan for the admin work | `docs/superpowers/specs/2026-09-14-admin-and-role-switch-design.md`, `docs/superpowers/plans/2026-09-15-admin-and-role-switch.md` |

### Hosted services

| Service | Used for | Plan | Notes |
|---|---|---|---|
| GitHub `Yus3n10/craftbid` | Code, CI, desktop releases, DB keep-alive schedule | Free | CI runs on every push to master |
| Cloudflare Workers, project `craftbid` | Web app, `/api` proxy, keep-alive cron | Free | Deploys automatically on push (Workers Builds) |
| Render, service `craftbid-api` | Fastify API | Free, Singapore | Sleeps after 15 idle minutes; deploys automatically on push |
| Oracle Autonomous Database (Always Free), 19c, Singapore | Database, service `craftbid_tp` | Free | AL32UTF8; stops after 7 idle days, **deleted after 90** |
| ImageKit | Public images and private files (receipts, finished photos, bug screenshots) | Free, 20GB/month bandwidth | |
| Brevo | Verification emails | Free, 300 emails/day | Sender is a Gmail address, no domain |

### Secrets: names and where they live (values are never in the repo)

- **Render environment** (API): `ORACLE_USER`, `ORACLE_PASSWORD`,
  `ORACLE_CONNECT_STRING`, `ORACLE_TNSNAMES_B64`, `ORACLE_EWALLET_PEM_B64`,
  `ORACLE_WALLET_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`,
  `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`,
  `MAIL_DRIVER=brevo`, `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`,
  `PUBLIC_WEB_URL`, and `OWNER_ALERT_EMAIL` (added for the daily summary;
  check it is set).
- **`.env.adb` on the development machine:** the Oracle credentials and
  `ORACLE_WALLET_DIR` pointing at the wallet folder. ImageKit and Brevo keys
  are **not** in any local file; they exist only in Render.
- **Local `wrangler` login token is expired.** Manual Cloudflare deploys need
  `wrangler login` in a real terminal first. Normal deploys do not need it.

### Accounts

- **Staff:** the developer's account (`yus3n`), granted with the staff CLI
  (section 10). Staff access is a flag, separate from client or artist role.
- Local seed (password `craftbid demo password`): `maria_santos@example.com`,
  `paolo_cruz@example.com` (clients); `ana_weaves@example.com`,
  `malou_hooks@example.com`, `kirby_clay@example.com`,
  `rosa_stitch@example.com` (artists). The seed includes one bid below the
  starting budget with a reason.
- Production demo accounts recorded earlier (password `craftbiddemo2026`):
  `maya_delacruz@craftbid.example` (client), `nena_hooks@craftbid.example`
  (artist). **These show the confirm-your-email banner** and cannot post or
  react until confirmed, and `.example` addresses cannot receive mail. If they
  are still needed, mark them verified in the production database or replace
  them with accounts on real inboxes.

---

## 4. Architecture and repository map

### Why the stack is what it is

- **Zero budget.** Every service is on a free tier.
- **Oracle** was a requirement of the project. Neither Prisma nor
  Drizzle supports Oracle, so the API uses raw parameterised SQL over
  `oracledb` (Thin mode) plus a ~150-line migration runner. No ORM.
- **The API cannot be serverless or edge.** The Oracle driver needs a
  long-lived process with real TCP and TLS sockets, so it runs on Render.
- **GitHub Pages and Vercel Hobby forbid commercial sites**, so the web app is
  on Cloudflare.
- **The web app calls the API at `/api` on its own origin**, proxied by the
  Cloudflare Worker, so session cookies are first-party. This is what makes
  sign-in work on iPhones (13.11).
- **Chat polls rather than using sockets.** Render's free tier sleeps and drops
  connections, and a 5-second poll of only newer messages is cheap.
- **Scheduled work runs inside the API process** (`apps/api/src/jobs`). The
  Cloudflare keep-alive pings every 10 minutes, so Render never sleeps through
  the 5-minute tick, and no extra service or secret is needed.
- **Fonts are bundled, not loaded from Google.** A render-blocking Google Fonts
  stylesheet blanked the whole page when that host was slow (13.30).

### Layering (do not shortcut it)

`routes → service → repository`. Routes validate input and check the caller.
Services hold the rules and re-check ownership. Repositories are the **only**
place SQL exists. Shared Zod schemas in `packages/shared` are the single source
of truth for validation on both client and server. Table or column names that
are chosen at runtime always come from a constant map, never from a request.

### Repository map

```
raxtan/
  apps/api/                         Fastify API
    src/app.ts                      App setup: CSRF origin check, CORS, cache headers,
                                    rate limits, error handler, log redaction, routes
    src/config.ts                   Env validation; refuses to boot on bad config
    src/index.ts                    Server entry
    src/db/migrations/              001 to 020 .sql files (section 5)
    src/db/migrate.ts, cli.ts       Migration runner and CLI (up, status, reset, seed)
    src/db/purge-accounts.ts        Deletes accounts by username prefix (dry run first)
    src/db/seed.ts                  Local demo data (never run on production)
    src/lib/storage/                ObjectStorage port: local.ts, imagekit.ts (public + private files)
    src/lib/mail/index.ts           Mailer port: none, log, outbox, brevo
    src/lib/tokens.ts               JWT, refresh tokens, cookie options
    src/lib/password.ts             scrypt hashing
    src/plugins/auth.plugin.ts      Reads session; write-time status and role check;
                                    requireAuth, requireRole, requireVerified, requireStaff
    src/jobs/                       In-process scheduler: runner, owner-summary, chat-nudges,
                                    chat-file-cleanup, job-runs.repository (section 8)
    src/modules/
      auth/                         register, login, refresh, logout, me, change-password,
                                    verify-email, resend-verification
      users/                        profiles, artist profiles, contact links,
                                    role-switch.service/repository (artist <-> client)
      images/                       upload (magic-byte sniffing, sharp re-encode)
      postings/                     craft requests
      applications/                 bids: apply (lower bid needs a reason), accept, reject, withdraw
      commissions/                  commissions, completion, cancel, reviews
      commission-payments/          down payment and balance records, receipts,
                                    finished photos, shipping, problems, problems-cli.ts
      posts/                        portfolio posts, feed (with shares), profile shares
      social/                       reactions and comments on posts AND shares, saves,
                                    shares, activity history
      chat/                         conversations, messages, chat images (upload, stream)
      home/                         GET /home: the ranked personal feed
      interests/                    per-person craft interest scores (record, decay)
      moderation/                   warn, suspend, remove content/accounts, audit log writes
      admin/                        admin read queries, admin-payments.repository (problems,
                                    payment records, receipts), admin routes, staff-cli.ts
      bug-reports/                  "Report a problem with the site" with private screenshot
      reports/                      user reports (posts, comments, profiles, requests, bids)
      notifications/                in-app notifications repository
      community.routes.ts           notifications list/read, reports, reviews by user
      search.routes.ts              search
    src/test/                       Integration tests against real Oracle
  apps/web/                         React 19 + Vite + Tailwind 4 client
    index.html                      Fonts, Open Graph/Twitter text metadata
    src/main.tsx                    Data router, providers, update watcher
    src/App.tsx                     Route table (all pages lazy-loaded), RequireAuth, RequireStaff
    src/index.css                   Design tokens (indigo/abaca palette), fonts
    src/lib/api.ts                  fetch wrapper: 20s deadline (with a fallback for browsers
                                    without AbortSignal.timeout), refresh-on-401, ApiError,
                                    uploadImage, postForm, loadPrivateUrl
    src/lib/compressImage.ts        compressForChat: 1600px WebP (JPEG fallback) before upload
    src/lib/auth.tsx                AuthProvider: login, register, verifyEmail, logout
    src/lib/session.ts              Bearer mode (desktop) vs cookies (web), session hint
    src/lib/authPrompt.tsx          "You need an account" / "Confirm your email" popups
    src/lib/unsavedChanges.tsx      Leave-without-saving blocker, sign-out warning state
    src/lib/appUpdates.ts           Reloads into a new deploy without a second refresh
    src/components/layout/          Header (Messages and bell icons), AccountMenu (cog), AccountNotices, Shell
    src/components/ui/              Button, Field (TextInput, PasswordInput, TextArea), Dialog (sm/md/lg),
                                    Icons, Primitives (RoleBadge), States (FieldMessages)
    src/components/commission/      PaymentPanel, PayoutAccountsForm, PrivateImage
    src/components/chat/            MessageButton, messageTime
    src/components/admin/           ModerationDialog, PaymentRecordRow, adminCopy
    src/components/                 Feed, FeedPost, FeedRequestCard, SharedPostCard, ClampedText, ShareMenu,
                                    CommentThread, ReactionBar, ReportButton, BugReportDialog,
                                    BelowBudgetNote, ProfileChecklist, AccountTypeSection,
                                    CropDialog, CroppedImageField, ...
    src/pages/                      One file per route (section 7), pages/admin/ for staff
    worker/index.ts                 Cloudflare Worker entry: /api proxy + cron
    worker/api-proxy.ts             Forwards /api/* to Render (tested against open-proxy tricks)
    worker/keepalive.ts             Pings /health every 10 minutes
    wrangler.jsonc                  Worker config (run_worker_first ["/api/*"], SPA fallback)
    e2e/                            Real-stack browser tests (email.ts reads the outbox, images.ts makes PNGs)
    e2e-resilience/                 Stubbed browser tests on a production build
    playwright.config.ts            e2e config (starts API with MAIL_DRIVER=outbox)
    playwright.resilience.config.ts Resilience config (vite preview, service workers blocked)
  packages/shared/                  Zod schemas, constants, DTO types, money helpers, crop maths,
                                    timeAgo (daysAgo, shortAgo), interest (weights, categoriesForSearch)
  src-tauri/                        Desktop shell (Tauri 2) around the same web build
  docs/HANDOVER.md                  Bug ledger and design reasoning (long form, older)
  docs/DEPLOY.md                    Deployment details
  docs/DESIGN.md                    Original design investigation
  docs/PAYMENTS.md                  In-app payments assessment (not built)
  docs/superpowers/                 Specs and plans: admin/role switch; fixes, home feed,
                                    chat images and staff tools (one plan per batch)
  .github/workflows/ci.yml          Typecheck, migrate, API tests, build, worker tests, resilience tests
  .github/workflows/keepalive.yml   Pings the database twice a week (Mon, Thu 03:00 UTC)
  .github/workflows/release.yml     Desktop builds on tags v*
  render.yaml                       Render blueprint (edits do NOT update an existing service)
  docker-compose.yml                Local Oracle Free 23 (gvenzl/oracle-free:23-slim)
```

---

## 5. Database and migrations

Every business rule that can live in the database does, as constraints, so no
future code path can forget it.

| # | File | What it adds |
|---|---|---|
| 001 | identity-and-profiles | users, artist_profiles, images, refresh_tokens |
| 002 | portfolio | artist_posts, artist_post_images |
| 003 | marketplace | postings, applications (bids), commissions, reviews |
| 004 | safety-and-notifications | reports, notifications |
| 005 | seed-craft-categories | craft categories |
| 006 | social | post_reactions, post_comments, saved_posts |
| 007 | social-notifications | reaction/comment notification types, dedupe index |
| 008 | contact-links | external_links (https and mailto only, CHECK enforced) |
| 009 | remember-me | refresh_tokens.persistent ("Keep me logged in") |
| 010 | payment-records | commission payment columns, payout_accounts, commission_files, commission_payments, commission_problems |
| 011 | post-shares | post_shares, activity indexes, post_shared notification type |
| 012 | email-verification | users.email_verified_at, email_verification_tokens |
| 013 | balance-method-notification | balance_method_chosen notification type |
| 014 | moderation-and-roles | users.is_staff, users.role_changed_at, reports.resolved_*, post_comments.removed_*, postings.removed_at, bug_reports, moderation_actions, account_warning and content_removed types |
| 015 | below-budget-bids | applications.below_budget_reason; the old minimum CHECK replaced by ck_applications_below_budget |
| 016 | chat | conversations (unique per request and artist), messages |
| 017 | share-engagement | share_reactions; post_comments.share_id with exactly-one-target CHECK; share_reaction and share_comment types |
| 018 | category-interest | user_category_interest (score per person per craft, 30-day half-life applied on read and write) |
| 019 | chat-images | chat_files; messages.file_id (unique, cascade); messages.body nullable; ck_messages_content (text or image) |
| 021 | balance-after-delivery | balance_method limited to 'transfer' (now meaning pay after delivery) and 'meetup'; cod rows moved to transfer |
| 020 | staff-tools | job_runs; conversations.client_/artist_nudged_for_read; resolve_problem and payment_file_viewed actions; problem and payment targets; chat_unread type |
| 022 | password-reset | password_reset_tokens (SHA-256 only, single use, 1 hour). Section 20 |

Rules enforced by the database:

| Rule | Mechanism |
|---|---|
| One bid per artist per request | `UNIQUE (posting_id, artist_id)` |
| At most one accepted bid per request | Partial unique index (Oracle skips all-NULL keys) |
| A bid below the starting budget carries a non-empty reason, and only then | `ck_applications_below_budget` against the budget copied onto the bid |
| One review per person per commission | `UNIQUE (commission_id, reviewer_id)` |
| One reaction per person per post, and per share | `PRIMARY KEY (post_id, user_id)`, `PRIMARY KEY (share_id, user_id)` |
| A comment is on a post or a share, never both | `ck_post_comments_target` |
| One share per person per post | `UNIQUE (user_id, post_id)` |
| One conversation per request per artist | `uq_conversations_posting_artist` |
| A message has text, an image, or both | `ck_messages_content` |
| A chat image is attached to one message at most | `uq_messages_file` |
| A scheduled run happens once | `pk_job_runs (name, run_key)` |
| Down payment + balance = price | `ck_commissions_split` |
| One live payment of each kind per commission | Function-based unique index |
| A reference number or receipt file backs one live payment anywhere | Function-based unique indexes |
| One open problem per commission | Function-based unique index |
| Moderation actions and rules are a fixed list | `ck_moderation_actions_action`, `ck_moderation_actions_rule` |
| Notification types are a fixed list | `ck_notifications_type` (widening it is a migration) |

Money is always integer centavos (`NUMBER(12)`), never floats. Text columns use
CHAR length semantics on an AL32UTF8 database, so emoji store intact.

**Column names still say "minimum"** (`min_budget_centavos`,
`min_price_at_apply_centavos`) and so does the API field `minBudgetCentavos`,
even though the product now calls it the starting budget. Renaming them is not
safe: Cloudflare and Render deploy at different moments, and a renamed field
would break bid lists for a few minutes on every deploy.

**Migrations are not run by deploying.** Run them on production before pushing
the code that needs them (section 11). Production is at 020.

---

## 6. API reference

All paths as the API sees them. The web app calls them under `/api`.
"Verified" means the account must have confirmed its email (only while email
verification is switched on). Every write by a signed-in account is refused
with 403 `account_inactive` if the account is suspended or removed, and with a
401 if the token's role no longer matches the account (after a role switch).

**Auth** (`/auth`)
- `POST /auth/register`: 202 `{status:"verification_sent"}` when verification is on (no session); 201 with session when off. Limit 5 per 10 min.
- `POST /auth/verify-email` `{token}`: confirms, signs in. 400 invalid, 409 used/already verified, 410 expired. Limit 20 per 10 min.
- `POST /auth/resend-verification` `{email?}`: always 204, sends in the background. Limit 5 per 15 min, plus 1/min and 5/hour per account.
- `POST /auth/login` (10 per 10 min; 403 `account_suspended` after a correct password on a suspended account), `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` (includes `isStaff`), `GET /auth/session` (200 `{user}` or `{user: null}` when no session cookie was sent; 401 only when a credential was sent that no longer works; what the web app asks on every load, see 21.3), `POST /auth/change-password` (5 per 15 min; revokes all sessions).

**Users and profiles**
- `GET /users/:username` (suspended profiles still show; removed ones 404), `PATCH /me/profile` (a new avatar must be square and a new cover 3:1), `PATCH /me/artist-profile` (artist), `PUT /me/links`.
- `GET /me/role-switch` → `{allowed, blockers, nextAllowedAt}`; `POST /me/role` `{role}` (5 per hour) switches and returns a fresh session.
- `GET /users/:username/reviews` (each review carries `reviewerRoleInCommission`), `GET /users/:username/shares`.

**Images**
- `POST /images` (multipart, 40 per 10 min). Sniffs magic bytes, re-encodes with sharp (drops EXIF/GPS).

**Craft requests and bids**
- `GET /postings`, `GET /postings/:id`, `POST /postings` (client, verified), `PATCH /postings/:id`, `POST /postings/:id/cancel`.
- `GET /postings/:id/applications` (owner only), `POST /postings/:id/applications` (artist, verified; `belowBudgetReason` required below the starting budget, dropped otherwise).
- `GET /applications/mine`, `GET /applications/:id`, `POST /applications/:id/accept|reject` (client), `POST /applications/:id/withdraw` (artist). Bids carry `startingBudgetCentavos` and `belowBudgetReason?`.

**Commissions**
- `GET /commissions`, `GET /commissions/:id`, `POST /commissions/:id/complete`, `POST /commissions/:id/cancel`, `POST /commissions/:id/reviews`.

**Payment records** (only the two parties)
- `GET|PUT /me/payout-accounts` (artist).
- `PUT /commissions/:id/balance-method` (notifies the artist when it changes).
- `POST /commissions/:id/files`, `GET /commissions/:id/files/:fileId` (private, `no-store`).
- `POST /commissions/:id/payments`, `POST .../payments/:paymentId/confirm|reject` (receiver only).
- `POST /commissions/:id/balance-received`, `POST /commissions/:id/finished`, `PUT /commissions/:id/shipping`.
- `POST /commissions/:id/problems`, `POST .../problems/:problemId/withdraw`.

**Home feed**
- `GET /home?category=&limit=&offset=` → items `{kind: "post", ...FeedItemDto}` or `{kind: "request", ...}` (a request without `applicationCount` or `commissionId`). Public; ordered for the signed-in viewer. The Saved tab still uses `GET /feed?saved=true`.
- `GET /users/:username/postings`: open and in-progress requests, not removed, for profiles.

**Chat** (the client of the request and an artist who bid on it; everyone else gets 404)
- `POST /conversations` `{postingId, artistId}`: opens or creates. 60 per minute.
- `GET /conversations` (only conversations with messages, with `unread`), `GET /conversations/unread` → `{unread}`.
- `GET /conversations/:id` → other party, request, `stage` (bidding or commission), `commissionId?`, `canSend`.
- `GET /conversations/:id/messages?after=` (latest 200, or only messages at or after `after`), `POST /conversations/:id/messages` `{body?, fileId?}` (at least one; body up to 2000 characters; 30 per minute), `POST /conversations/:id/read`. A message's `body` is `""` when it is only an image, and it carries `image: {fileId, width, height}`.
- `POST /conversations/:id/files` (multipart, 20 per 10 min, only while the conversation is open) → `{fileId, width, height}`; `GET /conversations/:id/files/:fileId` (`private, no-store`).

**Portfolio, feed and social**
- `GET /posts`, `GET /posts/:id`, `POST /posts` (artist, verified), `PATCH /posts/:id`, `DELETE /posts/:id` (soft delete).
- `GET /feed?saved=&category=`: posts and shares interleaved by time. A share item carries `share.reactions` and `share.commentCount` (its own) alongside the post's own counts.
- `PUT|DELETE /posts/:id/reaction` (PUT verified), `GET|POST /posts/:id/comments` (POST verified).
- `PUT|DELETE /shares/:id/reaction`, `GET|POST /shares/:id/comments`: a share's own engagement.
- `DELETE /comments/:id` (author, the post's artist, or the share's owner).
- `PUT|DELETE /posts/:id/save` (PUT verified), `PUT|DELETE /posts/:id/share` (PUT verified; body `{caption?}`).
- `GET /me/activity?kind=reaction|comment|save|share`: the caller's own history only (posts only, not share engagement).

**Reports and bug reports**
- `POST /reports` `{targetType: posting|user|artist_post|application|comment, targetId, reason, details?}`: 20 per hour. Not on your own post or comment; a bid only by the client who received it.
- `POST /bug-reports` (multipart: `description`, `pageUrl?`, `userAgent?`, optional file `screenshot`), 10 per hour. The screenshot is a private file.

**Admin** (staff only; 404 to anyone else, checked against the database on every request)
- `GET /admin/overview`, `GET /admin/reports?status=`, `POST /admin/reports/:id/resolve|dismiss`.
- `GET /admin/users?q=&email=confirmed|unconfirmed&status=&role=`, `GET /admin/users/:id`.
- `POST /admin/users/:id/warn|suspend|remove` `{rule, note?, reportId?}`, `POST /admin/users/:id/unsuspend` `{note?}`.
- `POST /admin/posts/:id/remove`, `POST /admin/postings/:id/remove`, `POST /admin/comments/:id/remove` `{rule, note?, reportId?}`.
- `GET /admin/bugs?status=`, `GET /admin/bugs/:id/screenshot`, `POST /admin/bugs/:id/resolve`, `GET /admin/actions`.
- `GET /admin/problems?status=open|closed` (both people with emails, and the commission's payment records), `POST /admin/problems/:id/resolve` `{outcome: continue|cancel, note}` (audited).
- `GET /admin/payments?status=&q=` (every record; `replaced` marks a rejected one superseded; `q` is a username or reference number), `GET /admin/payments/:id/receipt` (each view writes a `payment_file_viewed` action).

**Other**
- `GET /notifications`, `POST /notifications/read` `{throughId?}` (marks read up to that notification), `GET /search`, `GET /categories`, `GET /health`.

---

## 7. Web app: routes, pages and key components

| Route | Page | Access |
|---|---|---|
| `/` | HomePage ("For you" feed of posts, shared cards and request cards; Saved tab; open requests sidebar) | Public |
| `/login`, `/register` | LoginPage, RegisterPage (show password button) | Public |
| `/verify-email?token=` | VerifyEmailPage | Public |
| `/postings`, `/postings/:id` | Craft requests, request detail with bid form | Public |
| `/postings/new`, `/postings/:id/edit` | PostingFormPage | Client |
| `/postings/:id/applications` | Compare bids, Message, Report, choose an artist | Client (owner) |
| `/discover`, `/search` | Discover work, search | Public |
| `/artists/:username` | Profile: 3:1 cover, role badge, checklist (own), portfolio, Requests (open and in progress), Shared, reviews | Public |
| `/posts/:id`, `/posts/new`, `/posts/:id/edit` | Post detail; post form (artist) | Mixed |
| `/my/postings` / `/my/applications` | My requests / My bids | Client / Artist |
| `/commissions`, `/commissions/:id` | Commissions, Message button, payment panel, review | Signed in |
| `/messages`, `/messages/:id` | Conversation list, one conversation | Signed in |
| `/notifications` | Notifications (marks read on open) | Signed in |
| `/saved` | Saved posts | Signed in |
| `/activity` | Activity history (grouped by day, with undo) | Signed in |
| `/settings` | Profile with crop editor, craft details, Where clients pay you, contact links, Account type | Signed in |
| `/admin`, `/admin/users/:id` | Admin: Overview, Reports, Users, Problems, Payments, Bug reports, Activity log; account detail | Staff (others see not-found) |

Header (desktop, from 1024px): nav links, search (inline from 1280px),
Messages icon with unread count, notifications bell, **cog account menu** (Your
profile, Edit profile and settings, Saved posts, Activity history, Messages,
Notifications, Admin for staff, Report a problem with the site, Sign out), Post
a request (clients), avatar. Phone: search button, Messages, bell and a menu
with the same account links. Below 360px wide the "Craftbid" wordmark hides so
the four icons keep 44px touch targets.

Design: palette is natural indigo (tayum) on abaca-paper neutrals, clay only on
money, amber for gentle warnings (a lower bid), rust for errors. Fonts are
**Bricolage Grotesque** (headings, optical size pinned at 24) and **Figtree**
(text). Fraunces and Karla were dropped because the developer's creer-website
already used Fraunces, and the developer does not want designs repeated across
projects. The fonts are self-hosted through `@fontsource-variable` (imported
in `main.tsx`) and precached by the service worker.

---

## 8. How the important mechanisms work

### Sessions and cookies
- Access token (JWT, 15 minutes) and refresh token (rotated on every use) in
  httpOnly cookies `craftbid_at` and `craftbid_rt`. Refresh tokens stored as
  SHA-256 only.
- **Keep me logged in** is off by default. Unticked: session cookies, and the
  server forgets the session after 12 idle hours. Ticked: 30 days. The choice
  lives on the refresh token and is inherited on rotation.
- After sign-in the client calls `/auth/me` to prove the browser kept the
  cookies; a 401 there becomes a clear message instead of a fake signed-in state.
- Every write re-reads the account: suspended or removed accounts are refused
  at once (not when the token expires), and a token whose role no longer
  matches gets a 401 so the web app refreshes into the new role.
- The desktop build uses bearer tokens instead of cookies.

### CSRF and the /api proxy
- Any cookie-authenticated mutation with a browser `Origin` not in
  `CORS_ORIGINS` is refused (`app.ts`). Requests with an `Authorization`
  header are exempt.
- The Worker forwards `/api/*` to Render, assigning the upstream path (never
  resolving it) so `/api//attacker.example` cannot turn it into an open proxy.
- Rate limits key on `CF-Connecting-IP`, because Render sees every request as
  coming from Cloudflare.

### Caching and freshness
- Signed-in reads, and any read that carries a session cookie even with a lapsed
  token, are `private, no-store`. Anonymous reads of user content are
  `public, no-cache` (the browser must revalidate), categories 1 hour, uploads
  1 year. Before 2026-09-14 anonymous reads were cached for up to 5.5 minutes,
  which made new posts invisible on refresh (13.23).
- The feed and requests sidebar wait for `/auth/me` when a session hint exists,
  so a lapsed token never fetches a stranger's feed.
- Cloudflare cron (every 10 minutes) pings the API's `/health`. GitHub Actions
  pings twice a week as a backstop for the database's 7-day stop.

### Email verification (live)
- Switched on when `MAIL_DRIVER` is not `none`. Production uses `brevo`.
- Register creates the account and emails a link; nobody is signed in yet.
- The link opens `/verify-email`, which **POSTs** the token (mail scanners fetch
  links but do not run pages), then strips it from the address bar.
- Tokens: 32 random bytes, SHA-256 stored, single-use, 24 hours.
- Unverified accounts can sign in, browse and edit their profile. Posting,
  bidding, reacting, commenting, saving and sharing return 403 `email_unverified`.
- Config refuses `log` or `outbox` drivers in production and refuses `brevo`
  without a key and sender.

### Bids below the starting budget
- An artist may bid under the client's starting budget. The form then shows
  "₱X below the client's starting budget of ₱Y" and a required reason box, and
  Send stays disabled until it is filled.
- The service decides "below" against the posting read inside the transaction;
  a reason sent with a bid at or above the budget is dropped. The database
  CHECK holds the same rule.
- The client sees the same line in amber with "Their reason:" on the bid card;
  the artist sees theirs on My bids. The starting budget still cannot change
  once bids exist.

### Chat
- **Model:** one conversation per request per artist, created the first time
  the client or that artist opens it. When the artist is chosen, the same
  conversation continues: the commission is found through the request.
- **Who:** the request's client, and an artist who bid on it. Anyone else,
  including another bidder, gets 404 on every chat route. Chat responses never
  include a bid's price.
- **Closed:** read-only once the bid is declined or withdrawn, the request is no
  longer open (before acceptance), or the commission is cancelled. Completed
  commissions stay open.
- **Updates:** the open conversation polls every 5 seconds while the tab is
  visible, asking `?after=` the newest message it has, and merges by id. The
  list refreshes every 30 seconds; the unread count every 60. There is no
  notification per message.
- **Unread:** each side's last-read time is on the conversation; unread means
  the other person wrote after it. Sending marks your own side read.
- **Suggestions:** `CHAT_SUGGESTIONS` in `packages/shared/src/constants.ts`, by
  role and stage. Tapping one fills the box and never sends.
- **Entry points:** Message buttons on bid cards (client), on the request page
  after bidding (artist) and on the commission page; the Messages icon; the
  account menu.

### Home feed and craft interest
- `user_category_interest` holds a score per person per craft. Saves and shares
  add 3, comments, bids and posting a request 2, reactions and searches that name
  a craft 1 (`categoriesForSearch`: "ceramic mug" is pottery, "birthday gift" is
  nothing), opening a craft's list on its first page 0.5. An artist's own crafts
  count 2 at read time. Scores halve every 30 days; undoing does not subtract.
- Recording is `recordInterest`, called after the action succeeds; it logs and
  swallows its own errors, so it can never fail a reaction or a bid.
- `/home` ranks the newest 500 posts, shares and open requests of active clients:
  `0.5^(hours/36) * (1 + fresh + min(score, 10)/10)`, where `fresh` is 1 under 6
  hours. So anything under 6 hours old is above everything older, interest
  orders within each group, and the viewer's own item from the last 24 hours is
  first. Signed out or with no interests it is newest first.
- The web feed calls `/home` and falls back to `/feed` on a 404, which covers the
  minutes when Cloudflare has deployed and Render has not.

### Chat images
- Attach button or paste into the box; one image per message, optional text.
  The browser scales to 1600px and encodes WebP 0.8 (JPEG where WebP cannot be
  encoded); the server runs `normaliseImage` capped at 1600px and stores it as a
  private file under `conversations/<id>/`.
- A file can be attached only by its uploader, in its own conversation, once.
  Unsent uploads are removed after 24 hours by the job runner.
- `PrivateImage` takes any private API `path` (receipts, finished photos, chat).

### Scheduled jobs (`apps/api/src/jobs`)
- `startJobs` runs from `index.ts` after listen (never when `NODE_ENV=test`):
  first tick 30 seconds after start, then every 5 minutes; a slow tick is not
  stacked, one failing job never stops the others.
- **Owner summary:** at or after 16:00 Manila, claimed once per Manila date in
  `job_runs`. Covers reports, bug reports and commission problems since the
  previous run (24 hours on the first). Nothing new: no email, run still
  recorded. Send failure: the claim is released and the next tick retries.
  Recipient `OWNER_ALERT_EMAIL`; unset logs and skips.
- **Unread chat notice:** a `chat_unread` in-app notification when the other
  person's message has waited 60 minutes and the conversation is open. Each side
  stores the last-read value the notice was for, so it is not repeated until that
  side reads again; this does not depend on any clock.
- **Chat image cleanup:** unattached files over 24 hours, 50 per tick, rows first
  and storage after.
- Tests call each job with an injected `now` (`src/test/jobs.test.ts`).

### Notifications
- Opening the page loads the list, then posts the newest shown notification's
  id to `/notifications/read`, which marks that one and older read. One that
  arrives in between stays unread. The badge clears only after the server
  confirms; this visit's new items stay highlighted until the page is left.
- Deduplicated reactions and shares use `notifyOncePerActor` (one unread notice
  per actor per post).

### Payment records (live, no money moves through Craftbid)
- Commissions started after migration 010 are tracked (`payment_tracking = 1`).
- Flow: artist adds GCash/Maya/bank details in Settings → client sends the 50%
  down payment directly and records reference number, date and receipt → the
  **artist confirms it arrived** → artist marks the piece finished (photos
  optional) → then one of two balance options:
  - **Pay after delivery** (stored as `transfer`): artist ships and adds the
    courier; the client can record the balance only once shipping is recorded,
    with reference number and receipt; the artist confirms.
  - **Meet-up**: the client pays cash at the meet-up and the artist records it.
  → client marks received → reviews.
- Changed 2026-09-16 at the developer's request: "Pay after seeing photos"
  (photos required, balance before shipping) and cash on delivery were removed.
  The stored value `transfer` was kept so the non-atomic deploy never saw an
  unknown value; migration 021 narrowed the CHECK.
- The balance option is a draft until Save changes; saving notifies the artist.
- Receipts and finished photos are ImageKit **private files**, read by the API
  with a 60-second signed URL using `tr:orig-true`, streamed only to the two
  parties with `private, no-store`.
- **Chat does not replace this.** Photos before the balance and receiver
  confirmation control who is owed what and are the evidence in a reported
  problem; chat has no attachments and changes no payment state.

### Shares and their engagement
- One share per person per post; sharing again edits the note. Artists cannot
  share their own post.
- A shared card is the sharer's own card (`SharedPostCard`): its own reactions
  (`share_reactions`) and comments (`post_comments.share_id`). The original sits
  inside as a preview credited to its artist and opens the real post in a dialog
  with the original's own reactions and comments. Nothing is copied.
- The sharer, not the artist, is told about engagement on the share, and may
  remove comments from it. Deleting a share removes its engagement; a share of a
  post that was taken down cannot be engaged with.
- Reactions made on shared cards before 2026-09-15 were stored on the original
  post and stay there.

### Profile pictures and covers
- The rules are `AVATAR_CROP` (1:1, saved at up to 512px, crop at least 256
  source pixels wide) and `COVER_CROP` (3:1, up to 1500px, at least 750) in
  `packages/shared/src/crop.ts`, shared by the editor and the server.
- `CropDialog` frames the photo in a circle or a 3:1 rectangle (drag, pinch,
  scroll, slider), clamps so there are no empty edges, and draws exactly the
  framed rectangle to a canvas. The upload is the cropped image itself, through
  the normal `/images` pipeline, so editor, Settings preview and profile match.
- `PATCH /me/profile` refuses a new avatar that is not square or a new cover
  that is not 3:1. Pictures already in place are left alone.
- The profile cover is a fixed 3:1 inside the page width; only the portrait
  overlaps it. Older covers are centre-cropped by CSS until replaced.

### Emoji and text fields
- `containsEmoji` in `packages/shared/src/schemas/common.ts` matches by Unicode
  property (pictographs, flags, joiners), not by banning non-ASCII.
- Refused in payout account names, bank names, city and contact links (and
  every https URL). Account and phone numbers were already digit-only.
- Allowed in posts, captions, comments, chat, display names and bid reasons.
- Forms with repeated rows show the server's own reasons through
  `FieldMessages`.

### Moderation and the admin screen
- **Staff** is `users.is_staff`, set only by the staff CLI. `requireStaff` reads
  it from the database on every admin request and answers 404 to anyone else.
- Staff can remove posts, requests (open ones only) and comments; warn, suspend,
  unsuspend and remove accounts; resolve or dismiss reports; resolve bug reports.
  Every action names a rule, notifies the person (warning or removal), and writes
  a `moderation_actions` row **in the same transaction**.
- **Suspend** is reversible: the account cannot sign in or write, its content
  stays visible, its open requests take no bids and its bids cannot be accepted.
- **Remove** is permanent: profile 404s, posts removed, open requests cancelled,
  pending bids withdrawn, comments hidden, shares and reactions deleted.
  Commissions stay for the other person, shown as "Removed account".
- Staff cannot act on themselves or on other staff.
- **Problems tab:** open or closed problems with both people and emails, the
  reason and details, and every payment record on the commission. Resolve with
  continue or cancel and a note both people see; the resolution and its
  `resolve_problem` audit row commit together (`moderation.resolveProblem`
  passes a step into the payments service's transaction). The problems CLI
  remains as a fallback.
- **Payments tab:** every payment record whatever its state, rejected ones marked
  Replaced when a later record exists, with client, artist, recorder, payee and
  dates. Receipts load only when "View receipt" is pressed, and every view writes
  a `payment_file_viewed` action whose subject is the client.
- The Users tab shows each account's email with **Email confirmed** (and when)
  or **Not confirmed**, filterable.
- Report buttons: posts ("..." menu), comments, profiles, requests, and bids on
  the bid comparison page. Bug reports from the account menu, phone menu and
  footer, with the page and browser shown before sending.

### Switching between artist and client
- Allowed only with no open request, pending bid, active commission or open
  problem, and not within 30 days of the last switch. Every other session is
  revoked; the device that switched gets a fresh session with the new role.
- Artist profile, portfolio and payout details are kept for switching back.

### Safety prompts
- `authPrompt.tsx`: account-only clicks call `requireAccount("save posts")`,
  which opens "You need an account for that" or "Confirm your email first".
- `unsavedChanges.tsx`: forms report dirtiness with `useUnsavedChanges(dirty)`
  (bid form, chat draft, balance option, request and post forms).
- Sign out always opens "Sign out of Craftbid?".

### Staying up to date after a deploy
- `lib/appUpdates.ts`: when a new service worker takes over, reload at once if
  the page is untouched, otherwise on the next change of page.
- `ErrorBoundary.tsx`: a failed route chunk reloads once per minute per tab.
- `lib/api.ts`: 20-second deadline per attempt, reported as 408 so React Query
  retries it (Render cold starts take 30 to 60 seconds).

---

## 9. Environment variables

### API (`apps/api/src/config.ts`)

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | `production` on Render |
| `PORT`, `HOST` | 4000, 0.0.0.0 | |
| `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECT_STRING` | required | TNS alias such as `craftbid_tp` |
| `ORACLE_WALLET_DIR`, `ORACLE_WALLET_PASSWORD` | optional | Local production access |
| `ORACLE_TNSNAMES_B64`, `ORACLE_EWALLET_PEM_B64` | Render only | Wallet files, written to a temp dir at startup |
| `ORACLE_POOL_MIN`, `ORACLE_POOL_MAX` | 0, 4 | Keep small on the 512MB instance |
| `JWT_SECRET` | required, 32+ chars | Refuses the example placeholder in production |
| `ACCESS_TOKEN_TTL` | 15m | |
| `REFRESH_TOKEN_TTL_DAYS` | 30 | Keep me logged in |
| `SESSION_REFRESH_TTL_HOURS` | 12 | Without Keep me logged in |
| `CORS_ORIGINS` | http://localhost:5173 | Exact origins, comma separated, no trailing slash. Production: `https://craftbid.pgeagoni.workers.dev,https://craftbid-6w5p.onrender.com` |
| `STORAGE_DRIVER` | local | `imagekit` in production (local is refused there) |
| `STORAGE_LOCAL_DIR`, `STORAGE_PUBLIC_BASE_URL` | .storage, http://localhost:4000/media | Local only |
| `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` | | Private key must start with `private_` |
| `MAIL_DRIVER` | none | `none` turns verification off; `log`, `outbox` (dev/tests); `brevo` (production) |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL` | | Required with `brevo` |
| `MAIL_FROM_NAME` | Craftbid | |
| `PUBLIC_WEB_URL` | http://localhost:5173 | Where email links point. Production should be `https://craftbid-6w5p.onrender.com` so PLDT users can open them (21.1) |
| `OWNER_ALERT_EMAIL` | unset | Daily summary recipient; unset skips the summary with a log line |
| `PROXY_SHARED_SECRET` | unset | 32+ chars, same value as the Worker secret of that name. Lets rate limits tell visitors apart behind the Worker (20.1). Unset logs a warning in production and every visitor shares one bucket |

No other variables were added for chat, moderation, cropping, the home feed,
chat images or the jobs.

### Web build
- `apps/web/.env.production`: `VITE_API_URL=https://craftbid-api.onrender.com`
  (committed; production builds actually call `/api` on the site origin).
- `.env.desktop`: API URL plus `VITE_AUTH_MODE=bearer` for the Tauri build.

### Worker (`wrangler.jsonc`)
- `API_ORIGIN=https://craftbid-api.onrender.com`, cron `*/10 * * * *`,
  `run_worker_first: ["/api/*"]`, `not_found_handling: "single-page-application"`.

---

## 10. Commands

Run from `D:\Claude Local\raxtan` in Git Bash.

### Local development
```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm --filter @craftbid/api seed
pnpm dev
```
Web on http://localhost:5173, API on http://localhost:4000. Oracle needs about
50 seconds the first time. Start Docker Desktop first.

### Tests
```bash
pnpm typecheck
pnpm --filter @craftbid/api test
pnpm --filter @craftbid/web test:resilience
pnpm test:e2e
pnpm --filter @craftbid/web test:worker
```
The API tests **empty the local database**. Re-seed afterwards:
`pnpm db:reset && pnpm --filter @craftbid/api seed`.

### Production database (uses `.env.adb`)
```bash
ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate
ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate:status
```

### Staff access (the only way to grant it)
```bash
ENV_FILE=.env.adb pnpm --filter @craftbid/api staff list
ENV_FILE=.env.adb pnpm --filter @craftbid/api staff grant <email>
ENV_FILE=.env.adb pnpm --filter @craftbid/api staff revoke <email>
```

### Purging test accounts (dry run first, always)
```bash
PURGE_PREFIX=smoketest_ ENV_FILE=.env.adb pnpm --filter @craftbid/api purge:accounts
PURGE_PREFIX=smoketest_ ENV_FILE=.env.adb pnpm --filter @craftbid/api purge:accounts -- --commit
```
`_` is a SQL LIKE wildcard; read the dry-run list before committing. The purge
also deletes the accounts' conversations; share reactions and share comments
go with their shares.

### Reported commission problems (owner)
```bash
ENV_FILE=.env.adb pnpm --filter @craftbid/api problems list
ENV_FILE=.env.adb pnpm --filter @craftbid/api problems resolve <problemId> continue "note both people will see"
ENV_FILE=.env.adb pnpm --filter @craftbid/api problems resolve <problemId> cancel "note both people will see"
```

### Desktop release
```bash
git tag v0.1.1 && git push origin v0.1.1
```

---

## 11. Deploying safely

The order that has worked every time:

1. **All suites green locally** (section 10).
2. **If there is a new migration, run it on production first** and confirm with
   `migrate:status`. Every migration so far is additive or widens a rule, so
   running it before the code is harmless.
3. **Commit and push to master.** Cloudflare and Render both deploy on push.
4. **Watch it go live:**
   - Web: the `assets/index-*.js` filename in the live HTML changes.
   - API: a route added in the change stops returning 404 (for example 401).
   - CI: `gh run list --limit 1`.
5. **Verify on production**, including WebKit (iPhone 13 profile) for anything
   a phone user touches.
6. **Purge the smoke-test accounts** (dry run, then commit).

### Production smoke-testing rules
- **Never smoke-test by signing up through the site.** With Brevo on, every
  sign-up sends a real email; test addresses bounce and bounces can get sending
  blocked. Instead, create `smoketest_` users directly in the database with the
  repository's own functions using `ENV_FILE=.env.adb`, test, then purge.
- The Playwright scripts used for production checks lived in the session
  scratchpad and are **not in the repository**.

### Traps
- **Editing `render.yaml` does not change the existing Render service.** Change
  build commands in the Render dashboard.
- **Render redeploys when environment variables change.**
- **A service worker can show the previous build once** after a deploy.
- **Text renders about 40px wider on the Linux CI runner than on Windows.** A
  layout that fits locally with no spare room overflows in CI (13.15, 13.24).
  The header width test requires 32px spare at 1024px and 8px at 320px.
- **Cloudflare and Render deploy at different moments**, so never rename an
  API field in one push.

---

## 12. Testing

Counts at `87ceeb3`:

| Suite | Count | What it covers |
|---|---|---|
| API integration (Vitest, real Oracle) | 292 | Auth, sessions, CSRF, authorisation attacks, uploads, bids including lower bids and their privacy, commissions, payment records, ImageKit signing, social rules, shares and their independent engagement, activity privacy, email verification, rate limits, cache headers, notifications read, emoji by field, chat access and lifecycle, moderation, admin API, reports, bug reports, role switching, crop maths and profile shape checks |
| Resilience (Playwright, stubbed API, production build) | 91 | Stale chunk recovery, hung API, header at all widths, sign-in flows, account menu, prompts, verify pages, payout layout, feed freshness, show password, profile checklist, balance Save changes, phone bell, lower-bid form and card, notifications auto-read, footer, chat screens, admin screen, reporting, bug report, account type, shared cards and original dialog, See more, crop editor, slow font host and old-browser deadline, home feed request cards and /feed fallback, chat images (paste, attach, VP8/VP8X size check), admin Problems and Payments |
| End-to-end (Playwright, real API + Oracle, desktop and mobile) | 18 | Register through emailed link, post a request, bid, choose, full payment record, report and staff removal (with the real staff CLI), chat carried into the commission with a real image upload, cropped avatar and cover through the real upload pipeline, a new request first on the home page |
| Worker (node test) | 12 | /api proxy, including open-proxy attempts |

Practices that paid off:
- **Mutation checks:** break the rule on purpose, confirm a test fails, restore.
  Done for every new rule this batch (write-time status check, staff guard,
  comment removal filter, role-switch cooldown, chat membership and closing,
  share reaction separation, feed session wait, emoji rule).
- **Tests use real Oracle, never mocks**, because the rules live in constraints.
- The resilience suite blocks service workers, because `page.route` cannot see
  requests a service worker answers.
- **Locator traps:** a required field's label renders an asterisk, so exact
  `getByLabel` fails; use `getByRole(..., { name, exact: true })`. "Your price"
  also matches "Why is your price lower?"; "Comment" also matches "1 comment".
- **E2E specs that open extra browser contexts must pass
  `testInfo.project.use` and close them**, or signed-in pages left open keep
  polling and push the next test into a timeout (13.26).
- **Resilience stubs must answer every API path a test depends on.** An
  unstubbed call got a 404 locally but a refused connection on CI (13.34). The
  shared `apiPath` also treats every other origin as the API, so a route for an
  outside host (fonts) must be registered after the API stub.
- **Jobs take their clock as an argument**; never test them against real time.

CI (`ci.yml`) runs typecheck, migrations against an Oracle service container,
API tests, builds, worker tests, resilience tests, and a check that no `.env`,
wallet or PEM file is tracked. **The e2e suite does not run in CI**; run it
locally before deploying anything user-facing.

---

## 13. Bug and fix log

Every one of these was found by running the thing. Longer write-ups for 13.1 to
13.15 are in `docs/HANDOVER.md` section 4.

**Earlier in the project**
- **13.1 Sign-out left people signed in.** Clearing cookie did not match the
  set cookie's attributes. Fixed with `clearCookieOptions`.
- **13.2 Every request after sign-in was 401.** Cross-site Lax cookies. Moved to
  `SameSite=None; Secure` plus an Origin check.
- **13.3 Image uploads 500 in production.** Wrong ImageKit key, untested upload.
- **13.4 Reference photos cropped.** Forced aspect ratio; now proportional.
- **13.5 Stale build after deploy.** Service worker cache (automated in 13.14).
- **13.6 Four failed deploys in a row.** corepack, Node 26, wrangler root.
- **13.7 `_redirects` broke the Cloudflare deploy.** Replaced by SPA fallback.

**2026-09-12 to 2026-09-14**
- **13.8 White page after a deploy.** Chunk-aware `ErrorBoundary` (`362eb9e`).
- **13.9 Skeletons that never resolved.** 20-second deadline plus retry of 408.
- **13.10 Contact-links dropdown covered the row.** `control()` width rule.
- **13.11 iPhone users "need to sign in" after signing in.** API moved to `/api`
  through the Worker, session confirmed with `/auth/me` (`7ec3bca`).
- **13.12 Phone header covered most of the screen.** Menu closes, header hides.
- **13.13 Perceptual receipt hash worse than useless.** Removed before shipping.
- **13.14 "Where clients pay you" missing in Settings.** `appUpdates.ts`, cog menu.
- **13.15 Header 15px too wide at 1024px on CI only.** Spare-width test.
- **13.16 Receipts reached the artist as a lossy JPEG.** `tr:orig-true`.
- **13.17 Payout form boxes uneven.** One grid per method.
- **13.18 "Saved a post while signed out."** Was a missing explanation; popup.
- **13.19 Flaky payments e2e.** Random 16x16 receipt block.
- **13.20 Dialogs opened with a heavy focus ring on the X.** Focus on content.
- **13.21 Headings cramped on phones.** Optical size pinned at 24.
- **13.22 Banner told existing users "We sent a link".** Reworded (`37a3a8f`).

**2026-09-14 to 2026-09-15**
- **13.23 Home page did not show new posts on refresh.** Measured on production:
  three Chromium loads, one server response. Anonymous reads were
  `max-age=30, stale-while-revalidate=300`, and a lapsed access token made a
  signed-in feed fetch look anonymous. Fixed with `no-cache`, session-cookie
  reads treated as private, and the feed waiting for `/auth/me` (`343262f`).
- **13.24 Page scrolled 3px sideways at 320px on CI only.** The new footer Help
  column filled 288px exactly on Windows. Footer columns wrap (`dc7d249`).
- **13.25 Phone header 16px too wide at 320px.** The Messages icon made four
  icons plus the wordmark overflow, clipped rather than scrolling so no test
  saw it until measured. Wordmark hidden below 360px; test now checks spare
  room at 320px.
- **13.26 Payments e2e timed out after the moderation e2e.** The new spec left
  three signed-in browser pages open that kept polling. Contexts now use the
  project's device settings and are closed; the suite went from 4.1 to 1.2
  minutes.
- **13.27 Chat box was 110px tall for one line.** The shared `TextArea`'s
  `min-h-28` beat the caller's height; a caller-supplied `min-h-` now wins, and
  the box grows with its text up to 160px.
- **13.28 Name printed across the taller 3:1 cover on desktop.** Only the
  portrait overlaps the cover now; the name sits 20px below it.
- **13.29 A notification arriving while the page loaded was marked read unseen.**
  Found in design review of "mark read on open"; fixed with `throughId`.

**2026-09-15, second half (four batches: `a96610f`, `e7d50ee`, `f3a2834`, `0ad7b8c`, `87ceeb3`)**
- **13.30 Blank page from a Messenger link (black in Messenger, white in Chrome).**
  Reproduced on production in Chromium and WebKit: with `fonts.googleapis.com`
  hung, the render-blocking stylesheet left no `<body>` for over 90 seconds.
  Fonts self-hosted, a static "Loading Craftbid" line in `#root` (`a96610f`).
- **13.31 Older iPhones (before iOS 16) loaded no data.** `AbortSignal.timeout`
  was called unguarded, so every request threw. `deadlineSignal` fallback.
- **13.32 "-1 days ago".** Four copies of a floored day difference; the server
  clock runs a few seconds ahead of phones. One `daysAgo`/`shortAgo`, clamped at
  zero, Manila calendar days. A mutation test reproduces the exact string.
- **13.33 "My post is not on the home page or my profile."** It was a craft
  request (a client account), and the feed and profiles only showed portfolio
  posts. Requests now appear in the feed and on profiles (`e7d50ee`).
- **13.34 CI failed after the home feed push, locally green.** The hung-request
  recovery test held only `/feed`; the page now asks `/home` first, which got a
  404 locally but a refused connection on CI. The test holds both (`f3a2834`).
- **13.35 First ranking draft did not lift new items.** "Freshness at least 0.9
  under 6 hours" changed only items 5.5 to 6 hours old, so a 5-hour-old post
  still lost to favourites under 42 hours. Replaced by the `fresh` step before
  shipping; the spec records the revision.
- **13.36 Chromium writes canvas WebP as VP8X, not VP8.** The resilience size
  check parsed the wrong header; it now reads both.
- Also: `Array.prototype.at` removed from the conversation page (Safari before
  15.4); the chat composer hides suggestions while a photo waits, which kept it
  from covering 40% of a phone screen.

---

## 14. Client decisions and conversation history

In order, so the reasoning behind the current state is not lost.

1. **Fixes requested:** contact-links dropdown overflow; white page and stuck
   skeletons; speed. Done.
2. **Big request:** Keep me logged in; phone header; iPhone "sign in" bug; social
   preview metadata; payments assessment with no money custody. Done. Social
   preview **image** must come from the client and must not be generated.
3. **Stripe:** not available to Philippine businesses as a merchant. Local
   options are PayMongo and Xendit.
4. **Three payment options presented:** (1) pay directly and Craftbid records it,
   free; (2) payment links; (3) licensed marketplace with split payouts.
5. **Client chose Option 1 with a twist:** 50% down, balance on arrival, receipts
   required. Built (`cfe36a8`).
6. **"Boosts"** (paid boosted posts) are **on hold**.
7. **Settings link and missing payment section.** Fixed.
8. **Client batch:** payout layout, fonts, prompts, saved posts, activity
   history, share to profile, sign-in popup, email verification, cog menu.
   Share means repost to profile; Brevo with a Gmail sender; existing accounts
   verify on next sign-in. Built (`8d2c89e`, `37a3a8f`).
9. **Second batch (2026-09-14):** feed not updating, show password, role badge,
   staff admin screen, balance choice confirmation, profile reminders, phone
   notification visibility. Built (`343262f`).
10. **Role switching:** the developer chose a guarded switch after a pros and
    cons review (the risk that decided the guards: an artist switching to
    client to read competitors' bids).
11. **Admin screen decisions:** suspend (reversible) and remove (keeps commission
    records) instead of hard delete; suspended content stays visible; removals
    tell the person the rule; staff flag via CLI, expandable later; bug reports
    and comment reports included; accounts list shows email confirmed or not.
    Built (`7da0090`). The developer is staff (`yus3n`).
12. **Third batch (2026-09-15), approved as three sub-batches:**
    - Chat between client and bidding artist, carried into the commission;
      read-only after rejection, withdrawal or cancellation; no notification
      per message; polling.
    - Artists may bid below the starting budget with a reason.
    - Notifications mark read on open; "Mark all read" removed.
    - Shared posts get their own engagement; the original opens separately.
    - Captions fold with See more; footer asks for feedback.
    - Avatar and cover cropping; the cover became a fixed 3:1 (approved).
    - Emoji allowed or refused by field.
    - **"Pay after seeing photos" kept** as a structured safeguard; chat does not
      replace payment state. Contact links kept (partially redundant with chat).
    Built and deployed (`0fc84e5`).
13. **Fourth round (2026-09-15), approved as four batches, each deployed on its own:**
    - Fixes: blank page (13.30), older iPhones (13.31), "-1 days ago" (13.32),
      chat suggestions cut to three that wrap.
    - Home feed: requests in the feed and on client profiles (open and in
      progress), and the feed personalised by craft interest from reactions,
      comments, saves, shares, searches, bids and requests.
    - Chat images: attach or paste, compressed in the browser, private.
    - Staff tools: daily summary **to the developer only, once a day at 4 PM,
      and no email at all on a day with nothing new** (to save Brevo's limit);
      commission problems in the admin screen; unread chat notice **in-app only**
      after 1 hour; and, added by the developer during review, **every payment
      record and its receipt visible to staff whether or not it was accepted**,
      with each receipt view recorded.
    Deployed as `a96610f`, `e7d50ee` (+ `f3a2834`), `0ad7b8c`, `87ceeb3`.
14. **Balance options (2026-09-16):** the developer removed "Pay after seeing
    photos" (it had been kept in decision 12) and cash on delivery. The balance is
    paid by GCash/Maya/bank after the piece arrives, or in cash at a meet-up.
    Finished photos are optional. The two active production commissions on the
    old option became "pay after delivery" automatically.

---

## 15. Weaknesses, gaps and risks

**Product and trust**
- **No buyer protection.** Craftbid can pause a commission and act on an account
  but cannot return money.
- **The daily summary goes to one address and only once a day**, so something
  urgent reported at 4:05 PM waits until the next afternoon unless someone opens
  the admin screen.
- **No reminders** when someone stops responding on a commission (the job runner
  exists now; only unread chat is nudged).
- **No receipt retention policy.**
- **Moderation rule wording is placeholder text** (`MODERATION_RULE_COPY` in
  `packages/shared/src/constants.ts`) and people see it in notifications. It
  needs the client's site rules.
- **Privacy notice and terms** do not yet mention receipts, refunds, chat,
  moderation or email verification.
- **No change-email flow**, and someone can register another person's email.
- **Reviews cannot be edited or deleted** (by design).
- **Chat nudges are in-app only**, so someone who never opens the site will not
  know a message arrived.
- **Interest data is a new use of personal activity.** The privacy notice must
  say activity orders the person's own feed, and that staff may review payment
  records and receipts to settle disputes.
- **Messages cannot be reported** individually; only comments, posts, profiles,
  requests and bids can.

**Email**
- **Brevo delivery to a real inbox was not confirmed** by the developer yet.
- **Gmail sender without a domain** lands some emails in Spam or Promotions.
- **300 emails a day** on the free plan.

**Infrastructure (free tiers)**
- **Render sleeps** after 15 idle minutes; cold starts are 30 to 60 seconds, and
  chat polling during a cold start shows nothing until it wakes.
- **Oracle Always Free is deleted after 90 idle days.**
- **ImageKit 20GB/month** bandwidth is the first limit an image-heavy marketplace
  hits.
- **Desktop builds are unsigned** and have never been installed or run.

**Code**
- **Signed-in production screens from 2026-09-15 were not verified on
  production** (chat and chat images, lower-bid form and card, crop upload,
  shared-card engagement, the personal ordering of the feed, admin Problems and
  Payments, the daily summary email): no smoke-test accounts, because the
  permission classifier refused creating them. Signed-out screens and route
  guards were verified on WebKit after each deploy.
- **The job runner lives in the API process.** If Render is ever moved to a plan
  or host that scales to more than one instance, every job is still safe (runs
  are claimed in the database), but ticks multiply.
- **Activity history does not include reactions or comments on shares.**
- **Older avatars and covers** keep their original shapes; covers are
  centre-cropped by CSS until replaced.
- **Search is a substring scan** without an index.
- **The home feed ranks only the newest 500 items**; older work is still on
  Discover and the request list.
- **`complete()` returns 400 where 403 is correct.**
- **`uploadImage` has no deadline.**
- **The e2e suite is not in CI**, and production check scripts are not in the repo.
- **`applicationCount` on a request is visible to everyone**, including other
  artists (a count, not amounts).
- **Local folder is still named `raxtan`.**

---

## 16. Open items and future plans

### For the developer, now
1. **Set `OWNER_ALERT_EMAIL` in Render** if it is not set yet (Render dashboard,
   craftbid-api, Environment). Then expect the first summary at 4 PM on a day
   when something was reported.
2. **Try the new signed-in flows on production:** chat from a bid and from a
   commission, sending and pasting a photo, a lower bid with a reason,
   cropping a new avatar and cover, reacting on a shared card, the admin
   Problems and Payments tabs (open a receipt, then see it in the Activity log),
   and an unread message waiting an hour on another account.
3. **Ask the person whose Messenger link was blank to try again** (13.30).
4. **Test real email delivery** with a real inbox (Spam/Promotions too).
5. **Confirm your own existing account** through the banner if not done.
6. **Tell the client what changed** (chat and chat images, lower bids with
   reasons, requests in the home feed and on profiles, the personal feed, report
   buttons, bug reports, account type switch, cropping, shared posts, feedback
   footer, the staff tools).
7. **Decide what to do with the production demo accounts** (section 3).

### Waiting on the client
1. **Site rules wording** for warnings and removals.
2. **Refund rules** (what happens to the down payment when either side cancels).
3. **Receipt retention period** (6 or 12 months is common).
4. **Who handles moderation** besides the developer (grant staff with the CLI).
5. **The social preview image** (do not generate one).
6. **Whether to resume boosts.**
7. **Whether to buy a domain** (better email delivery, a proper web address).

### Suggested next builds, in priority order
(Owner alert, problems in the admin screen and chat nudges were built in round 13.)
1. **Privacy notice, terms and site rules pages**, once the client's decisions
   exist; they must now mention interest-based ordering and staff access to
   payment records.
2. **Receipt retention job and commission reminders**, on the existing job runner.
3. **Change-email flow** (verify the new address before switching).
4. **Move production check scripts into the repo** and add the e2e suite to CI.
5. **Share engagement in activity history.**
6. **Retire `/feed` for the "For you" tab** once no old tabs remain (keep it for Saved).
7. **Domain + authenticated Brevo sending.**
8. **Boosts**, if the client resumes them (needs the provider route in
   `docs/PAYMENTS.md`).
9. **In-app payments (Option 3)**, only after `docs/PAYMENTS.md` section 10.
10. **Oracle Text search**, when data volume justifies it.
11. **Desktop app:** tag a release and actually install and run it.

---

## 17. Code worth knowing

### Gating an action on a confirmed email (`apps/api/src/plugins/auth.plugin.ts`)
```ts
app.decorate("requireVerified", async (request: FastifyRequest) => {
  if (!request.user) throw unauthorized();
  if (!emailVerificationEnabled()) return;
  const user = await findById(request.user.id);
  if (!user?.emailVerifiedAt) {
    throw new AppError(403, "email_unverified", "Confirm your email first. ...");
  }
});
```
Use it on a route: `preHandler: [fastify.requireRole("artist"), fastify.requireVerified]`.

### Staff-only routes (`apps/api/src/modules/admin/admin.routes.ts`)
```ts
export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // Encapsulated plugin: this hook guards these routes and nothing else.
  app.addHook("preHandler", fastify.requireStaff);
  ...
};
```
Every change goes through `modules/moderation/moderation.service.ts`, which
writes the audit row inside the same `withTransaction` as the change.

### Who may be in a conversation (`apps/api/src/modules/chat/chat.service.ts`)
```ts
function stateOf(access: repo.ChatAccess) {
  if (access.applicationStatus === "accepted" && access.commissionId) {
    return { stage: "commission", commissionId: access.commissionId,
             canSend: access.commissionStatus !== "cancelled" };
  }
  return { stage: "bidding",
           canSend: access.applicationStatus === "pending" && access.postingStatus === "open" };
}
```
Access is read fresh from the request, the bid and the commission on every call.

### Engagement on a post or a share (`apps/api/src/modules/social/social.repository.ts`)
```ts
export type Target = "post" | "share";
const REACTION_TABLE: Record<Target, { table: string; column: string }> = {
  post: { table: "post_reactions", column: "post_id" },
  share: { table: "share_reactions", column: "share_id" },
};
```
Pass `"share"` as the last argument of `setReaction`, `reactionSummaries`,
`listComments`, `insertComment` or `commentCounts`.

### Cropping (`packages/shared/src/crop.ts`)
```ts
const frame = clampFrame({ centerX, centerY, zoom }, imageWidth, imageHeight, COVER_CROP);
const rect = cropRect(frame, imageWidth, imageHeight, COVER_CROP); // source pixels
const size = outputSize(rect, COVER_CROP);                          // what to save
fitsCropSpec(storedWidth, storedHeight, COVER_CROP);                // server check
```

### Spending a verification link exactly once (`auth.repository.ts`)
```ts
const changed = await tx.run(
  `UPDATE email_verification_tokens SET used_at = SYSTIMESTAMP
    WHERE id = :id AND used_at IS NULL`,
  { id: uuidToBuf(id) },
);
return changed === 1; // two racing clicks cannot both sign in
```

### Asking before losing unsent text (web)
```tsx
useUnsavedChanges(title.trim() !== "" || images.length > 0);
const { leaveWithoutPrompt } = useUnsavedChangesState();
leaveWithoutPrompt();
navigate(`/postings/${posting.id}`);
```

### Requiring an account (and a confirmed email) for a click (web)
```tsx
const requireAccount = useRequireAccount();
function toggleSave() {
  if (!requireAccount("save posts")) return; // opens the right popup
  save.mutate(!saved);
}
```

### Adding a scheduled job
1. A function `runSomething(now: Date)` in `apps/api/src/jobs/` that claims its
   work in the database (`claimRun` for a once-per-period job, or a guarded
   UPDATE for per-row work) so a second tick does nothing twice.
2. Add it to `JOBS` in `runner.ts`.
3. Test it with an injected `now`, and break the claim once to prove the test
   catches a double run.

### Recording interest from a new action
```ts
await recordInterest(userId, "comment", { postId });   // after the write succeeds
```
Signals and weights are `INTEREST_WEIGHTS` in `packages/shared/src/interest.ts`.

### Adding a new notification type
1. Add it to `NOTIFICATION_TYPES` in `packages/shared/src/constants.ts`.
2. Write a migration that drops and re-adds `ck_notifications_type` with the full
   list (copy the list from `020-staff-tools.sql` and append).
3. Add its wording to `COPY` in `apps/web/src/pages/NotificationsPage.tsx`, and a
   `linkFor` rule if it should open somewhere specific.
4. Run the migration on production before pushing.

### Adding a feature the usual way
1. Shared Zod schema and DTO type in `packages/shared`, then
   `pnpm --filter @craftbid/shared build`.
2. Migration if the data model changes (constraints over code).
3. Repository (SQL only here) → service (rules, ownership) → routes (validation,
   guards, rate limit).
4. Integration test against real Oracle, including the refusal cases; break the
   rule once to prove the test catches it.
5. Web page or component; a resilience test for anything a phone user touches.
6. Local suites green, migration on production, push, verify live on WebKit,
   purge smoke-test data.

---

## 18. Audit of 2026-09-17: findings and the fix plan

A read-only audit ran on 2026-09-17 with the `cso` (security), `launch-audit`
(SEO, accessibility, legal, performance), `stop-slop` (copy),
`web-design-guidelines` and `design-taste-frontend` skills, against the code and
the live site. **Nothing was fixed.** The security report JSON is at
`~/.gstack/projects/craftbid/security-reports/2026-09-17-audit.json` (outside the
repo on purpose).

The developer asked for this handoff before any fixes. The recommended first
batch is items 18.1 to 18.7; 18.8 needs the client. Every fix follows the usual
rules: test first and watch it fail, mutation check, all suites green, commit
and deploy only when told.

### What passed (do not re-audit)
- Access control: bids, commissions, payment files, chat and chat files all
  answer 404 to non-parties (authorization.test.ts, chat-images.test.ts).
- SQL: every interpolated fragment is a code constant or a fixed map entry;
  every value is bound. No injection found.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval`; sign-in `returnTo` comes from
  router state, not the URL (no open redirect).
- CSRF origin check, JWT verified with issuer and audience, refresh tokens
  hashed and rotated, uploads sniffed by magic bytes and re-encoded, EXIF dropped,
  verification email HTML-escaped, log redaction of auth headers.
- No secrets in git history; `.env*`, wallet files gitignored; the tracked
  `.env.example`, `.env.production`, `.env.desktop` hold no secrets.
- Every `<img>` has `alt` and dimensions. No horizontal scroll at 375px or
  1920px on public routes. Initial JS about 204 KB gzipped (vendor 164, index 40).
- No `transition: all`, no clickable divs, zoom not disabled, focus rings
  present, autocomplete on auth forms, `prefers-reduced-motion` honoured.

### 18.1 BLOCKER: rate limits bypassable on the public Render origin

> **Corrected in section 20.1.** Measured on production: this bypass does not
> work (Cloudflare refuses a client-written CF-Connecting-IP with error 1000,
> and a fake X-Forwarded-For opens no new bucket). The real bug is the
> opposite: every visitor through the site shares one bucket. The text below
> is kept as the original audit said it.

- **Where:** `apps/api/src/app.ts:69` (`clientAddress`), `app.ts:100`
  (`trustProxy: true`), `apps/web/worker/api-proxy.ts` (`upstreamHeaders`).
- **Problem:** `craftbid-api.onrender.com` answers the internet directly.
  `clientAddress` trusts `CF-Connecting-IP` from any caller, and its fallback
  `request.ip` reads a client-supplied `X-Forwarded-For` because of
  `trustProxy: true`. A script calling Render directly with a new fake IP per
  request is never limited.
- **Impact:** unlimited password guessing on `POST /auth/login` (no lockout,
  passwords 10 characters minimum), unlimited `POST /auth/register` with other
  people's email addresses (Brevo sends to anyone, burns the 300/day limit and
  risks the Brevo account), unlimited uploads.
- **Fix (recommended):**
  1. New secret `PROXY_SHARED_SECRET` (32+ random chars) set in both the
     Cloudflare Worker (`wrangler secret put PROXY_SHARED_SECRET`, or the
     Cloudflare dashboard since the local wrangler token is expired) and Render.
  2. `worker/api-proxy.ts` `upstreamHeaders`: set `x-craftbid-proxy: <secret>`,
     and delete any incoming `x-craftbid-proxy` first.
  3. `app.ts` `clientAddress`: trust `CF-Connecting-IP` only when
     `x-craftbid-proxy` equals the secret (constant-time compare); otherwise use
     the real socket address. Set `trustProxy` to Render's proxy hop count
     (`trustProxy: 1`) instead of `true`, so `request.ip` is Render's view of the
     caller, not a header the caller wrote.
  4. Add a per-account limit on login failures (for example 10 per 15 minutes
     per email, keyed on the normalised email) so a distributed guesser is
     still slowed.
  5. Config: optional in development, required in production (refuse to boot
     without it, like `JWT_SECRET`).
- **Tests:** `rate-limit.test.ts`: with a forced-on limiter, 11 logins with a
  different `CF-Connecting-IP` each and no proxy header are limited; with the
  correct proxy header each distinct IP gets its own bucket; the per-email limit
  trips across IPs. Worker test: the proxy header is set and an incoming one is
  replaced. Mutation: trust the header without the secret, a test fails.
- **Deploy order:** set the secret in Render and Cloudflare first, deploy the
  Worker change (it only adds a header), then the API change.

### 18.2 HIGH: sharp has known CVEs on every upload
- **Where:** `apps/api/package.json:35` (`sharp ^0.33.5`); used in
  `modules/images/images.service.ts` `normaliseImage` for public images,
  commission files and chat images.
- **Advisories:** libvips CVE-2026-33327/33328/35590/35591 (fixed in sharp
  0.35.0) and libheif GHSA-g89c-p67h-r497 / GHSA-2jg2-4ch7-h545 (fixed 0.35.4).
  The magic-byte check (JPEG/PNG/WebP only) limits reach, but upgrade anyway.
- **Fix:** `pnpm --filter @craftbid/api add sharp@^0.35.4`; check the API
  changes between 0.33 and 0.35 (`limitInputPixels`, `failOn`, `rotate`,
  `resize`, `webp`, `metadata`); run images.test.ts, commission-payments and
  chat-images tests; confirm Render's build installs the linux-x64 prebuilt.
- Also listed but NOT reachable in production: `@fastify/static 8.3.0`
  advisories. It is registered only when `STORAGE_DRIVER=local`, which config
  refuses in production. Upgrade to 9.1.1+ when convenient.

### 18.3 SHOULD FIX: no security headers on the web app's HTML
- **Where:** live `https://craftbid.pgeagoni.workers.dev/` returns no
  `X-Frame-Options`, CSP, `X-Content-Type-Options`, `Referrer-Policy`. The API
  responses have them (helmet).
- **Impact:** clickjacking. Any site can frame Craftbid (SameSite=None cookies
  are sent in the frame) and trick a signed-in artist into pressing "Yes, I
  received it" or staff into a moderation button.
- **Fix:** add `apps/web/public/_headers` (Cloudflare static assets honour it):
  ```
  /*
    X-Frame-Options: DENY
    Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    Permissions-Policy: camera=(), microphone=(), geolocation=()
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```
  Only add a full `script-src` CSP after testing (ImageKit images, the service
  worker and fonts must still load). Also check the Worker (`worker/index.ts`)
  does not strip these for SPA fallback responses; `run_worker_first` covers
  only `/api/*`. Verify with `curl -sI` on `/`, `/postings/x` and an asset.
- **Tests:** resilience or worker test cannot see Cloudflare headers; verify on
  production with curl after deploy and record it.

### 18.4 SHOULD FIX (cheap, do with 18.3): SameSite and source maps
- `apps/api/src/lib/tokens.ts:116`: session cookies are `SameSite=None` in
  production, needed only when the API was cross-site. The site now calls
  `/api` on its own origin, so `Lax` works and closes the framed-cookie path.
  Test on WebKit (iPhone 13 profile) that sign-in, refresh and sign-out still
  work on production before relying on it (13.2 and 13.11 are the history).
  The desktop build uses bearer tokens and is unaffected.
- `apps/web/vite.config.ts` `build.sourcemap: true` ships all 42 `.map` files
  publicly (`/assets/index-*.js.map` returns 200). Set `sourcemap: false` (or
  `"hidden"` if error tracking is ever added).

### 18.5 BLOCKER: false copy and test data on the public site
- `apps/web/src/pages/RegisterPage.tsx:98` says the account type "cannot be
  switched later". It can (guarded role switch, 30-day cooldown). Rewrite, for
  example: "You can switch later from Settings, once you have nothing open."
- `apps/web/src/pages/DiscoverPage.tsx:48` says "then invite them to bid on your
  request". No invite feature exists. Rewrite, for example: "Find someone whose
  work you like, then post a request in their craft."
- Footer link "Browse artists" (`components/layout/Shell.tsx`) opens `/discover`,
  which lists work, not artists. Rename to "Browse work" or link to search.
- **Production data:** the public home page shows the developer's test request
  "Test Post" ("Please commenti ni ang post kag react...") and a share captioned
  "sd" by `yus3n`. Ask the developer before touching production data; they
  cancel the request and delete the share from the site themselves, or approve
  a purge.

### 18.6 BLOCKER (SEO): same title and description on every route
- No `document.title` anywhere in `apps/web/src`. Every route shows
  "Craftbid — Commission handmade work from Filipino artists".
- **Fix:** a small `usePageTitle(title, description?)` hook in
  `apps/web/src/lib/` that sets `document.title` and the description meta, used
  by every page: request detail (`<title> · Craftbid`), profile
  (`<displayName> (@username) · Craftbid`), post detail, Craft requests,
  Discover, Search, Sign in, Join, Messages, Admin, NotFound.
- **Link previews for shared request/profile/post links** (Messenger and
  Facebook do not run JavaScript): the Worker can answer HTML for
  `/postings/:id`, `/artists/:username`, `/posts/:id` by fetching the API and
  rewriting the `<title>` and `og:*` tags in `index.html` with `HTMLRewriter`
  before returning it. That needs `run_worker_first` for those paths. Build it as
  its own step, with worker tests; the social preview image still waits on the
  client.
- Remove the em dashes from `apps/web/index.html` `<title>`, `og:title` and
  `twitter:title` (lines 32, 38, 52): "Craftbid: commission handmade work from
  Filipino artists" or "Craftbid | Handmade work from Filipino artists".
- Also: `WorkRibbon.tsx:87` title attribute uses an em dash.

### 18.7 SHOULD FIX (SEO and crawl basics)
- `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/favicon.ico` all return the SPA
  `index.html` with 200. Add `apps/web/public/robots.txt` (allow all, disallow
  `/admin`, `/settings`, `/messages`, `/commissions`, `/my/`, `/api/`,
  `Sitemap: https://craftbid.pgeagoni.workers.dev/sitemap.xml`), a
  `favicon.ico`, and `llms.txt` (a short plain description of Craftbid).
- Sitemap: generate dynamically in the Worker from `/api/postings?status=open`
  and published posts and profiles, or start with a static one listing `/`,
  `/postings`, `/discover`.
- Unknown URLs return 200 (SPA fallback). Crawlers see soft 404s. The React
  `NotFound` page should add `<meta name="robots" content="noindex">`; a true
  404 status needs the Worker to know valid routes, which is optional.
- Add `<link rel="canonical">` (set per route by the title hook) and JSON-LD
  (`Organization` on home; optionally `Product`/`Offer` is NOT right for requests,
  skip until there is a clear type).
- `<h1>` missing on `/posts/:id` (PostDetailPage) and the NotFound page.

### 18.8 BLOCKER, needs the client: Privacy Policy and Terms
- No `/privacy` or `/terms` page exists. Craftbid collects names, emails,
  usernames, region and city, payout account names and numbers, receipt images
  with reference numbers, chat messages and images, reports, and per-person
  craft interest scores used to order the feed. Philippine Data Privacy Act of
  2012 applies.
- Draft both from the app's actual data flows (sections 5, 8), clearly marked as
  drafts for a lawyer, and link them from the footer and the Join page. Must
  cover: what is collected and why, storage (Oracle in Singapore, ImageKit,
  Brevo), who sees what (the two parties, staff for moderation and disputes,
  receipts viewable by staff with every view recorded), interest-based feed
  ordering, retention (client decision), deletion requests contact, no in-app
  payment custody and no refunds by Craftbid, acceptable use and account
  suspension/removal, the site rules (`MODERATION_RULE_COPY`, still placeholder).
- Waiting on the client: refund rules, receipt retention period, site rules
  wording, a contact email for privacy requests.

### 18.9 Lower priority
- `design-taste-frontend` notes: uppercase tracked eyebrow labels are used
  heavily ("HANDMADE IN THE PHILIPPINES", "CRAFTS ON CRAFTBID", "CRAFT REQUEST",
  "STARTING AT", "FOR ARTISTS"/"FOR CLIENTS"), a recognised templated tell; cut
  to a few. The craft category list appears twice on the home page (strip under
  the hero and the "Crafts" sidebar card); keep one. No dark mode (taste call).
  The warm paper palette is near the "AI craft default" family, but it is a
  deliberate brand choice (section 7); do not change without the developer.
- Tap targets under 24px at 375px: footer links (17px tall), "See all", the
  "Keep me logged in" checkbox (20px). Pad to 44px hit areas.
- `WorkRibbon` scrolls for 70s in a loop with no pause control (WCAG 2.2.2);
  add pause on hover/focus and a pause button.
- Email and username inputs: add `spellCheck={false}`.
- Every signed-out page load logs a 401 from `/auth/me` in the console. Skip
  that call when there is no session hint (`mayHaveSession()` false).
- Feed card descriptions run about 104 characters per line at 1920px; cap the
  text width near 75ch.
- Release workflow `.github/workflows/release.yml` uses unpinned third-party
  actions (`tauri-apps/tauri-action@v0`, `dtolnay/rust-toolchain@stable`,
  `swatinem/rust-cache@v2`) with `contents: write`; pin to commit SHAs.
- `POST /auth/register` answers "That email is already registered", revealing
  which emails have accounts. Low impact; worth revisiting with 18.1.
- `.gstack/` is not in `.gitignore`; add it before any gstack skill writes into
  the repo.
- A professional penetration test is advised before real growth, since the site
  holds payment records and receipts.

## 19. Balance options change (shipped 2026-09-18)

**Balance options changed (2026-09-16). Committed and deployed 2026-09-18,
production migrated to 021.** Decision 14 in section 14 and section 8 "Payment
records" describe it. Files:

- `packages/shared/src/constants.ts` (BALANCE_METHODS `["transfer", "meetup"]`,
  finishedPhotos min 0), `packages/shared/src/schemas/payments.ts`
  (photos optional)
- `apps/api/src/db/migrations/021-balance-after-delivery.sql` (new)
- `apps/api/src/modules/commission-payments/commission-payments.service.ts`
  (balance requires shipping recorded; ship right after finishing; meet-up cash)
- `apps/api/src/modules/commission-payments/commission-payments.test.ts`,
  `apps/api/src/test/helpers.ts`
- `apps/web/src/components/commission/PaymentPanel.tsx`,
  `apps/web/src/pages/NotificationsPage.tsx`
- `apps/web/e2e-resilience/profile-and-payments.spec.ts`,
  `apps/web/e2e/payments.spec.ts`
- `HANDOFF.md` (this file: the 2026-09-15 update, decision 14, sections 18, 19)

Suites at that point: API 293, resilience 91, e2e 18, worker 12.

**To ship it** (when the developer says "commit this and deploy it"):
1. Start Docker Desktop if the API tests are to be re-run (it was stopped on
   2026-09-16 and had to be started).
2. `ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate`, then `migrate:status`
   shows 021 applied. Production had no `cod` commissions, so the UPDATE in 021
   changes nothing there.
3. Commit (no AI attribution) and push to master.
4. Watch the web bundle filename change, CI, and that
   `PUT /api/commissions/<id>/balance-method {"method":"cod"}` now answers 400.
5. Update this file's header: latest commit, production at migration 021.

**Also open from 2026-09-15:** `OWNER_ALERT_EMAIL` must be set in Render for the
daily summary (section 9); the developer was asked to add it and it was not
confirmed.

**Session-specific traps learned (Windows machine):**
- `core.autocrlf=true`: every checked-out file is CRLF; CRLF warnings from git
  are normal. Python `open(...).write` turns `\n` into CRLF; use `newline=""`.
- Long Bash heredocs containing quotes, backticks or `${}` failed to parse in the
  tool; write scripts with the Write tool into the scratchpad and run them.
- Resilience tests must stub every API path they depend on: an unstubbed call
  got 404 locally but a refused connection on CI (13.34). The shared `apiPath`
  treats every other origin as the API, so a route for an outside host must be
  registered after the API stub.
- Chromium writes canvas WebP as VP8X, not VP8 (13.36).
- Production checks run from Playwright scripts in the session scratchpad; they
  are not in the repo (see 16, suggested build 4).

## 20. Second audit of 2026-09-17 and its fixes

A second, independent audit ran on 2026-09-17 against the code and live
production, and its fixes were built on 2026-09-18. Committed and deployed on 2026-09-18 in
its own commit after section 19; production is at migration 022.
Suites after these changes: API 315, resilience 95, e2e 20, worker 15,
typecheck clean.

### 20.1 Every visitor shared one rate-limit bucket (replaces 18.1)
- Measured: with IPv4 pinned, one address was limited calling Render directly
  and still had a fresh bucket through the site. Cloudflare documents that a
  Worker subrequest to another Cloudflare zone (onrender.com is one) carries
  `CF-Connecting-IP: 2a06:98c0:3600::103` for every visitor.
- Effect before the fix: 10 wrong passwords by anyone locked all sign-ins for
  10 minutes; 5 sign-ups per 10 minutes, 30 bids per hour and 300 requests a
  minute were site-wide.
- Fix: the Worker sends `x-craftbid-client-ip` and `x-craftbid-proxy: <secret>`
  and removes any the visitor sent (`worker/api-proxy.ts`); `clientAddress` in
  `app.ts` believes the address only when the secret matches (constant-time).
  Without the secret nothing changes, so a deploy cannot lock anyone out.
- **Needs `PROXY_SHARED_SECRET` set in Render AND as a Cloudflare Worker secret**
  (dashboard: Workers, craftbid, Settings, Variables and Secrets, type Secret).
- Also added: a per-account failed sign-in throttle (`lib/login-throttle.ts`,
  10 failures in 15 minutes locks that account's sign-in, right password
  included; in memory; off in tests like the limiter).

### 20.2 Bid and request state races
- Reproduced: accept and withdraw on one bid, sent together, both answered 200
  (same for accept and decline). Status was read, then overwritten without a
  condition.
- Fix: `transitionStatus` in applications and postings repositories (`WHERE
  status = :from`, false means someone else got there first, answered 409).
  Used by accept, decline, withdraw, client cancel and staff removal.
- **Lock order matters:** accept claims the request row before the bid row, the
  same order cancel uses. The opposite order deadlocked (Oracle waits about 3
  seconds per deadlock before failing one side).
- Tests: `marketplace-races.test.ts` (12 concurrent trials per case).

### 20.3 Password reset (new)
- `POST /auth/forgot-password {email}`: always 204, sends in the background, at
  most 1 a minute and 3 an hour per account (checked under a row lock; two
  simultaneous requests sent two emails before it). `POST /auth/reset-password
  {token, password}`: 204; 400 `link_invalid`, 409 `link_used`, 410
  `link_expired`. Revokes every session, spends every reset link, marks the
  email confirmed, does not sign in.
- Web: `/forgot-password`, `/reset-password` (token stripped from the address
  bar), "Forgot your password?" on sign in. Migration 022.

### 20.4 Closing your own account (new)
- `POST /me/delete-account {password}` (`modules/users/account-deletion.*`).
  Refused with a commission in progress, an open problem, or staff access.
  Settles like staff removal (requests cancelled, bids withdrawn, posts and
  comments hidden, shares and reactions deleted), re-checks for a new
  commission inside the transaction, then scrubs email and username (freed for
  a new account), name ("Removed account"), bio, location, pictures, links,
  payout details, saved posts, interest scores, notifications and tokens.
  Commissions, payment records, reviews and chat stay for the other person.
- Web: "Close your account" section at the bottom of Settings.
- Not done: images in ImageKit are not deleted.

### 20.5 Smaller fixes
- `SameSite=Lax` everywhere (`lib/tokens.ts`); the Origin check stays. **Verify
  sign-in, refresh and sign-out on production WebKit after deploy** (13.2, 13.11).
- `apps/web/public/_headers`: frame refusal, nosniff, Referrer-Policy,
  Permissions-Policy. Verified with `wrangler dev`, including SPA fallback
  routes; check with `curl -sI` on production after deploy.
- sharp 0.35.4 (libvips and libheif advisories).
- Copy: Join page no longer says the account type cannot be switched; Discover
  no longer mentions inviting artists; footer "Browse work".
- Design: `.eyebrow` is 13px sentence case in `ink-soft` (was 11px tracked
  capitals in the faintest ink on 61 labels, including prices); the signed-out
  hero is one entrance, one colour, 48px, with each sentence on its own line;
  the category strip shows on phones only (the feed sidebar lists the same
  crafts beside the feed on wide screens).
- `release.yml` third-party actions pinned to commit SHAs.
- Removing your own things from the feed (reported by the developer 2026-09-18):
  the "..." menu (`components/PostMenus.tsx`) now gives a post's artist
  "Edit post" and "Delete post", and a shared card's sharer "Remove share",
  each with a confirmation. Before, a share could only be removed from inside
  the Share dropdown, and no screen called `DELETE /posts/:id` at all, so
  artists could not delete their own posts. Other people still see Report.
  Resilience tests in `shares-and-captions.spec.ts`; suite now 98.

### 20.6 To ship section 20 (after section 19)
1. Generate a 32+ character random value. Add it as `PROXY_SHARED_SECRET` in
   Render and as a Worker secret in Cloudflare.
2. `ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate`, then
   `migrate:status` shows 022.
3. Commit and push. Watch CI and both deploys.
4. Check: `curl -sI https://craftbid.pgeagoni.workers.dev/` shows
   `x-frame-options: DENY`; sign in, refresh and sign out on WebKit (iPhone 13
   profile); request a password reset to a real inbox.

### 20.7 Still open from the second audit (needs the developer or client)
- Done 2026-09-18: ImageKit "Restrict unnamed image transformations" is on. A
  new unnamed transform now answers 400, and receipts (signed `tr:orig-true`)
  still load in the admin screen.
- Production test content on the public home page ("Test Post" with a puppy
  photo, open for bids; the share captioned "sd") and the display name "Yusen
  Admin", which advertises the staff account.
- Legal review (Philippine lawyer): privacy notice and terms; whether the
  interest-ranked feed counts as profiling that needs NPC registration (NPC
  Circular 2022-04); whether Craftbid is an "e-marketplace" under RA 11967
  section 21 (seller name with government ID, address, contact details); a
  breach procedure (NPC Circular 16-03, 72 hours).
- Lower: registration says which emails are registered; refresh tokens have no
  reuse detection; resend-verification has the same limit race 20.3 fixed for
  resets; tap targets from 18.9; SEO items 18.6 and 18.7.

## 21. Reaching PLDT users, comment cleanup, console error (shipped 2026-09-18)

### 21.1 PLDT and Smart users could not open the site
- **Symptom:** some people got a white page in Messenger's browser or
  `ERR_CONNECTION_TIMED_OUT` on a PC; others on the same ISP were fine. Two
  affected users were on PLDT, one also failed on Smart 5G (same backbone);
  Converge, Sky and Globe users were unaffected.
- **Cause (measured with the affected user's traceroutes):** the workers.dev
  address resolves to two Cloudflare IPs. `104.21.9.202` routes normally from
  PLDT; `172.67.189.143` fails at PLDT's second hop with "Destination host
  unreachable". A device that picks that IP waits until it times out. Cloudflare
  Community has earlier reports of PLDT losing routes to single Cloudflare
  addresses. Nothing in Craftbid's code causes it, and workers.dev IPs cannot be
  chosen.
- **Workaround in place:** a free **Render Static Site** named `craftbid`,
  `https://craftbid-6w5p.onrender.com`, built from `master` on every push
  (Render's IPs route fine from PLDT; `craftbid-api.onrender.com/health` loaded
  for the affected user). Settings, all in the Render dashboard:
  - Build command: `npm install -g pnpm@10.34.5 && pnpm install --frozen-lockfile && pnpm --filter @craftbid/shared build && pnpm --filter @craftbid/web build`
  - Publish directory: `apps/web/dist`
  - Rewrites, in this order: `/api/*` to `https://craftbid-api.onrender.com/*`;
    `/*` to `/index.html`
  - Headers on `/*`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`. A `Cache-Control:
    no-cache` row was added but Render still sends `public, max-age=0,
    s-maxage=300`, so after a deploy some visitors may reload once within five
    minutes (the app recovers by itself, 13.8).
  - The API's `CORS_ORIGINS` includes this origin; without it every POST was
    403 "did not come from an allowed origin".
- **Verified on production (WebKit, iPhone 13 profile):** sign-in, reload,
  refresh, a protected page and sign-out work through the rewrite; Set-Cookie
  arrives as `HttpOnly; Secure; SameSite=Lax`; signed-in reads stay
  `private, no-store`; a foreign Origin is refused; rate limits count each
  visitor separately (direct calls and calls through this site share one bucket).
- **The developer was asked to set `PUBLIC_WEB_URL` to this address** so
  verification and reset emails open for PLDT users; confirm it in Render.
- Longer term: a custom domain pointed at Render without Cloudflare's proxy, or
  reporting the route to PLDT with the traceroutes.

### 21.2 Comment cleanup (`b443dea`)
- Every comment block (about 1,370) was reviewed by hand. Removed or trimmed:
  incident diaries and dates, "used to" histories, references to the brief, the
  developer or the client, and stale claims. Kept: comments that state a real
  constraint (security, Oracle behaviour, deploy traps, privacy rules).
- Nothing shipped to a browser carries developer commentary: `index.html` has no
  HTML comments, `_headers` holds only rules (Render serves it as a plain file),
  and `vite.config.ts` sets `sourcemapExcludeSources: true`, so the 44 source
  maps keep their mappings but no longer embed the original source.
- Verified as behaviour-preserving: every changed TypeScript and SQL file
  prints identically with comments stripped; all suites green; CI green.
- The AI-agent instruction line was removed from the plan documents.

### 21.3 The 401 in every signed-out visitor's console
- The web app asked `/auth/me` on every load, and a signed-out visitor got a
  401, which browsers print in red. `GET /auth/session` answers "nobody signed
  in" with 200 `{user: null}` and keeps 401 for a credential that no longer
  works, so the app still renews an expired session. The web app falls back to
  `/auth/me` if the API is older, for the minutes between the two deploys.
- Also fixed: when the server says a session cookie was sent, the app renews
  even without the local "has had a session" hint (Safari clears localStorage
  after seven days without a visit while "Keep me logged in" lasts thirty), and
  writes the hint back after a successful renewal. A refresh that fails with 401
  now clears the session cookies, so a revoked session stops failing on every
  visit.
- The anonymous `/auth/session` response is `private, no-store`: the cache hook
  in `app.ts` now keeps a Cache-Control header a route set itself.
- Tests: `session-check.test.ts` (API) and `session-check.spec.ts` (resilience),
  including a mutation check that the forced renewal matters.

### 21.4 Suites
API 320, resilience 100, e2e 20, worker 15, typecheck clean.

### 21.5 Still open
- Fixed 2026-09-18: `PROXY_SHARED_SECRET` now matches. The first attempt still
  showed separate buckets (the API compares byte for byte); a freshly generated
  value pasted into both Render and Cloudflare fixed it. Check: one
  resend-verification call direct, one through workers.dev, one direct again;
  `x-ratelimit-remaining` must go down by one each time (it went 4, 3, 2).
- Done 2026-09-18: `PUBLIC_WEB_URL` in Render is the Render site address;
  `OWNER_ALERT_EMAIL` is set; the "sd" share is removed; the staff display name
  is now "Yusen Main". "Test Post" stays by the developer's choice. Legal review
  is deferred until just before the public announcement.
- Everything else in 20.7 under "Lower".

### 21.6 og:url and the resend-verification race (2026-09-18)
- `og:url` in `apps/web/index.html` now names the Render site.
- `resendVerification` now locks the account row and checks the limits inside
  the same transaction that stores the new link, as `requestPasswordReset`
  does. Measured before the fix: 8 simultaneous resends sent up to 4 emails.
  Test: "sends one link when several resends arrive at the same moment" in
  `email-verification.test.ts`. It runs six trials, because on a cold connection
  pool the requests happen to queue one after another and the race does not
  show; it failed before the fix. Suites: API 321, resilience 100.
