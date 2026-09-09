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
pnpm --filter @raxtan/api migrate
pnpm --filter @raxtan/api migrate:status   # confirm all applied
```

`db:reset` refuses to run whenever `ORACLE_WALLET_DIR` is set, so it cannot be
pointed at the cloud database by accident.

> Do **not** seed production. The seed is demo data with a shared password.

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
- **Build:** `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @raxtan/shared build && pnpm --filter @raxtan/api build`
- **Start:** `node apps/api/dist/index.js`
- **Health check path:** `/health`

Environment variables are listed in `render.yaml`. The ones that catch people
out:

- `CORS_ORIGINS` must be the exact deployed web origin with no trailing slash.
  Cookies are sent cross-origin and will be dropped silently if it is wrong.
- `STORAGE_DRIVER=imagekit`. The config **refuses to boot** with
  `STORAGE_DRIVER=local` in production, because Render's disk is wiped on every
  deploy and every uploaded image would vanish.
- `JWT_SECRET` must not be the example placeholder. Config refuses that too.

---

## 4. The web app on Cloudflare Pages

Connect the repository and set:

- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @raxtan/shared build && pnpm --filter @raxtan/web build`
- **Build output directory:** `apps/web/dist`
- **Environment variable:** `VITE_API_URL` = your Render URL, no trailing slash

`VITE_API_URL` is baked in at build time, so changing it needs a rebuild, not
just a restart.

The app is a single-page application, so Pages needs to serve `index.html` for
unknown paths. Add `apps/web/public/_redirects` containing:

```
/*    /index.html   200
```

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

> GitHub disables scheduled workflows on repositories with no activity for 60
> days. That is inside the 90-day deletion window, but not by much. If the
> project goes dormant, check on the database.

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
