# Deployment runbook

Everything here is on a genuinely free tier. Where a service needs a credit
card even to start, it is not used, and that is called out.

| Piece | Host | Free? |
|---|---|---|
| Web | Cloudflare Pages | Unlimited bandwidth, commercial use permitted, no card |
| API | Render free web service | No card. **Sleeps after 15 min idle** |
| Database | Oracle Always Free Autonomous Database | **Stops after 7 idle days, deleted after 90** |
| Images | ImageKit | 20GB/month bandwidth, no card |
| Desktop builds | GitHub Actions to Releases | Unlimited for public repositories |

**GitHub Pages and Vercel Hobby cannot be used.** Both prohibit commercial
sites in their terms, and a marketplace is commercial. This is a licensing
constraint, not a technical one.

---

## 1. The database

Provision an **Always Free Autonomous Database** in the OCI console. Note that
Always Free *compute* (Ampere A1) is frequently capacity-constrained; the
database is a separate allocation and does not suffer the same problem.

Choose either 19c or 23ai. The schema avoids 23ai-only syntax deliberately, so
both work.

### Getting the wallet onto Render

Render offers environment variables, not files, and a wallet must never be
committed. Thin mode needs exactly two files out of the wallet archive.

Download the wallet from the console, unzip it **outside this repository**, and
encode those two:

```bash
# macOS / Linux
base64 -w0 tnsnames.ora  > tnsnames.b64
base64 -w0 ewallet.pem   > ewallet.b64
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("tnsnames.ora")) > tnsnames.b64
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ewallet.pem"))  > ewallet.b64
```

Set the contents as `ORACLE_TNSNAMES_B64` and `ORACLE_EWALLET_PEM_B64`. The API
writes them to a temporary directory at startup (`apps/api/src/db/wallet.ts`).

> If the wallet zip has no `ewallet.pem`, re-download it and pick the option
> that includes the PEM wallet. `cwallet.sso` is Thick-mode only and will not
> work here.

**Set `ORACLE_WALLET_PASSWORD` as well.** Open `ewallet.pem` and look at the
first line. If it reads `-----BEGIN ENCRYPTED PRIVATE KEY-----`, which is what
the console produces whenever a wallet password was set on download, the
password is required to decrypt it.

Omitting it does not fail cleanly: the pool is created without connecting,
the service starts and serves traffic, and then the first query sits for about
sixty seconds before returning `NJS-505: unable to initiate TLS connection`.
`initPool` now checks for this and refuses to start with a message naming the
variable.

`ORACLE_CONNECT_STRING` is a TNS alias from `tnsnames.ora`, such as
`myadb_tp`. The `_tp` service is the right one for a small application.

### Apply the schema

Run migrations from your machine, pointed at the cloud database, before the
first deploy. Put the wallet path and credentials in a local `.env`:

```bash
ORACLE_WALLET_DIR=/absolute/path/outside/this/repo/wallet
ORACLE_CONNECT_STRING=myadb_tp
ORACLE_USER=ADMIN
ORACLE_PASSWORD=...
```

```bash
pnpm --filter @craftbid/api migrate
pnpm --filter @craftbid/api migrate:status   # confirm all applied
```

`db:reset` refuses to run whenever `ORACLE_WALLET_DIR` is set, so it cannot be
pointed at the cloud database by accident.

> Do **not** seed production. The seed is demo data with a shared password.

> **Run migrations before the code that needs them deploys.** Pushing does not
> run them. `009-remember-me.sql` is the current example: the API that reads
> `refresh_tokens.persistent` fails every sign-in with ORA-00904 if it reaches
> Render before the column exists. Migrate, confirm with `migrate:status`, then
> push. The migration is additive and defaults existing sessions to persistent,
> so running it early is harmless to the code already deployed.

---

## 2. Images

Create a free [ImageKit](https://imagekit.io) account. No card is required.
Take the public key, private key and URL endpoint from the dashboard.

Oracle Object Storage is a reasonable alternative since the tenancy already
exists, and the `ObjectStorage` port in `apps/api/src/lib/storage/` is there to
make that a small job. Its Always Free allowance caps at **50,000 API requests
a month**, roughly 1,600 image loads a day with no CDN in front, which is the
reason it is not the default.

---

## 3. The API on Render

The repository includes `render.yaml`, so you can create the service as a
Blueprint and Render will prompt for each secret.

Or configure it by hand:

- **Runtime:** Node
- **Region:** Singapore (closest to the Philippines)
- **Build:** `npm install -g pnpm@10.34.5 && pnpm install --frozen-lockfile && pnpm --filter @craftbid/shared build && pnpm --filter @craftbid/api build`
- **Start:** `node apps/api/dist/index.js`
- **Health check path:** `/health`

### Build traps, all hit on real deploys

None of these error messages point at their cause.

**Editing `render.yaml` does not change an existing service.** Render copies
`buildCommand` into the service's own settings when the Blueprint is first
created, and reads the file again only on an explicit Blueprint sync. A commit
that fixes the build command will be checked out and then ignored, and the log
shows the old command next to the new commit hash. Either edit the build
command in **Settings → Build Command**, or re-sync the Blueprint.

**Do not use corepack here.** It cost three failed deploys. Its shims default
to `/usr/bin`, which is read-only (`EROFS`); pointing it elsewhere with
`--install-directory` then fails with `ENOENT` because it does not create the
directory; and it still needs a `PATH` edit afterwards. `npm install -g pnpm`
installs beside the Node that Render provisioned, under
`/opt/render/project/nodes/<version>/`, which is writable and already on
`PATH`.

**Render picks the newest Node it is allowed to.** An open-ended
`engines: ">=22"` got Node 26, well ahead of the version the test suite runs
on, and both `sharp` and `oracledb` are native modules. `.node-version` pins 22
and `engines` now has an upper bound.

Environment variables are listed in `render.yaml`. The ones that catch people
out:

- `CORS_ORIGINS` must be the exact deployed web origin with no trailing slash.
  The Worker forwards the browser's `Origin`, and the API's CSRF check rejects
  every cookie-authenticated write (sign-in included) from an unlisted origin.
- `STORAGE_DRIVER=imagekit`. The config **refuses to boot** with
  `STORAGE_DRIVER=local` in production, because Render's disk is wiped on every
  deploy and every uploaded image would vanish.
- `JWT_SECRET` must not be the example placeholder. Config refuses that too.

---

## 4. The web app on Cloudflare

Cloudflare now steers new projects into **Workers Builds**, which runs a deploy
command rather than just publishing a directory. `apps/web/wrangler.jsonc`
configures the site as a Worker with static assets for that flow; the script
only answers `/api/*` and the cron trigger:

- **Build command:** `npm install -g pnpm@10.34.5 && pnpm install --frozen-lockfile && pnpm --filter @craftbid/shared build && pnpm --filter @craftbid/web build`
- **Deploy command:** `npx wrangler deploy -c apps/web/wrangler.jsonc`
- **API origin:** `vars.API_ORIGIN` in `apps/web/wrangler.jsonc` = your Render URL,
  no trailing slash. `VITE_API_URL` is no longer read by this build (see below).

### The API is served at /api on the site's own origin

The browser never calls Render directly. The production web build calls
`/api/...`, and the Worker (`apps/web/worker/index.ts`) forwards those requests
to `API_ORIGIN`, passing the API's `Set-Cookie` headers straight back.

This is not optional plumbing. Called cross-site, the session cookies were
third-party cookies, and WebKit refuses those outright. WebKit is every
browser on an iPhone, including Messenger's in-app browser: sign-in answered
200, nothing was stored, and the next request that needed the session was a
401. Through `/api` the same cookies are first-party. Verified on WebKit, see
HANDOVER.md 4.11.

Three settings make it work, and removing any one breaks sign-in on iPhones:

- `assets.run_worker_first: ["/api/*"]` in `wrangler.jsonc`. Without it, the
  single-page-application fallback answers `/api/...` with `index.html`
  before the Worker ever runs.
- `CORS_ORIGINS` on Render must still include the web origin. The Worker
  forwards the browser's `Origin` header, and the API's CSRF check rejects any
  cookie-authenticated write whose Origin is not listed.
- The API keys rate limits on `CF-Connecting-IP`, which Cloudflare sets to the
  visitor's address on a Worker's request to a host outside Cloudflare.
  Without that, every visitor would share Cloudflare's address and ten failed
  sign-ins anywhere would lock everyone out.

**Cost to watch:** requests that run the Worker count toward the Workers free
plan's daily request allowance. Static assets do not; `/api/*` calls do.
Check the Workers dashboard's request graph after launch.

The `-c` matters. A bare `npx wrangler deploy` from the repository root fails
with *"has been run in the root of a workspace instead of targeting a specific
project"*, because wrangler sees `pnpm-workspace.yaml` and declines to guess.

`not_found_handling: "single-page-application"` in that config is what makes a
deep link such as `/postings/<id>` resolve instead of 404ing.

### On the older Pages flow

If you have a Pages project instead, there is no deploy command; set: 

- **Build command:** `npm install -g pnpm@10.34.5 && pnpm install --frozen-lockfile && pnpm --filter @craftbid/shared build && pnpm --filter @craftbid/web build`
- **Build output directory:** `apps/web/dist`
- **Environment variable:** `VITE_API_URL` = your Render URL, no trailing slash

`VITE_API_URL` is baked in at build time, so changing it needs a rebuild, not
just a restart. It is used by the desktop build and local development only;
the production web build always calls `/api` on its own origin.

The app is a single-page application, so Pages needs to serve `index.html` for
unknown paths. Add `apps/web/public/_redirects` containing:

```
/*    /index.html   200
```

> **Only for the Pages flow.** That file breaks the Workers deploy: Workers
> reads `_redirects` too and rejects this rule as an infinite loop
> (API error 100324), because the destination matches the pattern. It fails on
> the final API call, after all assets have uploaded, and `wrangler --dry-run`
> does not catch it because only the server validates the file. The repository
> therefore does not contain one; `not_found_handling` in
> `apps/web/wrangler.jsonc` covers the same need.

---

## 5. Keep the database alive

**This is not optional.** Always Free Autonomous Database stops itself after
7 consecutive idle days and is **permanently deleted after 90 cumulative idle
days**. A quiet marketplace would lose its database outright.

`.github/workflows/keepalive.yml` pings `/health` twice a week, which runs a
real query rather than just reporting the process is up, so it genuinely resets
the idle clock. It also warms Render's sleeping service.

Set the repository variable so it knows where to ping:

**Settings → Secrets and variables → Actions → Variables → New variable**
`API_URL` = your Render URL.

### Keeping the API awake

Render stops a free service after **15 minutes without a request**, and the
next visitor waits 30 to 60 seconds while it starts. Nothing else on the site
comes close to that, and it lands on first-time visitors.

A **Cloudflare cron trigger** handles it. `apps/web/wrangler.jsonc` gives the
site's Worker a `scheduled` handler that pings `/health` every ten minutes, so
the container never idles out. It needs no extra account and no extra bill: the
site is already deployed there, and cron triggers are included in the Workers
free tier.

It lives beside the static assets rather than as a separate Worker so it
deploys with the site and cannot drift out of sync with it. Assets are still
matched before the script, and the script's `fetch` handler hands anything that
reaches it straight back to the asset server, so serving the site is unchanged.

Watch it run:

```bash
npx wrangler tail craftbid
```

The GitHub workflow still runs twice a week, but only as the backstop for the
slower clock: the database stops after 7 idle days and is deleted after 90.

**If you would rather not rely on Cloudflare for this**, a free UptimeRobot
monitor on `https://craftbid-api.onrender.com/health` at a 5-minute interval
does the same job and also tells you when the API is down.

> GitHub also disables scheduled workflows on repositories with no activity for 60
---

## 6. Desktop releases

Before tagging, point `.env.desktop` at the deployed API. It is committed
precisely so CI can build reproducibly, and it holds no secrets:

```
VITE_API_URL=https://your-api.onrender.com
VITE_AUTH_MODE=bearer
```

Then tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` builds on Windows, macOS (Intel and Apple
silicon) and Ubuntu 22.04, and attaches the installers to a **draft** release.
Review it, then publish.

Builds are unsigned, because certificates cost money: macOS needs right-click
then Open on first launch, and Windows shows a SmartScreen warning. The release
notes say so.

To build locally you need [Rust](https://rustup.rs) and, on Windows, the MSVC
build tools:

```bash
pnpm desktop:icons   # regenerate icons from apps/web/public/icon-512.png
pnpm desktop:build
```

---

## What "free" costs you

Worth saying plainly, because these are visible to users:

- **The first request after a quiet spell takes 30 to 60 seconds** while Render
  wakes the container. If the database also auto-stopped, longer.
- **ImageKit's free tier is 20GB of bandwidth a month.** An image-heavy
  marketplace will reach that before it reaches any other limit.
- **Always Free Autonomous Database is 20GB and 1 OCPU**, with 20 to 30
  concurrent sessions. The connection pool is capped at 4 for this reason.
