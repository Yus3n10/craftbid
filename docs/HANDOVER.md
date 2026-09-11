# Craftbid — handover

Everything a person needs to pick this up cold: what it is, where things live,
what broke and why, and what is still unfinished.

For running it locally read [README.md](../README.md). For deploying it read
[DEPLOY.md](DEPLOY.md). For why the architecture is what it is read
[DESIGN.md](DESIGN.md). This file is the story of how it got here.

---

## 1. What it is

A marketplace where people commission handmade work from Filipino craft
artists, and artists bid for it.

A client posts a craft request with a starting budget in pesos and reference
photos. Artists in that craft browse it, bid at or above the budget with a
message and work samples, and the client compares them and picks one. That
opens a commission; a finished commission lets both sides review each other.
Artists also keep a public portfolio, and the home page is a feed of that work
with reactions, comments and saves.

**The one rule that shapes everything else:** bidding is private. An artist
never sees another artist's bid or price. That is why the social layer attaches
to portfolio posts and never to craft requests, and why there is a test that
fails if anyone adds public commentary to a request.

| | |
|---|---|
| Live site | https://craftbid.pgeagoni.workers.dev |
| API | https://craftbid-api.onrender.com |
| Repository | https://github.com/Yus3n10/craftbid |
| Local path | `D:\Claude Local\raxtan` (folder name is still the old one) |

Demo accounts, both password `craftbiddemo2026`:
`maya_delacruz@craftbid.example` (client), `nena_hooks@craftbid.example` (artist).

---

## 2. Where things live

```
apps/api                 Fastify API, Oracle access, migrations, seed
  src/db/migrations/     Numbered .sql, applied by a ~150-line runner
  src/modules/           One folder per domain: routes, service, repository
  src/lib/storage/       ObjectStorage port: local driver and ImageKit driver
  src/test/              Integration tests against real Oracle
apps/web                 React client
  src/components/        Feed, cards, lightbox, search, reaction bar
  src/components/ui/     Design system primitives, icons, brand logos
  src/pages/             One per route, all lazily loaded
  worker/keepalive.ts    Cloudflare cron that keeps the API awake
packages/shared          Zod schemas, constants and DTO types used by both
src-tauri                Desktop shell wrapping the same web build
docs/                    This file, DEPLOY.md, DESIGN.md
```

`packages/shared` holds every validation rule, so the client and server cannot
disagree about what a valid bid looks like.

### The layering, and why it is worth keeping

`routes → service → repository`. Routes validate and authorise, services hold
the rules, repositories are the only place SQL exists. Adding a feature means
touching three files in that order, and it is worth resisting the urge to
shortcut it: the reason authorisation has never leaked is that no route can
reach the database without passing through a service that re-checks ownership.

---

## 3. The stack, and the constraints that forced it

Budget was zero. Three findings decided the architecture, and each is worth
knowing before proposing a change.

**Neither Prisma nor Drizzle supports Oracle.** Only TypeORM does, and its
Oracle migrations are thinly trodden. So: raw parameterised SQL over `oracledb`
in Thin mode, plus a small migration runner. Flyway and Liquibase both need a
JVM.

**Serverless cannot run the Oracle driver.** Thick mode needs a native Instant
Client; Thin mode needs full `node:net` and `node:tls` with custom PEM wallet
material. The API has to be a long-running container, which is why it is on
Render and not on an edge platform.

**GitHub Pages and Vercel Hobby prohibit commercial sites** in their terms. A
marketplace is commercial. That is a licensing constraint, not a technical one,
and it is why the web app is on Cloudflare.

| Piece | Where | The catch |
|---|---|---|
| Web | Cloudflare Workers (static assets, plus `/api` forwarded to Render) | `/api/*` calls count toward the Workers request allowance |
| API | Render free web service | **Stops after 15 idle minutes** |
| Database | Oracle Always Free ADB, 19c, Singapore | **Stops after 7 idle days, deleted after 90** |
| Images | ImageKit | 20GB/month bandwidth |
| Desktop | GitHub Actions → Releases | Unsigned builds |

### The rules live in the database

Constraints, not service code, so no future code path can forget them:

| Rule | Mechanism |
|---|---|
| One bid per artist per request | `UNIQUE (posting_id, artist_id)` |
| At most one accepted bid per request | partial unique index; Oracle omits all-NULL keys |
| A bid never undercuts the minimum | the minimum is copied onto the bid, making it a plain `CHECK` |
| One review per person per commission | `UNIQUE (commission_id, reviewer_id)` |
| One reaction per person per post | `PRIMARY KEY (post_id, user_id)` |

Copying the minimum onto the bid is also the more honest model: it records the
figure the artist actually agreed to, so a later edit cannot retroactively
invalidate a bid that was fair when it was made.

---

## 4. Bugs, in the order they were found

Every one of these was found by running the thing, not by reading it. That is
the main lesson in this file.

### 4.1 Sign-out left the user signed in

**Symptom.** Clicking Sign out reloaded the page and nothing changed.

**Cause.** `clearSession` in `apps/api/src/modules/auth/auth.routes.ts` passed
only `{ path: "/" }`. A browser overwrites a cookie only when the incoming
`Set-Cookie` matches on name, path **and** SameSite. Because the cookies are
`SameSite=None; Secure` in production, the browser either saw a different
cookie or rejected the header outright, since `SameSite=None` without `Secure`
is invalid.

**Why it was invisible.** Logout returned `204` and the refresh token *was*
revoked. Only the access cookie survived:

```
logout   -> 204
refresh  -> 401   (revoked correctly)
/auth/me -> 200   (still signed in)
```

**Fix.** `clearCookieOptions()` in `apps/api/src/lib/tokens.ts` derives the
clearing attributes from `cookieOptions` so the two cannot drift apart again.

**Why no test caught it.** The existing logout test passed throughout. Fastify's
`inject` checks status codes and does not enforce browser cookie semantics. The
new test asserts every attribute present on login is present on logout, and was
verified by reverting the fix and watching it fail.

**This was a regression** from the cross-site session fix (4.2). With the old
`Lax` cookies, clearing by path happened to match.

### 4.2 Sign-in worked, then every following request was 401

**Cause.** The web app and the API are on different registrable domains, so
every API call is cross-site, and a `SameSite=Lax` cookie is never sent on one.
Login set the cookie and the next request did not carry it.

**Fix.** `SameSite=None; Secure` in production.

**The security consequence, handled.** That alone would let any site trigger a
state-changing request carrying the user's session. CORS is not the protection
people assume: it governs reading a response, not sending a request, and a
multipart upload is a "simple" request that is never preflighted, so `/images`
was genuinely exposed. `app.ts` now rejects any cookie-authenticated mutation
carrying a browser `Origin` that is not allowed. Requests bearing an
`Authorization` header are exempt, because a token has to be attached
deliberately by script, and the desktop build legitimately calls from
`tauri://localhost`.

### 4.3 Image uploads returned 500 in production

**Cause.** ImageKit answered `403 "Your account cannot be authenticated"`. The
private key was wrong.

**The real problem was that nothing could have caught it.** Every test seeded
image rows directly into the database, so `POST /images` had never run: not the
magic-byte sniffing, not sharp, not the storage driver. The endpoint was broken
in production while CI stayed green.

**Fix.** `apps/api/src/test/images.test.ts` drives the real endpoint, and the
fake storage now keeps what it is given so tests can assert on bytes. Config
also trims the keys and refuses to start if the private key does not begin with
`private_`, because a trailing newline from a paste breaks authentication on
its own.

### 4.4 The reference photo was cropped

**Cause.** The detail gallery forced `aspect-ratio: 3/2` with `object-cover`. An
upright photograph of a cardigan lost its hood and hem, which is the part the
client was pointing at.

**Fix.** Images keep their own proportions, capped by height. `ImageFrame`
defaults to `contain`. Real pixel dimensions are set on every `img` so the
browser reserves the box before the bytes arrive.

### 4.5 The site served a stale build

**Symptom.** The site looked broken after a deploy that had succeeded.

**Cause.** A service worker had cached the previous bundle, which pointed at
`localhost:4000`.

**Not a code bug.** `registerType: "autoUpdate"` is already correct and it
self-heals on the next navigation. Worth knowing permanently: **after a deploy,
hard-reload once** (`Ctrl+Shift+R`) if the site looks stale.

### 4.6 Deploy failures, four in a row

Each error message pointed somewhere other than its cause:

1. `corepack enable` → `EROFS` on `/usr/bin`, which is read-only on Render.
2. Redirecting corepack → `ENOENT`, because `--install-directory` does not
   create the directory.
3. `engines: ">=22"` let Render pick **Node 26** while tests run on 22, and both
   `sharp` and `oracledb` are native modules.
4. `wrangler deploy` refused to act in a pnpm workspace root without being told
   which project to deploy.

**Fixes.** `npm install -g pnpm` instead of corepack; `.node-version` pinning 22
plus an upper bound in `engines`; `apps/web/wrangler.jsonc` naming the project.

**The trap that cost the most time:** editing `render.yaml` does not change an
existing service. Render copies `buildCommand` into the service's own settings
at creation and re-reads the file only on an explicit Blueprint sync. A commit
fixing the build command is checked out and then ignored, and the log shows the
old command beside the new commit hash.

### 4.7 `_redirects` broke the Cloudflare deploy

`/* /index.html 200` is rejected by Workers as an infinite loop (API error
100324). It failed on the final API call, after all 53 assets had uploaded, and
`--dry-run` does not catch it because only the server validates that file.
`not_found_handling: "single-page-application"` covers the same need.

### 4.8 A deploy blanked the page for anyone already on the site

**Symptom.** After a while on the home page, clicking through to Craft requests
or another tab gave a white page. The URL had changed, so it read as the app
having stopped. Only a full refresh brought it back.

**Cause.** Three things lining up, none of them wrong on its own:

1. Every route is a dynamic import, and a deploy renames every chunk it
   rebuilds. A page open across a deploy still holds the old filenames.
2. Those files do not 404. `not_found_handling: "single-page-application"`
   answers any unknown path with index.html, so the browser is handed
   `text/html` where it asked for a module and refuses it on MIME grounds.
   Verified against production: a missing `/assets/*.js` returns **200
   text/html**.
3. **There was no error boundary anywhere in the app.** React unmounted the
   whole tree, leaving an empty `<div id="root">`.

The service worker made it a certainty rather than a race: `autoUpdate`
compiles to skipWaiting + clientsClaim + cleanupOutdatedCaches, so a new worker
activates under the open page and deletes the precache that page is relying on.

**Why a refresh was the only way out.** React caches a lazy component's
rejection. Navigating away and back replays the same failure, so nothing inside
the app could recover it. Confirmed by putting the chunk back on disk mid-session:
it fetched with a 200 and the tree stayed dead.

**Fix.** `apps/web/src/components/ErrorBoundary.tsx`. It recognises a
chunk-load failure and reloads once per minute per tab, which lands on the build
that actually has the files; index.html is `max-age=0, must-revalidate`, so a
plain reload is enough. Anything that survives the reload is not a stale build,
so it stops and offers a button instead of flashing forever. The boundary sits
inside `Shell`, so a screen that fails leaves the header and footer alone.

**Note on 4.5.** The stale-build advice there was "hard-reload once". That was
the right instinct and it is now automatic.

### 4.9 Skeletons that never resolved into anything

**Symptom.** A tab sometimes showed only skeleton loaders. They never became
content and never became an error. A refresh was the only way out.

**Cause.** `fetch` has no timeout. Render stops the free service after fifteen
idle minutes, and a request into that gap can be accepted and never answered.
A pending promise is a query stuck in `isLoading`, which is a skeleton for as
long as the tab is open. Measured by hanging the API on the live site: after 12
seconds, still 8 skeletons, no error, no retry.

**Fix.** A 20s deadline per attempt in `apps/web/src/lib/api.ts`, raised as a
`TimeoutError` carrying status 408. 20s rather than something tighter because a
cold start legitimately takes 30-60s; the retry predicate in `main.tsx` now
exempts 408 so React Query's two retries give a genuinely waking service three
attempts. `ErrorState` names the cause, since "still waking up" tells the reader
that trying again will work.

### 4.10 The platform dropdown covered the whole contact-links row

**Symptom.** On the settings form, the platform select under "Where else to
find you" stretched the full width of the card and pushed the address field and
its Remove button off the edge. The link could not be typed.

**Cause.** `cx` joins class names, it does not merge them. `<Select
className="w-36 shrink-0">` emitted **both** `w-full` (from `CONTROL`) and
`w-36`, and Tailwind's own source order decides which wins. It emits `w-full`
last, so the caller lost silently. With `shrink-0` on the select and
`sm:flex-nowrap` on the row, nothing could give way. Measured in a 600px row:
the select computed to **600px** and the address field to **26px**.

**Fix.** `CONTROL` no longer carries a width; `control()` in `Field.tsx` adds
`w-full` only when the caller has not supplied a width of their own, so one
width rule is ever in play. The address field now takes `min-w-0 flex-1
basis-64` so it is the part that gives way, and wraps instead of overflowing on
a narrow screen. This was a footgun for every caller, not just this one.

### 4.11 Signed in on an iPhone, then "You need to sign in to do that"

**Symptom.** A new user signed in on a phone, opened "My bids", and got
*"This did not load. You need to sign in to do that."* Separately, the client
had to sign in again every time he reopened Craftbid from Messenger.

**Cause.** Two faults that hid each other.

1. The web app is on `craftbid.pgeagoni.workers.dev` and the API on
   `craftbid-api.onrender.com`, so the session cookies the API set were
   **third-party cookies**. WebKit blocks those by default, and WebKit is every
   browser on an iPhone, Messenger's in-app browser included. Measured against
   production on an iPhone WebKit profile: login `200`, zero cookies stored for
   the API, then `/auth/me 401` and `/auth/refresh 401`.
2. The frontend took the signed-in user from the **login response body**. That
   response arrives whether or not the browser keeps the cookies that came with
   it, so the header and menu showed a signed-in user while the browser held no
   session. The first page that needed one answered 401.

The same fault explains the Messenger complaint: there was never a stored
session to keep. A "Keep me logged in" checkbox alone would have changed
nothing on an iPhone.

**Why it was invisible.** Chrome on desktop and Android still accepts
third-party cookies, and every test ran on Chromium against `localhost`, where
the web app and API are the same site. The handover's own 4.2 fix
(`SameSite=None`) was correct for Chrome and made no difference to WebKit.

**Fix.** The API is now served at `/api` on the site's own origin by the
existing Worker (`apps/web/worker/api-proxy.ts`), which makes the cookies
first-party. Nothing about the API or its cookies changed. The frontend now
confirms the session with `/auth/me` after signing in, and a 401 there
becomes a clear message instead of a false signed-in state.

**Verified** on WebKit (iPhone 13 profile) through the real Worker under
`wrangler dev` against the real API: a new account's cookies are stored
first-party and "My bids" opens.

**Things to keep.** `run_worker_first: ["/api/*"]` in `wrangler.jsonc`, and the
Worker assigning the upstream path rather than resolving it (a path like
`/api//attacker.example` would otherwise swap the host and make it an open
proxy; there is a test for that).

### 4.12 The phone header covered most of the screen

**Symptom.** On a phone the header "did not disappear when scrolling" and
could cover about 80% of the screen; on the sign-in pages it floated over the
form.

**Cause.** The mobile menu opened *inside* a `sticky` header: search, every
destination and four buttons, pinned to the top. "Your profile",
"Notifications" and "Post a request" navigated without closing it, so the
next page opened already buried under it. Separately, the full navigation
switched on at 768px but, signed in as a client, ran to 904px: tablets
scrolled sideways and search was squeezed to 50px. Measured, not estimated.

**Fix.** The menu closes on any navigation, on Escape and on an outside tap,
and is capped at the screen height. Search moved out of the menu into its own
button. Below 1024px the bar slides away while reading down and returns on
the first scroll up. The full navigation now starts at 1024px, with inline
search from 1280px. Sign-in and account pages have an unpinned header.

Following a link also used to keep the previous page's scroll offset, so the
next page opened partway down, and with the sliding bar it could open with no
header in view. New pages now start at the top (`Shell.tsx`); back and forward
are left to the browser.

### 4.13 Smaller ones

- **Sign-in dropped users on the home page.** Both auth pages redirected an
  already-authenticated visitor to `/` *and* navigated imperatively after the
  mutation. The guard re-rendered the moment the session landed and won the
  race. The guard is now the only thing that decides the destination.
- **Submitting a bid showed no confirmation.** The success card lived inside the
  form, and the refetch that followed flipped `canApply` false and unmounted
  the form with it. The confirmation moved to the parent.
- **A bodyless `POST` returned 400.** A bare `.optional()` on the body schema is
  not enough; Fastify hands the validator an absent body. Fixed with
  `z.preprocess`. This broke twice in different ways, so it has its own test.
- **The Linux desktop build failed.** The apt list named both
  `libappindicator3-dev` and its ayatana replacement, which conflict.
- **A corrupt SVG path** (`2.ggb` in the Pinterest logo) rendered nothing.
  There is now a check that every path contains only valid path-data characters.

---

## 5. What was built, in order

29 commits. `git log --oneline --reverse` reads as a build order.

**Foundation** — workspace, Oracle schema, migration runner, then auth,
profiles and image uploads, then the marketplace core, then the web client and
its design system.

**Getting it live** — desktop build, CI against a real Oracle service
container, the deployment fixes above, and the rename from RaxTan to Craftbid
(done before any external service existed, because the name reaches into the
Oracle database name, the Render service and the Cloudflare project).

**Polish** — SVG star ratings replacing `★`/`☆` glyphs, a motion system, route
code-splitting (entry bundle 734KB → 576KB), the uncropped images.

**The social layer** — reactions, comments, saves, search, the feed home page,
notifications, and contact links with platform logos.

### Design decisions worth not reversing by accident

- **Three reactions, drawn not typed.** A sampaguita for love, a handshake for
  support, a thumb for a nod. A heart on a marketplace reads as romance or as a
  bookmark; a flower reads as "this is beautiful", which is what people mean
  about a finished piece. Emoji are font-dependent glyphs that cannot take a
  stroke or a colour token, and a screen reader reads `★★★` as "black star
  black star black star".
- **A reaction is one row per person per post.** Reacting again replaces rather
  than stacks, so a count is a count of *people*.
- **Reaction notices are deduplicated per actor while unread**, so cycling
  through reactions leaves one notice. Comments each get their own, because two
  comments are two things somebody said. Already-read notices are never
  replaced: rewriting history under someone is worse than a duplicate.
- **Comments can be deleted by their author or by the artist whose post it is.**
  There is no moderator, so the person whose portfolio it is must be able to
  clear abuse themselves.
- **Contact links derive their platform from the URL.** Nobody should categorise
  their own Instagram profile before pasting it. Getting it wrong is only a
  wrong logo, never a wrong destination.
- **Logos are monochrome.** Official brand colours would put a row of clashing
  palettes across a profile and drag in trademark rules about exact
  reproduction.
- **"Keep me logged in" is off by default.** On a borrowed or shared phone the
  safe outcome has to be the one that happens when nobody reads the box.
  Unticked, both cookies are session cookies and the server forgets the
  session after 12 idle hours; ticked, 30 days. The choice is stored on the
  refresh token (`refresh_tokens.persistent`) and inherited on every rotation,
  so a refresh can never turn a short session into a long one. The desktop
  build always remembers and does not show the box.
- **Requests are in the feed sidebar, not the stream.** Mixing them in would
  invite people to react to a request the way they react to a photograph.

---

## 6. Performance

Measured on the live site rather than guessed:

| | |
|---|---|
| Static assets | all cached, 3–7ms |
| API warm | 100–380ms |
| DOM ready | 21ms |

Render stopping the service after 15 idle minutes is still the worst of it, at
30–60 seconds, and it lands on first-time visitors. Three other things were
worth fixing:

**The entry bundle was 607KB, 173KB gzipped.** Route splitting had already
happened, but the route chunks are 3–22KB each and everything else was in the
entry, so a deploy made a returning reader re-download all of it to get the
~30KB that had actually changed. React, the router and the query client now
build as a separate `vendor` chunk: entry **131KB / 29KB gzipped**, vendor
480KB / 146KB, and the vendor hash does not move when application code does.

**Every signed-out visitor paid a doomed `/auth/refresh`.** The cookies are
httpOnly, so a 401 on the first `/auth/me` was indistinguishable from an
expired access token and the client answered it by attempting a refresh that
could not succeed. Measured on the live site: a whole extra round trip, 208ms,
before the app could decide to render the signed-out header. A flag written on
sign-in and cleared on sign-out (`mayHaveSession` in `session.ts`) settles it.

**Nothing was actually slow about navigation.** Measured frame by frame it is
~90-140ms with no blank frame and no skeleton, because React holds the current
page through the transition. Worth knowing before moving that Suspense
boundary: it is above the router *because* it already holds mounted content
there. Nested inside `Shell` beside the error boundary, or keyed by pathname, it
becomes a boundary with nothing to hold and every navigation flashes a skeleton
over a page that was fine. Both were tried and measured; see the comment in
`Shell.tsx`.

What the reports of slowness actually were is 4.8 and 4.9 above.

`apps/web/worker/keepalive.ts` is a Cloudflare cron trigger pinging `/health`
every ten minutes. It lives beside the static assets so it ships with the site;
assets are still matched before the script, and its `fetch` handler hands
anything reaching it back to the asset server.

Cache headers are in `app.ts`, and the per-user case is handled first because
getting it wrong is a leak rather than a slowdown: a feed carries
`reactions.mine` and `saved`, so a shared cache holding one would hand another
person's bookmarks to the next visitor. Authenticated reads are
`private, no-store`. Anonymous reads get 30s with 5 minutes of
stale-while-revalidate; categories an hour; uploaded bytes a year.

---

## 7. Testing

```bash
pnpm db:up          # Oracle must be running
pnpm test           # 91 API integration tests
pnpm test:e2e       # 10 browser tests, desktop and mobile
pnpm test:resilience  # 3 browser tests, no database or API needed
```

Integration tests run against **real Oracle in Docker, never a mock**. The
constraints above exist only in the database, so a mocked repository would
prove nothing.

**Running the API tests empties your development database.** Re-seed after:

```bash
pnpm db:reset && pnpm --filter @craftbid/api seed
```

`test:resilience` is separate because it needs neither: it runs against a
production build served by `vite preview` with every API call intercepted, so it
runs from a checkout with nothing else started. It covers the two failures in
4.8 and 4.9, which the marketplace suite structurally cannot reach because that
suite drives a healthy build against a healthy API. It runs with
`serviceWorkers: "block"`, both because a chunk the precache no longer holds is
the state being tested and because `page.route` cannot see a request a service
worker answers, so with one registered the interception silently does nothing
and the tests pass having tested nothing. Each of the three was checked by
reverting its fix and watching it fail.

Coverage worth knowing about: authorisation boundaries attacked directly at the
API; the bid minimum and duplicate-bid constraints; upload validation including
a decompression bomb, an SVG carrying a script and a GIF/HTML polyglot; CSRF
including the multipart case CORS never preflights; cache headers never storing
per-user state; and a test asserting the social endpoints **do not exist** for
craft requests.

---

## 8. Security posture

Audited with live probes against production. No critical or high findings.

- **SQL injection.** Three interpolation sites exist and all are safe: two push
  hardcoded literals into a `SET` clause with every value bound; the third reads
  table names from Oracle's own metadata behind a cloud-database guard. Six live
  payloads including `'; DROP TABLE users--` were treated as literal text.
- **Passwords** use scrypt from Node's standard library. Every argon2 binding is
  a native module and the deploy target is a 512MB container with no compiler.
- **A failed login for an unknown address still pays the hashing cost**, or
  response latency turns login into an account-enumeration oracle.
- **Requests for another user's resource return 404, not 403**, so the API
  cannot be used to probe which ids are real.
- **Uploads are validated by sniffing magic bytes, never the declared
  `Content-Type`**, then re-encoded through sharp, which drops EXIF including
  GPS. Storage keys are generated server-side.
- **Contact links accept exactly two schemes**, https and mailto, enforced by a
  database `CHECK` as well as a schema. A `javascript:` link rendered on a
  profile is stored XSS.
- **Brute force**: 30 rapid failed logins → 9 allowed, 21 throttled.
- Cloudflare's WAF also blocks classic SQLi patterns at the edge before they
  reach the app. Free defence in depth nobody configured.

Secrets come only from the environment. CI fails the build if a `.env`, wallet
or PEM file is ever tracked.

---

## 9. Operational notes

**Migrations are not applied by deploying.** Pushing code does not run them.
They were missed twice. Run them explicitly against production:

```bash
ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate
ENV_FILE=.env.adb pnpm --filter @craftbid/api migrate:status
```

`.env.adb` is gitignored and points at the cloud database. `db:reset` refuses to
run whenever `ORACLE_WALLET_DIR` is set, so it cannot be aimed at production by
accident.

**A schema change and a code change ship at different speeds.** The database
accepts new values as soon as the migration runs; the API keeps rejecting them
until Render finishes redeploying. Migrate, wait for the deploy, then use the
new fields.

**Never unzip an Oracle wallet inside the repository.** It happened once.
`keystore.jks` and `truststore.jks` carry the client key and were not covered by
the ignore rules at the time. Nothing leaked, the rules now cover every file a
wallet unpacks, and the wallet lives at
`D:\Ptheusen Personal\craftbid-wallet\`.

**Purging test accounts:**

```bash
pnpm --filter @craftbid/api purge:accounts              # dry run
pnpm --filter @craftbid/api purge:accounts -- --commit  # delete
```

Deletion is ordered by hand because marketplace history deliberately does not
cascade from a user: removing a person must not erase a commission the other
party was part of.

---

## 10. What is unfinished

Ordered by what I would do next.

0. **In-app payments are assessed, not built.** `docs/PAYMENTS.md` explains why
   Craftbid must not collect and remit money itself (BSP merchant acquisition
   licensing, ₱5M minimum capital) and lays out a licensed-provider design,
   the answers to the client's questions, and the business prerequisites.
   **The client's social preview image** is also still to be supplied; the
   text metadata is live in `apps/web/index.html`.
1. **The desktop app has never been launched.** Windows and both macOS
   installers built and are in a draft release; the Linux fix needs a new tag
   (`git tag v0.1.1 && git push origin v0.1.1`). Nobody has installed or run
   any of them.
2. **No email or push notifications.** In-app rows only, so an artist sees a
   notice when they next open the site. Both cost money at volume.
3. **Search is a substring scan** that cannot use an index. Fine at this scale;
   Oracle Text is the upgrade, at the cost of an index type, a sync job and a
   query dialect.
4. **No payments.** The agreed price is information between the two parties. The
   commission record is shaped so a payment system can attach without reshaping
   the marketplace.
5. **Reviews cannot be edited or deleted.** That is the design, not a gap.
6. **`complete()` returns 400 where 403 would be right.** The refusal is
   correct; the status code is an authorisation failure dressed as a validation
   error.
7. **`uploadImage` has no deadline**, unlike every other request. Deliberate
   for now: a large photo on mobile data can legitimately outlast 20s, and a
   stuck upload shows a spinner on a button the reader can see rather than a
   page of skeletons. It wants its own, longer deadline rather than the shared
   one.
8. **The contact-links row is three lines tall on a narrow screen**: select,
   address, Remove. Correct and never overflowing, but the lonely Remove is
   untidy. The tempting fix, reordering it up beside the select with
   `order-last` on the address field, makes visual order disagree with tab
   order, so it needs a different layout rather than an ordering trick.
9. **The local folder is still `raxtan`.** Cosmetic; rename it when nothing is
   running.
10. **An orphaned ~2KB image** sits on ImageKit from an early purge, before the
    storage-removal bug in that script was fixed.

### Things that will bite you

- Render's free tier sleeps. The cron trigger mitigates it; only the paid tier
  removes it.
- Always Free ADB is **deleted after 90 idle days**. The GitHub workflow pings
  twice a week as the backstop, and GitHub stops running schedules on a
  repository quiet for 60 days.
- ImageKit's free tier is 20GB/month. An image-heavy marketplace reaches that
  before any other limit.
- Desktop builds are unsigned: macOS needs right-click then Open, Windows shows
  a SmartScreen warning. Certificates cost money.
