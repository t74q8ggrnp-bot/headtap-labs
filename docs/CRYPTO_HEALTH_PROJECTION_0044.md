# Crypto health read performance — September 3, 2026

## Confirmed production state before 0044

- All 199,859 preserved legacy rows audited: 54,240 ProX, 145,619 discovery.
  Missing audits, mismatched fingerprints, reviews and new legacy deadlines: zero.
  All original exclusions and protections remain in place.
- `2026-09-03T05:21:29.721Z`: full health returned `ok: true`, 37/37.
- `2026-09-03T05:23:06.000Z`: verification again failed with SQL timeout 57014.
  The earlier green response is not proof of sustained reliability.
- Fixed, read-only component probes: archive readiness exceeded 8,005 ms;
  its tracking summary exceeded 8,007 ms. New ledger 602 ms; accounting 280 ms;
  publication pointer 268 ms; latest attempt 153 ms. No provider requests.
- Four later collector logs showed successful collection, 1,396–2,868 ms
  publication, three accounted requests/cycle and healthy paper matching.
  Paper ledger has two fills, zero open/overdue orders and zero reconciliation
  mismatches. No additional production orders were submitted.

## SQL 0044

Adds two covering indexes for only the scalar tracking fields. Aggregates each
source before joining its source policy, then refreshes planner statistics after
the completed fingerprint drain. No packet rehashing, batch work, deleted data,
provider calls, budget changes or modified health criteria. Counts are exhaustive
live reads, not a cached success or estimate. All old missing-price information
remains visible and excluded from performance claims.

The application timing fix separately keeps the 90-second evidence wait and adds
the owner-approved 60-second processing allowance. Public health and authenticated
evaluation use the same indexed oldest-pending read. Quote/trade freshness and
exact horizon-price selection are unchanged; overdue processing still fails.

## Verification

- 322/322 core tests; 34/34 focused route/server tests.
- 13/13 isolated PostgreSQL integrity tests including 0044 reapplication, source
  mutation/deletion, disabled guards, missing audits and provider-time math.
- Isolated 200,000-row PostgreSQL fixture, 64 KB working memory: full health
  610 ms before 0044 and 525 ms after; complete archive output identical.
  Index/view/statistics migration 487 ms. Paper buy → sell → closed and
  reconciliation passed with that archive present. These are local measurements,
  not a production latency guarantee; the production plan must still be verified.
- Local production build, TypeScript, focused ESLint and whitespace checks passed.

## Post-application production verification

The owner reported SQL 0044 completed successfully on September 3. Two subsequent
read-only production health checks returned complete results without a SQL timeout:

| Health timestamp (UTC) | Full request duration | Result |
| --- | --- | --- |
| 2026-09-03T10:59:54.104Z | 30,172 ms | 36/37; CoinAPI collection only |
| 2026-09-03T11:02:37.940Z | 24,432 ms | 36/37; CoinAPI collection only |

Both confirmed every preserved legacy row audited, zero evidence mismatches or
missing audits, exclusions intact, valid CoinAPI outcome accounting, and manual
paper reconciliation with two fills, no open/overdue orders and no mismatches.
Stock Canonical, ProX and stock Paper Trading checks also passed. These are two
successful database reads, not a guarantee against every future timeout.

The remaining failure is a collection-budget pause. Both configured daily and
lifetime allowances are 900 request credits, with 900 reserved. Latest provider
request: 2026-09-03T08:36:30.442326Z; latest published decision:
2026-09-03T08:35:30.970Z. Recent collector logs independently report
`paused / credit_budget_reached`, zero provider requests and a healthy paper
matcher. The feed is stale and is not safe to represent as currently live.
The last pre-pause attempt remains recorded as failed; that history was not reset.

No new deployment is needed for SQL 0044. The checked application deployment is
`dpl_6HBuiCDVjERgaC1t5J4N5jURdvj6` at https://gethtlabs.com. No new production
trades, cap changes or provider requests were initiated by this verification.
Full health remains `needs_attention` until authorized collection can resume and
fresh evidence is verified. Raising the cap needs separate owner approval; the
900-credit lifetime ceiling does not reset with the next day. No current dollar
balance or account-specific charged rate was verified by these health reads.

Temporary read-timing probes were removed from the final application source
after collecting the measurements. The 900 daily/900 lifetime request cap remains
as explicitly approved; no further spending authority was added.
