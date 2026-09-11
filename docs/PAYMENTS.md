# Payments: assessment and architecture

The client wants Craftbid to work like Upwork: the client pays through
Craftbid, Craftbid keeps a platform fee, and the artist is paid the rest,
possibly held until the work is delivered.

This document is the assessment that has to come before any of that is built.
**No money movement has been implemented.** The recommendation is to build it
on a licensed payment provider's marketplace product, never on a Craftbid bank
or e-wallet account, and not until the business registrations and provider
approvals in the last section exist.

This is a technical and regulatory reading, not legal advice. Every statement
below is marked as one of:

- **Confirmed**: stated in an official source linked in [Sources](#sources).
- **Likely**: a reasonable reading of those sources, not stated outright.
- **Confirm**: must be put to BSP, DTI, BIR, NPC, AMLC or Philippine counsel.
- **Depends**: turns on which provider product is used and how.

---

## 1. The short answer

| | |
|---|---|
| Recommended model | A licensed provider's marketplace product (PayMongo Platforms or Xendit xenPlatform with managed sub-accounts). Each artist is onboarded and verified by the provider; the client's payment is split by the provider into the artist's share and Craftbid's fee. |
| Who holds the money | The provider, in the artist's provider account. Never Craftbid. |
| Not recommended | Collecting into a Craftbid bank or GCash account and paying artists out by hand. Under the BSP's own definitions that is merchant acquisition, which needs a licence with a ₱5M minimum capital. |
| Build now | Nothing that moves money. The existing agreed price stays as it is. The data model below is designed, not migrated. |
| Before building | Craftbid registered as a business with BIR and DTI or SEC, a signed provider agreement, the provider's written view of Craftbid's role, and a privacy programme that fits the new data. |

---

## 2. What exists today

Inspected in `apps/api/src/db/migrations/003-marketplace.sql` and `004-*.sql`.

| Concept | Where | State |
|---|---|---|
| Money | Integer centavos, `NUMBER(12)` | Good base: no floats anywhere |
| Private bids | `applications`, `proposed_price_centavos` | Only the owner client and the bidding artist ever see a bid |
| Bid minimum | `min_price_at_apply_centavos` copied onto the bid | A `CHECK` stops undercutting |
| Selection | Partial unique index: at most one accepted bid per request | Database-enforced |
| Commission | `commissions`: `agreed_price_centavos`, `active / completed / cancelled` | Price is informational only |
| Completion | Client marks complete; `completed_at` required by a `CHECK` | |
| Reviews | One per person per commission | Cannot be edited or deleted, by design |
| Disputes | None. `reports` covers content moderation only (posting, user, post, application) | Missing |
| Identity | Email, username, display name, region, city | No legal name, phone, government ID, tax number or payout details |
| Payment state | None | Nothing records a payment, fee, payout or refund |

The agreed price is today a figure the two parties agreed, recorded
honestly. Payments should attach to `commissions` after selection, so nothing
in the payment flow ever touches a bid that was not chosen. Private bidding is
unaffected.

---

## 3. Why Craftbid should not hold the money itself

**Confirmed.** The BSP's definition of an operator of a payment system
includes anyone that *"provides a system that processes payments on behalf of
any person"*, and says online merchants and payment gateways *"may be part of
the scope if they perform operator functions"*. Operators must register with
the BSP (RA 11127 Sec. 10; Circular No. 1049).

**Confirmed.** Circular No. 1198 defines merchant acquisition as *"accepting and
processing payment transactions on behalf of a merchant under an agreement,
resulting in a transfer of funds to the merchant"*. It needs a Merchant
Acquisition License. The smallest category requires **₱5 million** minimum
capital, a designated settlement account with a BSP-supervised institution,
and settlement to merchants within two business days. The BSP names
"payment facilitators" and "payment aggregators" as examples.

**Likely.** Collecting a client's payment into Craftbid's own account and later
paying the artist is merchant acquisition with the artist as the merchant. It
would also make Craftbid a withholding agent for the artists' taxes (see Q15),
a covered person for anti-money-laundering rules (see Q5), and the party
answerable for every refund, all without the licence, capital or staff.

**Likely.** A wallet balance that users can hold and spend is e-money, which is
separately licensed. That is why no "Craftbid balance" should ever exist.

The provider model avoids this because the provider, which holds the licences,
is the one accepting and settling the money. Craftbid's role narrows to a
platform that charges a fee. **Confirm** that narrowed role in writing with
the chosen provider and, ideally, with counsel before launch.

---

## 4. The recommended flow

```
Client selects a bid (unchanged; private bidding intact)
  -> commission created with agreed_price_centavos (unchanged)
  -> Craftbid creates a payment intent at the provider:
       amount = agreed price, split = artist sub-account + Craftbid fee
  -> client pays on the provider's checkout (GCash, Maya, card, QR Ph)
  -> provider webhook: paid           -> commission shows "Paid, held"
  -> artist delivers; client accepts  -> Craftbid asks provider to release
       (or: client does nothing for N days -> auto-release per the terms)
  -> provider settles the artist's share to the artist's own account
  -> provider webhook: settled        -> commission "Paid out"
```

Holding until acceptance is only possible if the provider supports delayed
or conditional settlement on split payments. PayMongo's Platforms page
advertises splitting and settling funds "with logic and delay conditions",
but its developer documentation was not available to verify this, so it is
**Depends** until shown in the sandbox: confirm the exact mechanics, maximum
hold period and refund behaviour for held funds before designing the UI
around them. If holds are not available, launch with *pay on acceptance*: the client
pays when approving the delivered work, and the artist bears the risk of
non-payment as they do today.

---

## 5. The seventeen questions

### Q1. What is the safest realistic payment model for a small Philippine startup?

Phase 0 is what already exists: the platform records the agreed price and the
parties pay each other directly. Phase 1 is a licensed provider's marketplace
product with managed sub-accounts, the provider doing KYC, the provider
splitting each payment, and Craftbid never touching funds. Phase 1 is the
first point at which Craftbid can offer buyer and artist protection, and it
needs no BSP licence of Craftbid's own on the **Likely** reading in section 3.

### Q2. Direct processing, a licensed provider, a gateway, payment links, split payouts, or postpone custody?

A licensed provider's split-payment marketplace product. Direct processing
and Craftbid-held funds need the licensing in section 3. Plain payment links
with manual payouts are the Craftbid-held model in disguise: the money still
lands with Craftbid and leaves again by hand. A plain gateway without
sub-accounts has the same problem. Postponing custody entirely is the correct
state **until** the provider integration and registrations exist.

### Q3. What provider capabilities are required?

Sub-accounts per artist with provider-run KYC; per-payment split with a
platform fee; delayed or conditional settlement (for holding until
acceptance); full and partial refunds of split payments with defined
reversal of each party's share; GCash, Maya, QR Ph and card acceptance;
signed webhooks with event IDs; idempotency keys on create calls; payout to
the artist's own bank or e-wallet; a sandbox; and reports that support the
BIR withholding in Q15. Xendit xenPlatform (managed and owned sub-accounts,
split rules, "automatically enabled for Indonesia and Philippines") and
PayMongo Platforms (sub-accounts, integrated KYC, delayed splits, BSP EMI
licence) both advertise these. **Depends**: verify each one in the sandbox.

### Q4. Does Craftbid risk becoming a regulated intermediary if it receives and remits money?

Yes. See section 3: it is squarely what Circular No. 1198 calls merchant
acquisition (**Likely**), and processing payments on behalf of others is an
operator function under Circular No. 1049 (**Confirmed** definition). The
provider model is designed so that Craftbid never receives the artist's
money. **Confirm** Craftbid's classification with the provider and counsel,
including whether the BSP expects the platform itself to register as an
operator when a licensed provider does the processing.

### Q5. What licensing, registration and compliance issues must be checked before launch?

**Confirmed** as applicable in any model: business registration (DTI for a
sole proprietorship or SEC for a corporation), BIR registration including for
online business (RMC 60-2020), invoicing under the Ease of Paying Taxes Act
(RR 7-2024), the Data Privacy Act, and the Internet Transactions Act.
**Confirm**: whether Craftbid must register as an operator of a payment system
even without holding funds; whether it is a covered person under the
Anti-Money Laundering Act (the BSP's own FAQ says the extent of AML
applicability to operators "will be discussed with the AMLCS"); whether NPC
registration of data processing systems is triggered (Q6); and local
business permits.

### Q6. What identity or KYC information would need to be collected?

As little as possible by Craftbid. With managed sub-accounts, the artist
submits identity documents, tax number and payout details **directly to the
provider** through the provider's invite link, and Craftbid stores only the
provider's account ID and verification status. This matters: government-issued
ID numbers are sensitive personal information under the Data Privacy Act, and
NPC Circular 2022-04 makes registration of data processing systems mandatory
for anyone processing sensitive personal information of 1,000 or more
individuals (**Confirmed**). Separately, the Internet Transactions Act requires
platforms, "as far as practicable", to collect online merchants' identity,
address and contact details and keep a verified list (**Confirmed**), which
applies to Craftbid's artists whether or not payments exist.

### Q7. What happens if a client disputes a commission?

Two layers. The provider handles card chargebacks and e-wallet disputes under
its own rules and the card networks'. Craftbid needs its own dispute record
and a written policy: a `commission_disputes` table (below), a freeze on
release while a dispute is open, a response window for the artist, and a
decision by a named person at Craftbid. The Internet Transactions Act has the
DTI provide an online dispute resolution platform for consumers, merchants
and platforms, which can be referenced in the terms as an escalation route
(**Confirmed** the platform is mandated; **Confirm** its current availability).

### Q8. What happens if an artist does not deliver?

With holding: the client opens a dispute before release; if the artist does not
respond or cannot show delivery by the deadline, Craftbid instructs a full
refund through the provider. Without holding (pay on acceptance), the client
never paid. Either way, non-delivery becomes a permanent part of the
commission record and the review system.

### Q9. What happens if a client says the work is unacceptable?

This is the hard case and needs policy before code. Proposed: the terms define
acceptance against the request and the artist's bid message; the client must
say what is wrong within the review window; the artist gets one revision
round; after that Craftbid decides full release, partial refund, or full
refund. Partial refunds require the provider to support partial reversal of a
split payment (**Depends**). Handmade work is judged partly on taste, so the
policy should be explicit that "I changed my mind" is not grounds for a refund
once work has started.

### Q10. Who technically holds the money?

The licensed provider, recorded against the artist's sub-account, from the
moment the client pays until settlement or refund. Craftbid's own account only
ever receives Craftbid's fee. Nothing in Craftbid's database represents a
balance of real money.

### Q11. Who performs refunds?

The provider executes them. Craftbid initiates them through the provider's API,
only in response to a recorded decision (a cancellation before work, or a
dispute outcome), and the refund is confirmed only by the provider's webhook.
Two consequences to design for. First, a refund after the artist's share has
been released means recovering money from the artist, which a provider may not
do for you, so disputes must be raised and decided **before** release, and the
release rule must leave time for that. Second, providers commonly keep their
processing fee on a refund; the policy has to say who absorbs it (recommended:
Craftbid, out of its fee, for refunds that are not the client's fault).
Refund speed differs by method (e-wallet versus card), so the client is told
the expected timing at the moment of refund.

### Q12. Who performs payouts?

The provider, to the bank or e-wallet the artist registered with the provider.
Craftbid never sees or stores the artist's account number, and changing it
happens only inside the provider's verified flow, so a stolen Craftbid login
cannot redirect an artist's earnings. The amount paid out is the artist's
share less any tax the provider withholds under RR 16-2023 (Q15). A payout
that fails, for example to a closed account, stays with the provider and is
retried once the artist corrects the details there; Craftbid shows the status
from the provider's webhook and never re-sends money itself. Settlement timing
follows the provider's schedule and should be stated to artists up front.

### Q13. Who bears the payment processing fees?

A business decision; the model supports any answer. Recommended: the client
pays the agreed price and nothing on top, and processing fees come out of
Craftbid's platform fee, so the artist receives exactly the agreed price minus
one clearly stated percentage. That is the easiest arrangement to explain and
the hardest to resent. Note that xenPlatform in the Philippines also charges a
fee per active sub-account per month and a fee on in-house split transfers
(per Xendit's help centre; **Depends** on current pricing), which on small commissions can be a
large share of a thin margin. Model the fee against the provider's current
published pricing before choosing a percentage.

### Q14. How should Craftbid calculate its commission?

In integer centavos, as a percentage in basis points **copied onto the payment
record when the payment is created**, the same way the bid minimum is copied
onto the bid. A later fee change then cannot rewrite what a client already
agreed to pay. `fee = floor((agreed_price_centavos * fee_bps + 5000) / 10000)`,
`artist_net = agreed_price_centavos - fee`, computed on the server only; the
client never sends an amount or a fee. The same numbers are sent to the
provider as the split, and the provider's settlement report is reconciled
against them.

### Q15. How are taxes and accounting handled?

**Confirmed**: RR 16-2023 requires e-marketplace operators and digital financial
services providers to withhold 1% on one half of gross remittances to online
sellers once a seller's remittances pass ₱500,000 in a year, and the
platform's own fee is excluded from "gross remittance". If the provider
remits to artists, it is likely the provider that withholds; **Confirm** who
the withholding agent is in the chosen product. Craftbid's own income is its
platform fee, for which it issues invoices under RR 7-2024 and pays income
tax and, above the threshold, VAT. Artists remain responsible for their own
registration and taxes; Craftbid should say so plainly in the terms and link
to the BIR's guide for online sellers.

### Q16. What happens when an artist and client transact outside Craftbid?

Craftbid earns nothing and provides nothing: no payment protection, no dispute
handling, no record of the agreement beyond what already exists. That is the
honest trade to put in front of users. The commission and its review can still
exist, since reviews only need a completed commission, but the product should
show whether a commission was paid through Craftbid.

### Q17. How can the product discourage off-platform payment without pretending it can prevent it?

Make paying through Craftbid visibly better rather than making the alternative
impossible:

- **Protection that only exists on-platform**: money held until acceptance,
  a dispute process with a decision, and refunds that are enforced.
- **Records**: a receipt, the agreed scope, and the payment history on the
  commission page, which a Messenger thread does not give either side.
- **Reputation**: mark reviews from paid-through-Craftbid commissions as
  verified, and count them for artist rankings.
- **Fair fee**: low enough that splitting it is not worth the risk of paying a
  stranger in advance.
- **Artist protection**: the artist knows the money exists before starting.

Do not scan messages for phone numbers or block contact details. That is
surveillance, it is trivially evaded, and it would also punish the many
artists whose clients genuinely reach them on Messenger. The existing contact
links on profiles are the main route off-platform, and they are also a real
part of artists' livelihoods. The recommended step is to keep them public, and
when payments launch, show "Pay through Craftbid for buyer protection" at the
point of selection, which is where the decision is actually made.

---

## 6. Compliance summary

| Area | Status | What it means for Craftbid |
|---|---|---|
| RA 11127 and Circular 1049: operators of payment systems must register with BSP | Confirmed rule; Craftbid's status **Confirm** | Stay outside the definition by never processing payments for others |
| Circular 1198: merchant acquisition needs a licence, ₱5M minimum capital | Confirmed | The reason not to collect and remit |
| E-money and wallets are separately licensed | Likely (BSP FAQ points to Circular 649) | No stored balances |
| Anti-money laundering coverage | **Confirm** with AMLC | Provider does KYC; Craftbid keeps records |
| RA 10173 and NPC: breach notice to NPC and data subjects within 72 hours | Confirmed | Needs a written breach procedure before payments |
| NPC Circular 2022-04: registration at 1,000+ subjects' sensitive data | Confirmed | Avoid holding IDs; let the provider hold them |
| RA 11967 and IRR: verify and list online merchants | Confirmed | Applies now, independent of payments |
| RA 11967: platform liability after notice | Confirmed | A takedown process is needed |
| RR 16-2023: 1% of half of remittances over ₱500k | Confirmed rule; withholding agent **Depends** | Confirm with the provider |
| RMC 60-2020 and RR 7-2024: registration and invoices | Confirmed | Craftbid invoices its platform fee |
| Privacy notice, terms of service, refund policy | Likely required under RA 10173 and RA 11967 | Draft with counsel |

---

## 7. Proposed data model (design only, not migrated)

Follows the existing conventions: `RAW(16)` ids, integer centavos, rules as
database constraints, and every state change validated in a service.

```sql
CREATE TABLE commission_payments (
  id                     RAW(16)            NOT NULL,
  commission_id          RAW(16)            NOT NULL,
  provider               VARCHAR2(20 CHAR)  NOT NULL,   -- 'paymongo' | 'xendit'
  provider_payment_ref   VARCHAR2(100 CHAR),            -- set from the provider, never the client
  amount_centavos        NUMBER(12)         NOT NULL,   -- equals agreed_price_centavos
  platform_fee_bps       NUMBER(5)          NOT NULL,   -- copied at creation
  platform_fee_centavos  NUMBER(12)         NOT NULL,
  artist_net_centavos    NUMBER(12)         NOT NULL,
  currency               CHAR(3 CHAR)       DEFAULT 'PHP' NOT NULL,
  status                 VARCHAR2(20 CHAR)  DEFAULT 'created' NOT NULL,
  idempotency_key        VARCHAR2(64 CHAR)  NOT NULL,
  paid_at                TIMESTAMP WITH TIME ZONE,
  released_at            TIMESTAMP WITH TIME ZONE,
  refunded_centavos      NUMBER(12)         DEFAULT 0 NOT NULL,
  CONSTRAINT ck_cp_split CHECK (platform_fee_centavos + artist_net_centavos = amount_centavos),
  CONSTRAINT ck_cp_refund CHECK (refunded_centavos BETWEEN 0 AND amount_centavos),
  CONSTRAINT ck_cp_status CHECK (status IN
    ('created','pending','paid','held','released','settled','refunded','partially_refunded','failed','disputed')),
  CONSTRAINT uq_cp_provider_ref UNIQUE (provider, provider_payment_ref),
  CONSTRAINT uq_cp_idempotency UNIQUE (idempotency_key)
);
-- At most one live payment per commission: a partial unique index, as for accepted bids.

CREATE TABLE payment_events (             -- every webhook, verbatim, once
  provider         VARCHAR2(20 CHAR)  NOT NULL,
  provider_event_id VARCHAR2(100 CHAR) NOT NULL,
  payment_id       RAW(16),
  type             VARCHAR2(60 CHAR)  NOT NULL,
  payload          CLOB               NOT NULL,       -- no card data is ever in it
  received_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  processed_at     TIMESTAMP WITH TIME ZONE,
  CONSTRAINT pk_payment_events PRIMARY KEY (provider, provider_event_id)  -- replay = duplicate key
);

CREATE TABLE commission_disputes ( ... opened_by, reason, status, decision, decided_by, amounts ... );
CREATE TABLE artist_payout_accounts (  -- provider sub-account id + verification status ONLY
  artist_id, provider, provider_account_ref, kyc_status, updated_at );
```

State changes: `created -> pending -> paid -> held -> released -> settled`,
with `refunded`, `partially_refunded`, `failed` and `disputed` reachable only
from the states that allow them, enforced in the service and backed by a
`CHECK` on the pair where Oracle allows it. Only a verified webhook moves a
payment to `paid`, `settled` or `refunded`.

---

## 8. Security requirements for the payment phase

- **Amounts come from the database, never the request.** The server computes
  amount, fee and net from `agreed_price_centavos` and the stored fee; the
  client sends only the commission id.
- **Webhook authenticity**: verify the provider's signature on the raw body
  with a constant-time comparison, and reject stale timestamps.
- **Replay and idempotency**: `payment_events` is keyed by the provider's event
  id, so a replay is a duplicate-key no-op. State transitions are idempotent.
- **Reference spoofing**: a webhook's payment reference must match a row
  Craftbid created, and the amount and currency must match that row.
- **Authorisation**: only the commission's client can start a payment; only
  the client can accept; only Craftbid staff can decide a dispute; payout
  details can only be changed through the provider's own verified flow.
- **No card data, ever**: the provider's hosted checkout takes it. Craftbid
  stays out of PCI DSS scope beyond the self-assessment for hosted checkout.
- **Secrets** only in the environment, as today. **Logs** never include
  payloads with personal data, tokens or signatures; the existing log
  redaction list is extended.
- **Test mode**: sandbox keys only in development and CI; a startup check
  refuses live keys outside production, like the existing ImageKit key check.

---

## 9. What not to build yet

- No Craftbid wallet, balance, credit or "earnings" figure that implies money.
- No collection into a Craftbid bank, GCash or Maya account, including through
  payment links, for later manual payout.
- No collection or storage of card numbers, CVVs, bank or e-wallet
  credentials, or government ID images.
- No payment status that a client or artist can set.
- No migration of the tables above until a provider is chosen and its sandbox
  confirms the model, because provider capabilities decide the states.
- No change to how bids, selection or the agreed price work today.

---

## 10. Next phase and what it needs

**Business prerequisites (client):**
1. Register the business (DTI or SEC) and with BIR; decide who the contracting
   entity is. Providers onboard businesses, not individuals, for platforms.
2. Terms of service, refund and dispute policy, and privacy notice, reviewed by
   Philippine counsel.
3. Written confirmation from counsel or the provider of Craftbid's role under
   Circulars 1049 and 1198, and on AML coverage.
4. A named person accountable for data protection, and a breach procedure that
   meets the 72-hour rule.

**Provider selection:**
5. Open sandbox accounts with PayMongo and Xendit. For each, confirm in the
   sandbox: managed sub-accounts with provider-run KYC, split with a platform
   fee, delayed release and its maximum hold, partial refunds of a split,
   webhook signatures, and who withholds under RR 16-2023.
6. Model fees at realistic commission sizes (₱1,500 to ₱10,000) including
   per-sub-account monthly fees.

**Build (after 1 to 6):**
7. Migrate the tables in section 7; implement payment intents, webhooks and
   release behind a feature flag, off by default.
8. Artist onboarding via the provider's invite link; store the provider
   account id and KYC status only.
9. Dispute workflow and staff decision screen.
10. Pilot with a small group of consenting artists in live mode, then open up.

**Credentials needed from the client at that point:** provider sandbox API keys,
webhook signing secret, and later live keys, all set as environment variables on
Render, never committed.

---

## Sources

Bangko Sentral ng Pilipinas
- [Republic Act No. 11127, National Payment Systems Act](https://www.bsp.gov.ph/PaymentAndSettlement/RA11127.pdf)
- [Circular No. 1049 (2019): registration of operators of payment systems](https://www.bsp.gov.ph/Regulations/Issuances/2019/c1049.pdf)
- [FAQs on Registration of Operators of Payment Systems](https://www.bsp.gov.ph/PaymentAndSettlement/FAQ_OPS_Registration.pdf)
- [Circular No. 1198 (2024): merchant payment acceptance activities](https://www.bsp.gov.ph/Regulations/Issuances/2024/1198.pdf)
- [FAQ on Circular No. 1198](https://www.bsp.gov.ph/Regulations/Issuances/2024/1198%20-%20FAQ.pdf)
- [BSP media release on the MPAA framework](https://www.bsp.gov.ph/SitePages/MediaAndResearch/MediaDisp.aspx?ItemId=7210)
- [Manual of Regulations for Payment Systems](https://www.bsp.gov.ph/Regulations/MORPS/MORPS.pdf)

National Privacy Commission
- [NPC Circular 16-03: personal data breach management](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf)
- [NPC Circular 2022-04: registration of data processing systems](https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04-1.pdf)
- [Exercising breach reporting procedures](https://privacy.gov.ph/exercising-breach-reporting-procedures/)

Department of Trade and Industry and the statute
- [Republic Act No. 11967, Internet Transactions Act of 2023 (LawPhil)](https://www.lawphil.net/statutes/repacts/ra2023/ra_11967_2023.html)
- [DTI E-Commerce Bureau: RA 11967](https://ecommerce.dti.gov.ph/ra11967/)
- [DTI E-Commerce Bureau: Implementing Rules and Regulations](https://ecommerce.dti.gov.ph/implementing-rules-and-regulations/)

Bureau of Internal Revenue
- [Revenue Regulations No. 16-2023](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%2016-2023.pdf)
- [Press release: e-marketplace withholding from 15 July 2024](https://bir-cdn.bir.gov.ph/BIR/pdf/PR41JUL1624.pdf)
- [RMC No. 60-2020: registration of online businesses](https://bir-cdn.bir.gov.ph/local/pdf/RMC%20No.%2060-2020_copy.pdf)
- [Revenue Regulations No. 7-2024: invoicing under the Ease of Paying Taxes Act](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%207-2024%20(final).pdf)
- [Taxpayer's guide for online sellers](https://bir-cdn.bir.gov.ph/BIR/pdf/TAXPAYERS%20GUIDE%20FOR%20ONLINE%20SELLERS.pdf)

Providers (capabilities as advertised; verify in sandbox)
- [Xendit xenPlatform](https://www.xendit.co/en-ph/products/xenplatform/), [sub-account types](https://docs.xendit.co/docs/sub-accounts), [managed vs owned](https://help.xendit.co/hc/en-us/articles/6787784288665-What-is-the-difference-between-managed-and-owned-sub-accounts), [xenPlatform fees](https://help.xendit.co/hc/en-us/articles/4413990486041-How-Much-is-XenPlatform-Fee)
- [PayMongo Platforms](https://www.paymongo.com/products/platform)

Accessed September 2026. Regulations change; re-check each source before launch.
