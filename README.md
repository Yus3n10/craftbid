# RaxTan

A marketplace where people commission handmade work from Filipino craft
artists, and artists bid for it.

A client posts what they want made with a starting budget in pesos. Artists in
that craft browse the request, bid at or above the budget with a message and
work samples, and the client compares them and picks one. The agreed work
becomes a commission, and a finished commission lets both sides leave a review
that neither can later edit away.

Crochet, knitting, embroidery, stitch art, weaving, pottery, painting,
sculpture, jewelry, woodcraft, paper craft, candles and soap.

---

## Quick start

**You need:** Node 22+, [pnpm](https://pnpm.io) 10+, and Docker.

```bash
git clone <your-fork-url> raxtan && cd raxtan
pnpm install
cp .env.example .env
```

Generate a JWT secret and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Start Oracle, apply the schema, and load demo data:

```bash
pnpm db:up
pnpm db:migrate
pnpm --filter @raxtan/api seed
```

Oracle takes about 50 seconds to come up the first time. Then:

```bash
pnpm dev
```

The web app is at http://localhost:5173 and the API at http://localhost:4000.

The seed creates six people. Sign in as any of them with the password
`raxtan demo password`:

| Email | Role |
|---|---|
| `maria_santos@example.com` | client, has open requests and a completed commission |
| `paolo_cruz@example.com` | client |
| `ana_weaves@example.com` | artist, weaving, has reviews |
| `malou_hooks@example.com` | artist, crochet |
| `kirby_clay@example.com` | artist, pottery |
| `rosa_stitch@example.com` | artist, embroidery |

The images in the seed are generated woven patterns, not photographs. This
repository ships no pictures of anyone's real work.

---

## How it is put together

| Layer | Choice | Why |
|---|---|---|
| API | Node + TypeScript + Fastify + Zod | Fastify's schema hooks make validation structural rather than something a route can forget |
| Database | **Oracle**, via `oracledb` in Thin mode | Thin mode needs no Oracle Instant Client, which is what makes deploying to a plain free container possible |
| Data access | Raw parameterised SQL | **Neither Prisma nor Drizzle supports Oracle.** Only TypeORM does, and its Oracle migrations are thinly trodden. Raw SQL also gives exact control over the constraints this domain depends on |
| Migrations | ~150-line runner, numbered `.sql` | Flyway and Liquibase both need a JVM |
| Web | React 19 + Vite + Tailwind v4 + TanStack Query | |
| Auth | Short JWT access token, rotating opaque refresh token | |
| Desktop | Tauri v2, built in CI | ~5MB installers against Electron's ~150MB, and nobody needs Rust locally |

### Layout

```
apps/api        Fastify API, Oracle access, migrations, seed
apps/web        React client, design system, Playwright tests
packages/shared Domain constants and Zod schemas used by both
src-tauri       Desktop shell (wraps the same web build)
docs/           Design record and the deployment runbook
```

`packages/shared` holds every validation rule, so the client and the server
cannot drift apart about what a valid bid looks like.

### The rules live in the database

The marketplace's core rules are constraints, not service code, so no future
code path can forget them:

| Rule | How |
|---|---|
| One bid per artist per request | `UNIQUE (posting_id, artist_id)` |
| At most one accepted bid per request | a partial unique index; Oracle omits all-NULL keys, so only accepted rows occupy it |
| A bid never undercuts the minimum | the posting's minimum is copied onto the bid, making it a plain `CHECK` |
| One review per person per commission | `UNIQUE (commission_id, reviewer_id)` |
| One commission per request | `UNIQUE (posting_id)` and `UNIQUE (application_id)` |

Copying the minimum onto the bid is also the more honest model: it records the
figure the artist actually agreed to, so a later edit cannot retroactively
invalidate a bid that was fair when it was made.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API and web together |
| `pnpm db:up` / `pnpm db:down` | Start or stop the Oracle container |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:reset` | **Drop every table** and re-apply (local only; refuses if a wallet is configured) |
| `pnpm --filter @raxtan/api seed` | Load demo data |
| `pnpm test` | API integration tests |
| `pnpm test:e2e` | Playwright, desktop and mobile viewports |
| `pnpm typecheck` | Every package |
| `pnpm build` | Production build |
| `pnpm desktop:build` | Desktop installers (needs Rust) |

### One gotcha worth knowing

**Running the API tests empties your development database.** They reset the
tables between cases so each starts from a known state. After a test run,
re-seed:

```bash
pnpm db:reset && pnpm --filter @raxtan/api seed
```

---

## Database

Development runs Oracle Database Free in Docker. It is the same SQL dialect as
Autonomous Database, so the schema applies unchanged to the cloud instance.

The container needs `--shm-size=2g`. With Docker's default 64MB `/dev/shm` the
SGA cannot allocate and the container dies during listener startup with exit
255. `docker-compose.yml` already sets it.

The schema deliberately avoids 23ai-only syntax. No native `BOOLEAN` and no
`CREATE TABLE IF NOT EXISTS`, because Always Free Autonomous Database can be
provisioned as 19c and the production version is not known in advance.
`VARCHAR2` lengths are declared in `CHAR`, not the default `BYTE`, so a name
with an enye or an emoji is not truncated.

To point at Autonomous Database, see [docs/DEPLOY.md](docs/DEPLOY.md). In
short: download the wallet, unzip it **outside this repository**, and set
`ORACLE_WALLET_DIR`. Thin mode needs the PEM wallet (`ewallet.pem`), not
`cwallet.sso`.

---

## Testing

Integration tests run against the **real Oracle in Docker, never a mock**. The
constraints above exist only in the database, so a mocked repository would
prove nothing about the behaviour that matters.

```bash
pnpm db:up          # Oracle must be running
pnpm test           # 51 API integration tests
pnpm test:e2e       # 10 browser tests, desktop and mobile
```

The API suite covers both registrations, token rotation and replay, bidding
below the minimum, duplicate bids, bidding on a closed request, a second
acceptance on the same request, review eligibility, and direct attempts to
mutate another user's postings, applications, commissions and posts. The rate
limiter has its own file, since the rest of the suite runs with limits off.

---

## Security

The backend is the security boundary. The frontend's route guards are a
convenience for the user; every protected route is enforced again on the
server, which re-derives identity from the token and re-checks ownership
against the database.

- Passwords use **scrypt** from Node's standard library. Every argon2 binding
  is a native module, and the deploy target is a 512MB free container with no
  compiler. Cost is tuned to 32MB per hash so concurrent logins cannot exhaust
  that container.
- A failed login for an unknown address still pays the hashing cost, otherwise
  response latency turns login into an account-enumeration oracle.
- Refresh tokens are stored only as SHA-256 hashes and rotate on every use.
- Requests for another user's resource return **404, not 403**, so the API
  cannot be used to probe which ids are real.
- Uploads are validated by **sniffing magic bytes, never the declared
  `Content-Type`**, then re-encoded through sharp. That normalises the format,
  drops EXIF including GPS, and rejects files that merely claim to be images.
  Storage keys are generated server-side, so no client-supplied filename ever
  reaches a storage path.
- External links are forced to `https` in both the schema and a database
  `CHECK`, and rendered `rel="noopener noreferrer nofollow"`.
- Location is collected as region and city only. Never a street address.
- Email appears on the authenticated `/auth/me` response and nowhere else.

Secrets come only from the environment. `.env` is gitignored and CI fails the
build if a `.env`, wallet or PEM file is ever tracked.

---

## Deployment

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the full runbook. The design
record, including why each piece was chosen, is in
**[docs/DESIGN.md](docs/DESIGN.md)**.

The short version, all on genuinely free tiers with no credit card:

| Piece | Host |
|---|---|
| Web | Cloudflare Pages |
| API | Render free web service |
| Database | Oracle Always Free Autonomous Database |
| Images | ImageKit |
| Desktop builds | GitHub Actions to GitHub Releases |

GitHub Pages and Vercel Hobby are **not** options here: both prohibit
commercial sites in their terms, and a marketplace is commercial.

---

## Known limitations

These are real and deliberate, not oversights.

- **The desktop build has never been compiled.** There is no Rust toolchain or
  MSVC on the development machine, so the installers will be produced for the
  first time by CI on a tag push. The configuration parses and resolves its
  plugin (`pnpm tauri info`), and the web build it wraps is verified, but the
  Rust build itself is unproven. Its external-link behaviour is likewise
  unverified.
- **The production database is unverified.** Everything is built and tested
  against Oracle Free, which shares the dialect, but no Autonomous Database
  wallet was available.
- **The free API sleeps.** Render spins a free service down after 15 minutes,
  so the first request after a quiet spell takes 30 to 60 seconds.
- **Always Free Autonomous Database is deleted after 90 idle days**, and stops
  after 7. The scheduled keep-alive workflow exists for exactly this, and it
  needs the `API_URL` repository variable set to work.
- **No payments.** The agreed price is information between the two parties.
  The commission record is shaped so a payment system can attach to it later
  without reshaping the marketplace.
- **No email or SMS.** Notifications are in-app rows only. Both cost money at
  volume.
- **Search is a substring match**, which cannot use an index. Fine at this
  scale; Oracle Text would be the upgrade.
- Reviews cannot be edited or deleted. That is the design, not a gap.
