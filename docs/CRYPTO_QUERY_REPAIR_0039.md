# Crypto archive-scale query repair — 0039

## Status

0039 was confirmed by the owner's read-only SQL result: audit indexes, bounded
audit, separate maintenance and the health RPC's 30-second setting are installed.
The original application release below is live; the smaller-batch follow-up is
being released with manual crypto paper trading (0040). Production is NOT healthy.

Latest production check: `2026-09-03T02:55:27.971Z`, 31/36 checks passing.
CoinAPI collection is paused for `unknown_provider_cost`: 142 reserved requests,
140 reported credits, one unknown cost, zero unsettled receipts. The last complete
publication is `02:48:30.971Z` (1,675 markets, 128 aligned at collection, one deeply
scored); it is correctly stale. Outcomes show one overdue horizon, zero invalid
or missing horizons, 1,819 saved books and 29 observed horizons. This remains
research evidence, not fills or profitability.
Hard failures: `crypto_legacy_evidence_audit`, `crypto_coinapi_collection`,
`crypto_coinapi_outcomes`, `crypto_prox_observation_pipeline`,
`crypto_multivenue_shadow_discovery`.
Archive remains at 20,000/199,859 audited. Repeated scheduled archive calls return
`ok:false` with `storage_unavailable` and no SQLSTATE; the exact cause is not yet
confirmed. A timeout is not proven by that generic diagnostic alone.
`tools/verify-crypto-0039-readonly.sql` verifies installed repair definitions and
indexes, and returns the exact uncertain request receipt without provider calls.
Do not clear the cost block, invent a cost, or refund reservations without evidence.

## Proven failure

- Owner SQL snapshot (02:29:55 UTC September 3): 199,859 historical records,
  20,000 audited, 179,859 remaining. No original evidence has been deleted.
- Production health returned SQLSTATE `57014` (statement timeout).
- Scheduled collector failed at `maintenance` before claiming a collection cycle.
- 0038 put a large historical audit in the same transaction as live outcome
  resolution. A timeout rolled back both and prevented the next collection.
- CoinAPI was actually enabled, with known request costs and no accounting block.
  The old health fallback incorrectly described unknown states as disabled or
  invalid. Deployed diagnostics now keep unknown distinct from false.

## Repair

1. Select only pending IDs before loading/serializing saved packets; add indexes
   and refresh planner statistics. The audit decision/provenance rules do not change.
2. Join each source directly for exhaustive fingerprint checks. Use an explicit
   CASE so unaudited rows are counted, not needlessly serialized and hashed.
3. Commit live exact-time outcome resolution separately from historical auditing.
   The follow-up uses separate 500-record transactions, at most 20 per invocation,
   and stops starting new transactions after five seconds. Each RPC retains its
   eight-second deadline. Confirmed batches remain committed even if a later one
   fails. An archive error remains visible but cannot undo saved live data.
   Disabled/unauthenticated collectors do not run audits. No provider calls occur.
4. Keep every fingerprint, missing audit, review case, guard, deletion-permission,
   provider-time, publication-hash, request-cost and outcome-math check intact.
5. Allow only the exhaustive read-only health RPC up to 30 seconds at the DB API
   and 35 seconds at its client. Collection/reservation/receipt calls retain their
   8-second deadline. This changes query runtime allowance, not market freshness.
   [PostgREST function-setting documentation](https://postgrest.org/en/stable/references/transactions.html#hoisted-function-settings)
   documents the per-function setting; schema reload is included.

## Reproducible isolated scale test

`tools/benchmark-crypto-audit.mjs` creates a fresh isolated PostgreSQL database
with synthetic packets and makes no provider requests. A 200,000-row fixture:

| Operation | Original | Repaired |
| --- | ---: | ---: |
| First 2,000-row audit | 14.44 s | 0.34–0.37 s |
| Next 2,000-row audit | 7.03 s | 0.30–0.33 s |
| Partially audited snapshot | 2.42 s | 0.40 s |
| 20,000-row repair batches | — | 2.2–2.5 s |
| Fully audited 200,000-row snapshot | — | 5.83 s |

All 200,000 fixture rows were audited with zero missing audits and zero evidence
mismatches. These are local measurements, NOT promises about production speed.
The final exhaustive read still needs more than a short REST statement allowance.

## Apply and verify

Run `supabase/migrations/0039_crypto_audit_query_repair.sql`. No reset/deletion,
provider key change, credit counter change, budget increase or order is included.
Then confirm scheduled collections resume, archive counts increase, saved-book
outcomes resolve, and `/api/system-health` eventually has **zero failures**.
Drain time depends on actual completed batches and database load; do not promise
a fixed number of minutes from the maximum batch allowance.

Missing historical prices remain missing, and excluded legacy results remain
excluded from training and profitability claims even after the archive is fully
audited. Outcome gaps caused by the collection interruption may resolve as
unavailable; they must never be filled using a later current price.

## Release checkpoint

Application repair deployed to production and aliased to `https://gethtlabs.com`:
`dpl_J22kXS3S9DTRoBptLmQM9Rfyea1D`, READY.
Deployment URL: `https://headtap-labs-55jhi49cn-nkzmhmtw4w-5153s-projects.vercel.app`.
The default production Turbopack build and TypeScript passed. Application tests:
310/310; actual route/server boundary tests: 22/22; SQL migration/integrity tests
with 0039 applied: 9/9; focused lint and whitespace checks passed. The complete
synthetic 200,000-row archive was drained and verified with zero mismatches.

SQL 0039 is now confirmed; successful production archive drain remains outstanding.
The collector and outcome checks briefly recovered, then failed again following
an uncertain provider receipt. Next: verify the installed repair, inspect that
request, resolve its actual usage accounting, observe successful `legacyAudit`
receipts and increasing audit counts, then verify all 36 hard checks.
No new commit was created; Git HEAD remains
`19fc3d30159bc37dacd08741426bdb7dba550ed8` plus the preserved working-tree changes.
The worktree also contains prior unrelated changes; they must not be discarded
or indiscriminately committed. A read-only deployed-source hash comparison is
required before each release to confirm stock/UI/Agent changes are already live
and no new unrelated delta is included.

## Follow-up checkpoint (before 0040 application deployment)

At `2026-09-03T03:42:46.053Z`, production has four failures: archive audit,
CoinAPI collection, legacy ProX observation audit and multi-venue discovery audit.
The CoinAPI outcome check recovered; the feed itself remains paused on the same
unknown-cost STX receipt. Archive progress remains 20,000/199,859. Neither the
smaller-batch repair nor manual crypto paper trading was deployed at this check.
See `CRYPTO_MANUAL_PAPER_V1.md` for the subsequent release and limitations.
