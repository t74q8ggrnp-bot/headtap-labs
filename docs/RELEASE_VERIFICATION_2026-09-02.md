# Pre-iOS release verification — September 2, 2026

## Disposition: not signed off

**Follow-up:** the owner subsequently approved the closed-session repair. It is
implemented/tested locally, not deployed in this turn. See
[closed-session repair handoff](CLOSED_SESSION_REPAIR_2026-09-02.md) for the v5
contract, 8:47 PM production recheck and current crypto status. The audit below
describes the earlier deployed checkpoint; it is not a claim that v5 is live.

Read-only production audit; no application code, scoring, collection settings,
database contents, deployment, or execution controls were changed. This document
and the companion SELECT query are audit artifacts only.

### Exact production checkpoint

- Domain: https://gethtlabs.com
- Deployment: `dpl_Fvaktz3Qf9Em7PL852D5DFCTpM1S`
- Immutable deployment URL: https://headtap-labs-dfjgllwnj-nkzmhmtw4w-5153s-projects.vercel.app
- Created: September 2, 2026, 8:10:53 PM America/New_York.
- Vercel state: `READY`; target: `production`; source: `cli`.
- Reported Git base: `19fc3d30159bc37dacd08741426bdb7dba550ed8`.
- Branch: `rescue-build-passing`; deployment metadata: `gitDirty: "1"`.

The SHA is a base commit, NOT a commit containing the complete deployed release.
The deployment includes uncommitted/untracked work. The local workspace also
remains dirty. No clean, reproducible Git release checkpoint is confirmed.

## 1. Closed-session handling: confirmed defect, not repaired in this audit

Production health at 8:22:18 PM ET returned HTTP 500, `needs_attention`, 30/33
passing checks. The three failures remained canonical atomicity and the two
explicit legacy crypto quarantines.

The retained Canonical source run completed at 7:58:18 PM ET. At 8:22 PM, the
response still contained `scanSession: "after_hours"` and `freshnessLabel:
"Live Scan"`, although `displayQuoteLive` was correctly false. The wrapper's
processing timestamp was current (`ageSeconds: 0`), but `fresh` was false.

Cause verified in source and a frozen-clock reproduction:

- `lib/canonical-decision-frame-policy.ts:67` chooses active freshness rules from
  each record's saved scan session, not the current closed stock-market clock.
- `lib/canonical-opportunity.ts:826` derives the label from scan age alone;
  a scan under one hour old can say "Live Scan" after the market closes.
- `app/api/system-health/route.ts:2110` unconditionally requires frame freshness
  even when the current-session coverage checks recognize that trading is closed.
- `lib/canonical-decision-frame.ts` can show a new processing-time expiry beside
  `fresh: false` when the provider-timing check supplies no expiry.

The LHAI source timestamps were 7:57:43/7:58 PM, so this defect reproduces even
without ATER's additional Canonical/ProX timestamp mismatch (7:48 PM vs 3:58 PM).
That mismatch must remain visible; closing the session does not repair it.

Required correction, not implemented: distinguish retained last-session display
from currently actionable evidence. Preserve provider times and source-run/date,
label both desktop/mobile retained data explicitly, and report current session
separately from saved scan session. Health should validate retained-session
integrity without calling old prices live or authorizing Agent entries. Preserve
the active-session five-minute source-age and two-minute alignment requirements.
Do not simply set `fresh: true`, alter saved timestamps, or extend timeouts.

## 2. CoinAPI: deployed research is not a public-feed conversion

- At 8:24:59 PM ET both `/api/crypto/coinapi-research` and
  `/api/crypto/coinapi-evaluation` returned HTTP 401 to unsigned requests. Routes
  and their authentication boundary exist; authenticated success is NOT verified.
- Vercel project settings AND this deployment's environment-key list contained
  neither `COINAPI_PILOT_ENABLED` nor `COINAPI_API_KEY`. The collector's environment
  gate therefore disables this CoinAPI collection path before maintenance,
  database claims, or provider calls. The collector endpoint was not invoked.
- Follow-up: the owner supplied the JSON result of the read-only Supabase query.
  It confirms the queried 0035/0036 database objects, not just code defaults:
  collection is disabled in the database, caps are 300 credits per UTC day and
  900 lifetime, both reservation counters are zero, `blocked_reason` and
  `latest_cycle_id` are null, and `credit_day` is `2026-09-03` (UTC).
  Zero pilot reservations are not a statement about total CoinAPI account billing.
- No usable authenticated research credential was available to this audit.
  Vercel marks the relevant server secrets sensitive; these are deliberately
  non-readable after creation ([Vercel documentation](https://vercel.com/docs/environment-variables/sensitive-environment-variables)).
  No authentication was bypassed and no secret was printed or requested in chat.
- The public crypto opportunity route still reads the legacy materialized feed
  and its Coinbase-backed fallback. Crypto display quotes still have the Massive
  route. Desktop/mobile/iOS/Agent have NOT completed a CoinAPI-only public cutover.
- No CoinAPI collection, paid provider request, budget increase, or crypto order
  was initiated by this audit.

The result of `tools/verify-crypto-release-readonly.sql` was supplied by the
owner; no repeat query is needed for these values. The maintenance function is
installed and all three expected triggers report enabled mode `O` (normal
origin execution). The research view reports zero books, episodes, observed,
pending, overdue, unavailable, or quarantined horizons, with execution and
profitability flags false. Empty research evidence is consistent with disabled
collection, not proof of a functioning live collector or profitable research.
This confirms the queried schema objects and configuration from the supplied
database result; it does not independently test production trigger behavior or
successful authenticated HTTP reads. Those reads remain unverified.

## 3. Legacy crypto outcomes: quarantine remains honest

The 8:20:23 PM ET production receipt reported zero legacy outcome updates and
zero unavailable-outcome rewrites. Both health records explicitly returned
`evaluationEligible: false`, `historicalPricesReconstructed: false`, and
`crypto-outcome-integrity-v2`. Their old overdue counts were 10 and 57; these
were not cleared using present-day prices.

Source inspection found no remaining old outcome backfill writers. The research
comparison rejects legacy sources; the new evaluation reader uses the separate
verified CoinAPI view and leaves net performance/improvement claims null. Local
SQL tests verified preservation of original values, write rejection, and no
same-symbol/different-venue or late-current-price substitution. The owner's
follow-up database result confirms both legacy source policies have
`evaluation_allowed: false`, version `crypto-outcome-integrity-v2`, and both
legacy write guards are installed and enabled. No production backfill or
destructive write test was performed. Zero quarantined horizons in the NEW
CoinAPI research view does not rehabilitate the separate legacy history.

## Dual-lane HT Agent fix: confirmed live

The production Agent check passed. Its 8:22 PM run was successful in `observe`
mode, with zero decisions/orders in that cycle. Diagnostics explicitly contained:

- `ht-agent-stock-universe-v2-dual-lane`;
- both `momentum` and `before_crowd` lanes;
- a six-candidate per-lane limit and independent source-run/timestamp receipts;
- both lanes withheld as stale rather than borrowed across strategies;
- `paper_only: true`; `liveBrokerage: false`.

The existing fix is present; this does not mean retained closed-session evidence
should become a new-entry trigger. Local tests confirm same-lane proposal
revalidation, duplicate handling, and independent lane failures.

## Verification performed

80 focused local tests passed: 63 frame/display/CoinAPI/dual-lane tests, six
CoinAPI server-boundary tests, and 11 isolated PostgreSQL evidence tests. The
8:14 PM frozen-clock reproduction confirmed the closed-session defect. No new
full build, deployment, broker test, or production database write was performed.

Before iOS sign-off: repair the closed-session contract, verify successful
authenticated research/evaluation API reads, then checkpoint the reviewed intended source changes in a
clean commit and verify the subsequent deployment against that commit. Keep
legacy quarantine warnings explicit; they are not evidence of a provider outage
and must not be converted into profitability claims.
