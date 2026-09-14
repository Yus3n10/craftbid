# Fixes, personal home feed, chat images and staff tools

Date: 2026-09-15. Status: approved in chat, awaiting spec review.

Four batches, built, tested and deployed separately in this order. Each batch
is committed and deployed only when the developer says so.

---

## Findings behind this work (reproduced on production)

1. **Blank page.** `index.html` loads Google Fonts with a render-blocking
   `<link rel="stylesheet">`. With `fonts.googleapis.com` unreachable or slow,
   Chromium (Pixel 7 profile) and WebKit (iPhone 13 profile) had no `<body>` at
   all after 90 seconds. Messenger's in-app browser paints its own black while
   waiting; Chrome paints white. Slow mobile data, data-saver modes and DNS
   filters all produce this.
2. **Older iPhones get no data.** `apps/web/src/lib/api.ts` calls
   `AbortSignal.timeout` unguarded (Safari 16+, Chrome 103+). With it removed,
   WebKit renders the page shell but every API call throws, so feeds, requests
   and sign-in never load.
3. **"My post is not on the home page or my profile."** The item was a craft
   request (`yus3n` is a client). The feed (`feedEntries` in
   `posts.repository.ts`) and profiles only show portfolio posts and shares. A
   share is itself a feed item, which is why a share appeared at the top and a
   request did not.
4. **"-1 days ago".** Four copies of a day-difference function
   (`FeedPost.tsx`, `SharedPostCard.tsx`, `PostingCard.tsx`, and a minutes
   version in `CommentThread.tsx`) use `Math.floor` on
   `Date.now() - createdAt`. A server timestamp a few seconds ahead of the
   phone's clock gives a small negative number, which floors to -1.

---

## Batch 1: Fixes

### 1a. Fonts that cannot blank the page
- Self-host Bricolage Grotesque (variable, opsz 12..96, wght 500..700) and
  Figtree (variable, wght 400..700) as woff2 from the site's own origin,
  using `@fontsource-variable/bricolage-grotesque` and
  `@fontsource-variable/figtree`, Latin subset only.
- Remove the Google Fonts `preconnect` and stylesheet links from `index.html`.
- `font-display: swap` so text shows in the system face first.
- The service worker precaches the font files, so repeat visits need no
  network for them.

### 1b. A page that says something while it starts
- `#root` in `index.html` contains a small static "Loading Craftbid" block
  with inline styles (brand background and text colour), which React replaces
  on first render.
- A `<noscript>` line for browsers with JavaScript off.

### 1c. Older browsers
- `api.ts` gets one `deadlineSignal(ms)` helper: `AbortSignal.timeout` when
  present, otherwise an `AbortController` with `setTimeout`. Both call sites use
  it. `combineSignals` is already guarded.

### 1d. One "time ago"
- One module, `apps/web/src/lib/timeAgo.ts`, replaces the four copies.
- Negative differences clamp to zero ("Today" / "just now").
- "Today" and "Yesterday" are calendar days in `Asia/Manila`, not 24-hour
  windows, so a post at 11 PM is "Yesterday" at 1 AM.
- Two exports keep the current wording: `daysAgo(iso)` for cards and
  `shortAgo(iso)` for comments.

### 1e. Chat suggestions
- `CHAT_SUGGESTIONS` keeps three per role and stage:
  - client, bidding: "How soon could you start?", "Could you show me a similar
    piece you have made?", "I have a question about your bid."
  - client, commission: "Can you send me a progress photo?", "Can you give me
    an estimate of when this will be finished?", "I have a question about the
    commission."
  - artist, bidding: "Can you clarify what you want for this piece?", "Do you
    have a reference photo or measurements?", "I have a question about your
    request."
  - artist, commission: "Can you confirm the details before I start?", "Here
    is an update on your piece.", "I have a question about the commission."
- The chips wrap onto a second line instead of scrolling sideways.
- A shared-package test asserts no list exceeds three.

### 1f. Feed freshness after posting
- Creating, editing or cancelling a craft request also invalidates `["feed"]`
  and the profile queries, as creating a portfolio post already does. (It
  matters once Batch 2 puts requests in the feed.)

### Batch 1 tests
- Resilience: with `fonts.googleapis.com` and `fonts.gstatic.com` hung, the home
  page renders text within 5 seconds (fails on the current build, proven
  first).
- Resilience: with `AbortSignal.timeout` deleted by an init script, the feed
  loads (fails on the current build).
- Unit: `timeAgo` for a timestamp 5 seconds in the future, 23:00 yesterday
  Manila time, and 30+ days.
- Resilience: the chat suggestion row has no horizontal overflow at 320px.

---

## Batch 2: Personal home feed with craft requests

### What the feed contains
- Portfolio posts, shares (as today), and **open craft requests** whose client
  is active. A request card shows the photo, title, category, starting budget,
  client, city, when it was posted and a "View request" link. It has no
  reactions, comments, saves or shares, and no bid count, so nothing about
  bidding enters the social surface.
- Suspended clients' requests are already refused bids; they are left out of
  the feed as well.

### Client profiles
- A "Requests" section on a client's profile lists their requests with status
  `open` or `in_progress`, newest first, using `PostingCard`. Cancelled,
  completed and removed requests are not shown.
- `GET /users/:username/postings` returns them (public, `no-cache` like other
  anonymous reads).

### Interest scores
- Migration 018 adds
  `user_category_interest (user_id, category_id, score NUMBER(10,4), updated_at)`
  with primary key `(user_id, category_id)` and cascade delete with the user.
- Scores decay with a 30-day half-life. A bump reads the stored score, decays it
  to now, adds the weight and stores it. Reads decay to now as well, so an old
  interest fades even with no new activity.
- Weights, bumped in the service that records the action, inside its
  transaction:

  | Signal | Weight |
  |---|---|
  | Save a post | 3 |
  | Share a post | 3 |
  | Comment on a post or share | 2 |
  | Bid on a request (artist) | 2 |
  | Post a request (client) | 2 |
  | React to a post or share | 1 |
  | Search whose text matches a category name or slug | 1 |
  | Pick a category filter on the home page | 0.5 |

  Undoing a reaction, save or share does not subtract. Decay handles drift and
  it keeps the writes simple.
- An artist's own craft categories (`artist_categories`) count as a fixed
  baseline of 2 each, read at ranking time, never stored.
- Only the signed-in person's own scores are ever read, and only to order their
  own feed. No endpoint returns them. The privacy notice (Batch 2 does not
  write it) will need a line about this.

### Ranking
- A new endpoint `GET /home?category=&limit=&offset=` returns a discriminated
  union: `{ kind: "post", ...FeedItemDto }` or `{ kind: "request", ...PostingDto }`.
- Candidates: the newest 500 items across posts, shares and open requests (with
  the category filter applied). Ranking happens in SQL over that window.
- `rank = freshness * (1 + interest)` where
  - `freshness = 0.5 ^ (ageHours / 36)`
  - `interest = LEAST(score, 10) / 10` for the item's category (0 when none),
    so interest can at most double an item's weight.
- Anything less than 6 hours old gets `freshness` of at least 0.9, so a new
  item is near the top for everyone on refresh whatever their interests.
- The viewer's own item from the last 24 hours sorts first for them.
- Signed out, or with no scores at all: freshness only, which is newest first.
- Ties break on `created_at DESC, id` so pages are stable.

### Deploy safety
- `/feed` is unchanged and stays, because Cloudflare usually finishes before
  Render. The web app calls `/home` and falls back to `/feed` on a 404, so the
  few minutes between the two deploys still show a feed. `/feed` can be retired
  in a later batch.

### Batch 2 tests
- API: a new request appears in `/home` for a signed-out viewer; a cancelled,
  in-progress or suspended client's request does not; request items never carry
  bid count or price other than the starting budget.
- API: two users with opposite interests (pottery vs jewelry) get the same
  two same-age items in opposite order; a 1-hour-old jewelry item still
  outranks a 3-day-old pottery item for the pottery user.
- API: decay (a score from 30 days ago counts half), and search bumps only on a
  category match.
- API: the viewer's own new request is first for them only.
- API: profile requests show open and in-progress only.
- Mutation checks on the privacy filter, the 6-hour floor and the own-item rule.
- Resilience: request card layout at 320px and 1024px; `/home` 404 falls back
  to `/feed`.
- E2E: a client posts a request, returns home, and sees it at the top.

---

## Batch 3: Images in chat

### Behaviour
- An attach button beside the message box, and pasting an image into the box
  (clipboard `files` on the `paste` event).
- One image per message, with optional text. The preview shows above the box
  with a remove button before sending.
- Sent images show as a thumbnail in the bubble; tapping opens the existing
  `Lightbox`.
- Only when the conversation can send (`canSend`). The same two people as the
  conversation can view the image; everyone else gets 404.

### Compression
- In the browser: decode, scale so the longest side is at most 1600px, encode
  WebP at quality 0.8 (JPEG where WebP encoding is unsupported), done on a
  canvas. A 4MB phone photo is typically 150 to 300KB. Files over 15MB are
  refused before reading.
- On the server: the existing image pipeline sniffs magic bytes and re-encodes
  with sharp (dropping EXIF and GPS), capped at 1600px.
- Stored as ImageKit private files, read through the API with a 60-second
  signed URL, streamed with `private, no-store`, exactly like receipts.

### Data
- Migration 019:
  - `chat_files (id, conversation_id, uploader_id, object_key, content_type,
    byte_size, width, height, attached_at, created_at)`, cascade with the
    conversation.
  - `messages.file_id` nullable, foreign key to `chat_files`, unique.
  - `messages.body` becomes nullable (Oracle stores `''` as NULL), and
    `ck_messages_body` is replaced by "non-empty trimmed body, or a file".
- `POST /conversations/:id/files` (multipart, 20 per 10 minutes, verified)
  uploads and returns `{fileId}`; `POST /conversations/:id/messages` accepts
  `{body?, fileId?}` with at least one; `GET /conversations/:id/files/:fileId`
  streams it. A file can be attached once and only by its uploader, to a
  message in the same conversation.
- Unattached files older than 24 hours are deleted by the Batch 4 job runner.
- Deleting accounts (purge script, removal) deletes their chat files from
  storage too.

### Deploy safety
- Migration 019 runs on production before the push. No image message can exist
  until the new API is live, and the new web build (which renders a message
  with `body: null`) normally reaches users first, since Cloudflare deploys
  before Render. Tabs still on the old build reload through `appUpdates.ts`.

### Batch 3 tests
- API: upload and send; image-only message; another bidder and a stranger get
  404 on the file; attaching someone else's file or a file from another
  conversation is refused; a closed conversation refuses uploads; the database
  refuses a message with neither body nor file.
- Unit: compression output is at most 1600px and WebP.
- Resilience: paste an image into the box shows the preview; send shows the
  thumbnail; no overflow at 320px.
- E2E: an image sent in bidding chat is visible to the other party after the
  commission starts.

---

## Batch 4: Staff tools

### Job runner
- `apps/api/src/jobs/` holds an in-process runner started from `index.ts`,
  ticking every 5 minutes. The Cloudflare keep-alive ping every 10 minutes keeps
  Render awake, so no new service or secret is needed.
- Migration 020 adds `job_runs (name, run_key, ran_at)` with primary key
  `(name, run_key)`. A job claims its run by inserting its key; a duplicate key
  means another tick or a restart already did it. This makes every job safe to
  run twice.
- Not started when `NODE_ENV=test`; tests call the jobs directly.

### Daily owner summary
- Once a day at 4:00 PM Philippine time (08:00 UTC), run key the Manila date.
- Collects what arrived since the previous summary: new user reports, new bug
  reports and new commission problems, with counts and the first 10 of each
  (type, short reason, when, link to the admin screen).
- **Sends nothing when all three are empty**, to save Brevo's daily limit. The
  claim is still recorded so the next summary covers from that point.
- Recipient: `OWNER_ALERT_EMAIL` (new Render variable). Unset means the job
  logs and skips. It is not every staff account, per the developer's choice.
- Uses the existing mailer port; `outbox` in tests.

### Commission problems in the admin screen
- A "Problems" tab lists open and resolved problems: commission, both parties,
  reason, details, reporter, when, payment records and receipts (through the
  existing private file stream, staff allowed).
- Resolve with "Continue the commission" or "Cancel the commission" and a note
  both people see. This calls the same service function the CLI uses, and
  writes a `moderation_actions` row in the same transaction
  (`ck_moderation_actions_action` widened in migration 020).
- The Overview tab counts open problems.
- The CLI stays for now as a fallback; the handoff notes the admin tab as the
  main route.

### Payment records and receipts in the admin screen
- Requested 2026-09-15 as a layer of protection: staff can check what actually
  happened before or during a dispute, not only after a problem is reported.
- A "Payments" tab lists every payment record on every tracked commission,
  newest first, whatever its state: waiting for confirmation, confirmed,
  rejected, or replaced by a later record.
- Each row shows: the commission and its request title, the client and the
  artist (links to their admin account pages), who recorded it, the kind (down
  payment or balance), method, amount, reference number, date paid, state, and
  who confirmed or rejected it and when.
- The receipt image opens from the row through a staff-only stream
  (`GET /admin/payments/:paymentId/receipt`), using the same private-file
  signing as the parties' own stream, `private, no-store`.
- Filters: state, and search by username or reference number.
- The commission detail inside the Problems tab reuses the same rows.
- Every time staff open a receipt, a `moderation_actions` row records who
  viewed which file (action `payment_file_viewed`, widened in migration 020),
  so looking at private receipts is itself on the record. These rows are shown
  in the Activity log tab.
- The privacy notice (out of scope here) will need a line saying staff may
  review payment records and receipts to settle disputes.

### Unread chat notice
- Every tick: for each conversation side whose unread messages include one
  older than 1 hour, and which has not been nudged since its last read, create
  one in-app notification `chat_unread` ("You have an unread message from
  Name about Request") linking to the conversation.
- Migration 020 adds `conversations.client_nudged_at` and
  `conversations.artist_nudged_at`, set in the same statement that claims the
  nudge, and the `chat_unread` notification type.
- In-app only. No email.
- Reading the conversation makes that side eligible again for the next unread
  stretch.
- Closed conversations are not nudged.

### Batch 4 tests
- API: summary with nothing new sends no email and records the run; with one
  bug report, one email to `OWNER_ALERT_EMAIL`; running twice the same day sends
  once; before 4 PM Manila does nothing.
- API: problems list and resolve are staff-only (404 otherwise) and write the
  audit row; resolving twice is refused.
- API: nudge after 61 minutes, not at 59; once per unread stretch; again after
  read and a new message; not for closed conversations.
- API: payments list returns confirmed, pending, rejected and replaced records
  with both parties and the recorder; non-staff get 404 on the list and the
  receipt stream; opening a receipt writes one audit row.
- Mutation checks on the run claim, the nudge claim and the receipt audit row.
- Resilience: Problems tab layout and resolve dialog.

---

## Out of scope
- Email for unread chat.
- Privacy notice and terms text (waits on the client's decisions).
- Retiring `/feed` and the problems CLI.
- Share engagement in activity history.
