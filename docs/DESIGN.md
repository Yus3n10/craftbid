# RaxTan — Filipino Handmade Crafts Marketplace

**Design document — 2026-09-08**

A marketplace where clients commission handmade craft work and artists bid on it.
Conceptually "TaskRabbit for handmade crafts", with no shared UI, branding, or code.

---

## 1. Investigation findings

Everything below was **verified on this machine**, not assumed.

### Development environment

| Tool | Version | Note |
|---|---|---|
| Node.js | 24.18.0 | Modern; `crypto.scrypt` available in core |
| pnpm | 10.34.5 | Chosen over npm for workspace support |
| Docker | 29.7.2 | Daemon was stopped; started it. 8 GB to the Linux engine |
| Git / gh | 2.51 / 2.98 | GitHub CLI already authenticated |
| Python | 3.11.9 | Not needed for this project |
| Java | **absent** | Rules out JDBC-based tooling (Flyway, Liquibase) |
| Host | i5-13450HX, 15.7 GB RAM, D: 69 GB free | C: is 91% full — build artifacts go on D: |

### The Oracle database — could not be inspected

The brief said "do not guess about the Oracle database". I could not inspect it, and
I will not pretend otherwise. Searched and found **nothing**:

- no `tnsnames.ora`, `sqlnet.ora`, `cwallet.sso`, `ewallet.p12`, or `Wallet_*.zip` anywhere on C: or D:
- no `ORACLE_*` / `TNS_ADMIN` environment variables
- no Oracle client, `sqlplus`, or SQLcl on PATH
- `oci` CLI **is** installed (3.90.1) but has **no config file** at `~/.oci/config`

So the cloud instance exists only as a claim. A previous project in this workspace
recorded the same tenancy failing for weeks to obtain **Ampere A1 compute capacity**.
Note that A1 *compute* scarcity does not affect *Autonomous Database*, which is a
separate Always Free allocation, so an unused ADB is entirely plausible.

**Decision: local-first.** Develop against a real Oracle in Docker; point production
at the cloud instance when a wallet is supplied. Nothing is blocked today, and no
credential ever enters the repo.

### Verified locally

```
Oracle AI Database 26ai Free Release 23.26.3.0.0   (gvenzl/oracle-free:23-slim)
node-oracledb 7.0.1, thin mode = true              (no Instant Client required)
```

Container needs `--shm-size=2g`; with Docker's default 64 MB `/dev/shm` the SGA
cannot allocate and the container dies with exit 255. This is captured in
`docker-compose.yml` so nobody rediscovers it.

Three schema mechanisms were **proved against the real database** before being
designed in:

1. **One accepted application per posting** — a partial unique index,
   `ON applications (CASE WHEN status='accepted' THEN posting_id END)`. Oracle skips
   all-NULL keys, so unlimited `pending` rows coexist while a second `accepted`
   fails with ORA-00001. Verified.
2. **Never bid below the minimum** — proved this needs no trigger. Copying the
   posting's minimum onto the application row at apply time turns a cross-row rule
   into a declarative `CHECK (proposed_price >= min_price_at_apply)`, which failed
   correctly with ORA-02290. It is also the more correct business model: it records
   the minimum the artist actually agreed to, so later edits cannot retroactively
   invalidate a bid.
3. **UUID primary keys** as `RAW(16)`.

### Free-tier constraints that changed the architecture

Researched against current (Sept 2026) official docs. Two findings overruled the
obvious choices:

- **GitHub Pages forbids commercial sites** in its ToS, and **Vercel Hobby is
  non-commercial only**. A marketplace is commercial, so both are disqualified for
  the frontend regardless of technical fit. The brief's warning not to assume
  GitHub Pages can host the app turns out to be right for a licensing reason, not
  just a technical one. → **Cloudflare Pages** (unlimited bandwidth, commercial use
  permitted, no card).
- **Serverless/edge cannot run `oracledb`.** Thick mode needs a native Instant
  Client; thin mode needs long-lived `node:net`/`node:tls` sockets with custom PEM
  wallet material, and Cloudflare Workers supports `node:tls` only partially while
  Vercel/Netlify functions are per-invocation. → the API must be a **long-running
  container**: Render free (512 MB, no card, sleeps after 15 min).

| Hazard | Reality | Mitigation |
|---|---|---|
| Oracle ADB auto-stops | after **7 days** idle | GitHub Actions weekly keep-alive |
| Oracle ADB **deleted** | after **90** cumulative idle days | same cron; documented loudly |
| Render free sleeps | 15 min idle, 30–60 s cold start | documented; same cron warms it |
| OCI Object Storage | **50 000 requests/month** (~1 600/day) | thumbnails; ImageKit default |

---

## 2. Stack

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| Repo | pnpm workspaces | No Turborepo/Nx — unnecessary for 3 packages |
| API | Node 24 + TypeScript + **Fastify** + **Zod** | Fastify's schema hooks make validation structural, not optional. Light enough for 512 MB |
| DB access | **`oracledb` 7 thin + raw SQL** | **Prisma and Drizzle do not support Oracle at all.** Only TypeORM does, and its Oracle migrations are weakly trodden. Raw parameterized SQL gives exact control over the CHECK constraints and partial indexes this domain depends on |
| Migrations | ~80-line runner, numbered `.sql` | Flyway/Liquibase need Java, which is absent |
| Web | React 19 + Vite + **Tailwind v4** + React Router + TanStack Query | TanStack Query gives the loading/empty/error states the brief demands, for free |
| Auth | JWT access + rotating refresh, httpOnly cookies, **`crypto.scrypt`** | scrypt is in Node core: no `node-gyp`, no native build on Render, no supply chain. OWASP-acceptable. argon2 would add a native dep for marginal gain |
| Images | `ObjectStorage` port; `local` (dev) + `imagekit` (prod) | Render's disk is ephemeral, so local cannot be production |
| Desktop | **Tauri v2**, built in GitHub Actions | ~5 MB installers vs Electron's ~150 MB, and CI builds mean the user needs no Rust locally |
| Tests | **Vitest** (real Oracle, no mocks) + **Playwright** | |

### Deliberate non-goals

No payments, no chat, no recommendation engine, no push/SMS/email, no app stores.
Reviews are immutable by design. Notifications are in-app rows only.

---

## 3. Data model

17 tables. The brief listed candidate tables and said not to create them blindly —
two were deliberately **not** built:

- **No `client_profiles`.** Clients need no field an artist does not also need.
  Shared profile fields live on `users`; only artist-specific data gets a side table.
  An empty 1:1 table is cost without benefit.
- **`portfolio_items` and `artist_posts` are one table.** For this MVP they are the
  same entity viewed two ways: on a profile it is a portfolio, in the feed it is a
  post. One table, two queries.

Rating averages are **not** denormalised onto the artist. At MVP scale an indexed
aggregate is cheap and cannot drift out of sync. Noted as a scaling lever, not taken.

```
users ─┬─ artist_profiles (1:1, artists only)
       ├─ artist_categories (M:N craft_categories)
       ├─ artist_skills           free-text tags ("amigurumi")
       ├─ external_links          FB / IG / TikTok, https-only
       ├─ postings ──┬─ posting_images
       │             └─ applications ─── application_samples ──> artist_posts
       ├─ artist_posts ─── artist_post_images
       ├─ commissions ─── reviews
       ├─ reports, notifications, refresh_tokens
       └─ craft_categories (seeded), schema_migrations
```

**Money is integer centavos in `NUMBER(12)`.** No floating point touches a peso.

**Identifiers** are app-generated **UUIDv7** stored as `RAW(16)`: non-enumerable in
URLs, and time-ordered so the B-tree does not fragment the way random UUIDv4 does.

### Integrity enforced by the database, not just code

| Rule | Mechanism |
|---|---|
| One application per artist per posting | `UNIQUE (posting_id, artist_id)` |
| One accepted application per posting | partial unique index (proved above) |
| Bid never below minimum | `CHECK (proposed_price >= min_price_at_apply)` (proved above) |
| One review per person per commission | `UNIQUE (commission_id, reviewer_id)` |
| One commission per posting | `UNIQUE (posting_id)`, `UNIQUE (application_id)` |
| Rating is 1–5 | `CHECK` |
| Every status column | `CHECK (... IN (...))` — no contradictory states |

Application-layer rules on top: a posting only accepts applications while `open`;
only the owner mutates a posting; only a completed commission's two participants
may review; the posting minimum is editable only while it has zero applications.

---

## 4. Security

The backend is the security boundary; frontend route guards are cosmetic.

- Every mutation re-checks ownership server-side from the JWT subject. IDs in the
  request body are never trusted to imply permission.
- Role checks are enforced server-side: only `client` posts, only `artist` applies.
- Passwords: `scrypt`, per-user random salt, `timingSafeEqual` comparison. Never logged.
- Refresh tokens stored **hashed**, rotated on use, revocable.
- Uploads: **magic-byte sniffing, not the client's Content-Type**; size and dimension
  caps; re-encoded through `sharp`, which strips EXIF (including GPS) as a side effect;
  server-generated filenames so a user cannot pick the storage key.
- Rate limits on login, registration, and application submission.
- External links forced to `https`, rendered `rel="noopener noreferrer nofollow"`.
- Secrets only from env. `.env` is gitignored, `.env.example` is committed.

**Privacy:** exact addresses are never collected — region plus city only. Email is
never exposed on a public profile.

---

## 5. Deployment

| Piece | Host | Genuinely free? |
|---|---|---|
| Web | Cloudflare Pages | Yes. Unlimited bandwidth, commercial use OK, no card |
| API | Render free web service | Yes, no card. **Sleeps at 15 min; 30–60 s cold start** |
| DB | Oracle Always Free ADB | Yes. **Stops at 7 idle days, deleted at 90** |
| Images | ImageKit (20 GB/mo, no card) | Yes. OCI Object Storage is a documented alternative, capped at 50k requests/month |
| Desktop builds | GitHub Actions → Releases | Yes, unlimited for public repos |

Honest limitations, documented rather than hidden: the free API sleeps, so the first
request after idle is slow; the ADB will be **permanently deleted** after 90 idle
days if the keep-alive is not running.

## 6. Downloadable app

Tauri v2 wraps the same Vite build — no second codebase. GitHub Actions cross-builds
Windows `.msi`, macOS `.dmg`, and Linux `.AppImage` on tag push and attaches them to
a Release. The web app also ships a PWA manifest, so it is installable from the
browser at zero extra cost.

## 7. Testing

Critical workflows, not smoke tests. Integration tests run against the **real
Dockerized Oracle** — never a mock — because the constraints above are the product.

- **Auth:** both registrations, login, logout, bad credentials, role boundaries.
- **Client:** create/edit/cancel posting, upload images, review and select an artist.
- **Artist:** browse, apply, **rejected below minimum**, **rejected duplicate apply**,
  blocked from applying to a non-open posting, edit profile, create posts.
- **Commission/review:** legal transitions, review only after completion, reviews by
  non-participants rejected, no double review.
- **Authorization:** hit the API directly attempting to mutate another user's posting,
  application, and commission by ID. These must fail with 403/404.
- **UI (Playwright):** desktop + mobile viewports, loading/empty/error states, form
  validation, upload behaviour.

## 8. Build order

1. Repo skeleton, docker-compose, migration runner, CI
2. Schema + seeds
3. Auth + users
4. Profiles (artist/client) + external links
5. Postings + image upload pipeline
6. Discovery/browse/filter
7. Applications + selection + commissions
8. Artist posts / portfolio
9. Reviews
10. Safety hooks (reports, notifications, rate limits)
11. Frontend design system + pages
12. Tauri packaging + release workflow
13. Verification pass, docs

---

## 9. Open risk

The production database is unverified. Everything is built and tested against
Oracle 26ai Free, which is the same SQL dialect as Autonomous Database, so the
schema is expected to apply unchanged — but until a wallet exists this is a
reasoned expectation, not a verified fact, and the final report will say so.
