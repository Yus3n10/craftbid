# Admin screen, reporting, and switching between Artist and Client

Design, 2026-09-14. Status: approved 2026-09-15.

## Decisions already made

| Question | Answer |
|---|---|
| Can an account switch role? | Yes, guarded: nothing open, once per 30 days |
| Session after a switch | This device stays signed in with the new role; every other device is signed out |
| "Delete account" | Two actions: **suspend** (reversible) and **remove** (permanent). Neither erases commission or payment records |
| Suspended account's content | Stays visible. The account cannot sign in or do anything |
| Removed account's content | Profile, posts, requests and comments hidden from everyone; records kept |
| Removing content | The author gets a notification naming the rule, with an optional note |
| Who can open the admin screen | The developer at launch; a command-line script can grant another account later. Never grantable from the website |
| Bug reports and comment reports | Both included |
| Email on the accounts list | Each account shows whether its email is confirmed (and when), filterable |

## What exists today, and the gaps

- `POST /reports` accepts reports on requests, users, posts and bids, but **no page
  has a Report button**, so nothing can be reported from the site.
- Comments cannot be reported, and there is no bug report form.
- `users.status` already allows `active`, `suspended`, `deleted`, and sign-in and
  refresh already refuse anything but `active`. But an access token lasts 15
  minutes and `requireAuth` does not look at status, so a suspended account keeps
  acting until its token expires.
- Public profiles filter on `status = 'active'`, so today a suspended profile
  would 404. That changes to match "stays visible".
- Comments are hard-deleted. An admin removal needs to keep the text as evidence.

## 1. Switching between Artist and Client

### Rules (enforced in the service, inside one transaction)

A switch is refused, with every reason listed, when the account has:

1. an open craft request (client),
2. a pending bid (artist),
3. an active commission on either side,
4. an open reported problem on any commission, or
5. switched in the last 30 days (`users.role_changed_at`).

On success, in one transaction: the role changes, `role_changed_at` is set, an
`artist_profiles` row is created if the account never had one, every refresh
token except the current one is revoked, and the current session is reissued so
its access token carries the new role.

### What carries over

- **Reviews** stay and show which role they were earned in. No new column: the
  role is derived from the commission (the reviewee was the artist if
  `commissions.artist_id` is the reviewee).
- **Artist profile, portfolio posts and payout accounts** are kept. While the
  account is a client, the portfolio stays on the profile as past work, "Add
  work" is hidden, and posting and bidding are refused by the existing role
  checks. Switching back restores everything.
- **Past commissions** keep their original parties; nothing is rewritten.

### Why these rules

The cooldown and the nothing-open rule stop an artist from switching to client,
posting a fake request, and reading competitors' bids, which would break the
private-bidding rule. Deriving review roles keeps a bad client record visible
after a switch to artist.

### API and web

- `GET /me/role-switch` returns `{ allowed, blockers: string[], nextAllowedAt }`.
- `POST /me/role` `{ role }` returns the new `MeDto`. Limit 5 per hour.
- Settings gets an **Account type** section: the current role badge, what
  changes, the blockers if any, and a confirmation dialog that says other
  devices will be signed out.

## 2. Reporting from the site

- A **Report** item (in a small "..." menu) on portfolio posts, comments,
  profiles and craft requests. Bids are reportable only by the client who
  received them, from the bid comparison page.
- The dialog asks for a reason (the existing list, plus the new `comment` target)
  and optional details. Reporting the same thing twice says it was already
  reported rather than erroring.
- **Report a problem with the site** in the account menu and the page footer,
  for signed-in users: what happened, the page it happened on (filled in), the
  browser (filled in, shown before sending), and an optional screenshot. The
  screenshot is stored as a private file (like receipts), because screenshots
  can show someone's personal details.
- Limits: 20 reports and 10 bug reports per hour per account.

## 3. Moderation rules

One shared list, used by warnings, removals and suspensions:

`bullying_harassment`, `sexual_content`, `hate_speech`, `violence_threats`,
`scam_fraud`, `spam`, `stolen_work`, `impersonation`, `other`.

Each has a plain-language label and one sentence the affected user sees, such
as "Bullying or harassment: Craftbid does not allow insulting, threatening or
targeting other people."

## 4. Data model (migration 014)

- `users.is_staff NUMBER(1) DEFAULT 0` with a CHECK, and `users.role_changed_at`.
- `reports`: target type widened to include `comment`; add `resolved_by`,
  `resolved_at`, `resolution_note`.
- `post_comments`: add `removed_at` and `removed_by`. Removed comments are
  excluded everywhere except the admin screen. An author deleting their own
  comment is still a hard delete.
- `postings`: admin removal sets status `cancelled` and a new `removed_at`.
  Refused while a commission on it is active; that goes through the commission
  problem flow instead.
- `artist_posts`: already has status `removed`.
- `bug_reports`: id, reporter, description, page URL, user agent, optional
  private screenshot key, status `open`/`resolved`, created and resolved times.
- `moderation_actions`: the audit log. Staff id, action, target type and id,
  rule, note, time. No route updates or deletes it.
- `ck_notifications_type` widened with `account_warning` and `content_removed`.
  (No suspension notification: a suspended account cannot sign in to read it;
  the sign-in page tells them instead.)

## 5. Enforcement

- `requireStaff` reads `is_staff` and `status` from the database on every admin
  request, so revoking access or suspending a staff account takes effect at once.
- **Any write by a signed-in account checks `status = 'active'`, and that the token's role is still the account's role** (one primary-key
  lookup in an `onRequest` hook for non-GET requests). That closes the 15-minute
  gap. Reads during those minutes are harmless.
- Suspending or removing revokes every refresh token for the account.
- Staff cannot suspend, remove or warn themselves or another staff account.
- Removed accounts: profile 404s, posts, requests and comments are excluded from
  every public query, and the username stays taken. The other party on a past
  commission still sees it, with the name shown as "Removed account".
- Suspended accounts: everything stays visible; the profile does not say they are
  suspended (that would invite pile-ons). Their pending bids stay but cannot be
  accepted, and their open requests stay but cannot take new bids, until
  unsuspended.

## 6. Admin API (`/admin`, staff only)

| Route | Does |
|---|---|
| `GET /admin/overview` | Counts: open reports, open bug reports, suspended accounts, actions this week |
| `GET /admin/reports?status=` | Queue with a preview of the reported thing and the reporter |
| `POST /admin/reports/:id/resolve` / `dismiss` | Closes a report, with a note |
| `GET /admin/bugs?status=`, `GET /admin/bugs/:id/screenshot`, `POST /admin/bugs/:id/resolve` | Bug reports |
| `GET /admin/users?q=&email=confirmed\|unconfirmed&status=&role=` | Search by username, display name or email; each row carries role, status, joined date and `emailConfirmedAt` (null when not confirmed) |
| `GET /admin/users/:id` | Email and whether it is confirmed (with the date), role, status, joined, warnings, reports against them, recent posts, requests and comments |
| `POST /admin/users/:id/warn` | `{ rule, note? }`, sends `account_warning` |
| `POST /admin/users/:id/suspend` / `unsuspend` / `remove` | `{ rule, note? }` |
| `POST /admin/posts/:id/remove`, `/admin/postings/:id/remove`, `/admin/comments/:id/remove` | `{ rule, note?, reportId? }`, sends `content_removed`, resolves the linked report |
| `GET /admin/actions` | The audit log, newest first |

Every mutation writes one `moderation_actions` row in the same transaction as
the change, so there can be no action without a record.

## 7. Admin screen (web)

- Route `/admin`, lazy-loaded, reachable from an **Admin** item in the account
  menu that only staff see. Anyone else going to `/admin` gets the normal "not
  found" page, and the API refuses them regardless.
- Tabs: **Overview**, **Reports**, **Users**, **Bug reports**, **Activity log**.
- A report opens beside the reported item, with the actions that fit it: remove
  the content, warn the author, suspend the author, or dismiss. Each action asks
  for a rule and an optional note and shows the exact notification text before
  sending.
- **Users tab:** a searchable list showing name, username, email, role badge,
  status, joined date, and an **Email confirmed** (with date) or **Not
  confirmed** badge. Filters for email confirmed or not, role, and status.
- The user page shows the account's history and the same actions.
- Works at phone width, since the developer will likely check it from a phone.
- Visual design follows the existing tokens; no new palette.

## 8. Notifications the user sees

- **Warning:** "Warning from Craftbid: [rule label]. [rule sentence] [note]"
- **Content removed:** "We removed your [post/request/comment]: [rule label]. [note]"
- **Suspended:** shown on the sign-in page instead of a generic failure: "This
  account is suspended. [rule label]." (a notification cannot reach someone who
  cannot sign in).

## 9. Testing

- API integration tests against real Oracle for every refusal: non-staff on each
  admin route, staff acting on self or on staff, suspended account writing within
  the token's 15 minutes, switch blocked by each of the five rules, bid spying
  after a switch, removed content absent from feed, search, profile and activity,
  and the audit row existing for every action. Mutation-check the role-switch
  guards and the status hook.
- Resilience tests: the Users tab's confirmed and not-confirmed badges and filter, Report dialog, bug report form, Account type section, admin
  tabs at 375px and 1280px, the Admin item hidden for non-staff.
- End-to-end: report a post, remove it from the admin screen, see it gone and the
  notification delivered.

## 10. Rollout

1. Run migration 014 on production.
2. Grant staff to the developer's account:
   `ENV_FILE=.env.adb pnpm --filter @craftbid/api staff grant <email>`
   (also `staff revoke` and `staff list`).
3. Push; verify on WebKit iPhone 13 with `smoketest_` accounts made in the
   database; purge them.

## Build order

1. Role switching (independent and small).
2. Migration 014, status hook, staff flag and CLI, moderation service and admin API.
3. Report buttons and the bug report form.
4. Admin screen.

Each step lands with its tests green before the next starts.

## Not included

Email alerts to the developer, an appeals flow, IP or device bans, bulk actions,
automatic content filtering, and a public rules page (it needs the client's
wording; the rule sentences above are placeholders for it).
