# Crypto database reliability repair — 0042

## Approved outcome-processing deadline follow-up — September 3

The owner approved distinguishing the existing 90-second evidence wait from
one 60-second scheduled processing cycle. The health endpoint now reads the
indexed oldest pending outcome target, independently of its evidence snapshot,
and reports both clocks. A pending outcome older than 150 seconds fails; a
failed, malformed, future-dated or stale operational read also fails. Older
callers without the new operational proof retain their stricter 90-second check.
Provider quote/trade freshness, exact horizon-price windows, outcome arithmetic,
missing evidence, scoring and execution policies are unchanged. This is an
application-only read; no new migration, provider request or balance change.
The authenticated evaluation endpoint uses the same operational read and policy
as public system health; neither mobile nor desktop gets a different deadline.

Verification before deployment: 322/322 core tests; focused deadline/read tests
cover exact 90s and 150s boundaries, missed deadlines, unknown reads, unchanged
price freshness and unchanged outcome-integrity checks. Focused ESLint and local
production Webpack/TypeScript/prerender build passed. Production archive-worker
logs now report a drained queue on three consecutive cycles, after processing
the final 1,359 records. Full-health verification remains required; a previous
evidence snapshot timed out and must not be reported as a successful check.

## Scope

No stock, scoring, ProX authority, Agent, iOS implementation, execution-policy,
provider-cadence, allowance or account-balance changes. Crypto remains manual
paper-only; the public crypto feed is not converted by this repair.

## Repair

- Archive processing moves from the collector to the authenticated,
  production-only `/api/crypto/evidence-maintenance` job. The one-minute CoinAPI
  collector still matches existing user-created orders after publication.
- Archive work is serialized by a transaction advisory lock and bounded by small
  commits, a six-second SQL deadline and a short worker budget. An overlapping
  worker is reported as busy, not incorrectly reported as a drained archive.
- Historical source hashes are actually computed during bounded verification,
  not copied from old audit records. An independent database trigger maintains
  source hashes transactionally if a source changes. The application cannot
  write fingerprints. Health compares every source/audit pair using these
  protected hashes instead of repeatedly serializing large historical packets.
  Missing fingerprints/audits, source deletions, altered evidence, disabled
  guards and unsafe permissions still fail. Original audit hashes and records
  are never rewritten. Verification progress is not verified price provenance.
- Quote publication extracts the broad snapshot arrays once and resolves the
  relevant research-market set once instead of repeating extraction and lookup
  for every market. Evidence clocks, trade/book alignment, horizon selection,
  outcomes and paper-fill conditions remain unchanged.
- Collector logs now include publication duration and total collection duration
  so production improvement can be measured rather than inferred.

The database owner remains trusted: disabling **all** independent safeguards and
rewriting their functions/tables is outside application permissions. Existing
quarantined records remain excluded from training and performance claims.

## Measured local evidence (not production)

Isolated PostgreSQL; 200,000 synthetic archive rows, 4 KB packets, 1,675 markets:

| Operation | Before | After |
| --- | ---: | ---: |
| Complete evidence health query | 7,864 ms | 619 ms |
| Market publication | 203 ms | 23 ms |
| Next market publication | — | 19 ms |
| Paper ledger reconciliation | — | 1 ms |

The complete archive result before/after is identical. Initial fingerprint
verification took 37.1 seconds over multiple isolated bulk transactions; this is
one-time work, not a production drain-time guarantee. The scheduled worker uses
smaller batches. Until verified, those records remain red rather than silently
accepted. The same large-archive fixture completed a paper buy → sell → full
close and reconciled account, positions, orders and audit events without manual
fills. No provider request or real money was used by these tests.

## Rollout

Apply `supabase/migrations/0042_crypto_database_reliability.sql` in Supabase,
then deploy the application. Existing balances/history and reserved credits are
preserved. Verify actual archive progress, collector publication timings, paper
ledger reconciliation and the full production health response. An `ok` reply to
the migration instructions is not proof of database application. Production
completion must be confirmed from its actual responses/logs.

Automated results and deployment verification will be appended below.

## Production verification and archive follow-up

Application deployed READY as `dpl_5P5xafDVddDXhtzAc9C11XoEU7xe`, aliased to
`https://gethtlabs.com`, September 3, 2026. Remote Turbopack build, TypeScript and
prerender passed. Local core: 317/317; route/server/health tests: 31/31; real
PostgreSQL paper-ledger tests: 28/28; timeout recovery: 26/26. No stock, Agent,
scoring or iOS implementation differed from the prior deployed source.

Production publication durations observed: 1,399 ms, 1,722 ms and 2,153 ms, with
three accounted CoinAPI requests per cycle and paper matcher healthy. Public
health independently showed one paper account, two fills, zero open/overdue
orders and zero account/position/order/audit mismatches. No additional production
trade was submitted for this repair.

The independent archive task still hit SQL timeout 57014 at 6.25 seconds after
0042. Do not call this resolved from the initial local benchmark. Follow-up
`0043_crypto_archive_queue.sql` replaces its repeated pending-ID search with a
private indexed queue, seeded once using source IDs only. Each batch locks only
its next queued IDs, hashes their actual source evidence, inserts missing audits
and removes completed queue entries in one transaction. Original history and
audit hashes are never deleted or rewritten. Failed transactions preserve the
queue; removed verification records are requeued; app roles cannot edit it.

Follow-up tests: 13/13 real PostgreSQL audit/integrity tests. At 200,000 rows and
64 KB PostgreSQL working memory, queue seeding took 1,974 ms, maximum 500-record
batch 94 ms, complete fingerprint drain 32.53 seconds across 400 local batches,
health 562 ms and publication 20 ms. Before health/publication on the same fixture:
7,605 ms / 188 ms. The full paper lifecycle still passed. These are local timings,
not a production drain promise. SQL 0043 needs application and live verification;
the already-deployed worker calls the same RPC, so no further app deployment is
required for this SQL-only follow-up.

Vercel environment-run does not export the sensitive production server key or
cron secret into this local session. Database-owner DDL remains via the owner's
Supabase SQL editor; secrets were not printed, copied or exposed to work around
that restriction. No allowance was increased or reset.

## After owner-reported SQL success

Owner reported Success for the SQL follow-up. Live maintenance logs subsequently
showed successful 3,500- and 2,500-record runs in 5.0–5.4 seconds with zero provider
requests. The collector independently published 147 aligned quotes in 2,240 ms,
scored one research candidate and reported a healthy paper matcher. This is
observed recovery, not proof that the archive is fully drained.

Full health at `2026-09-03T04:52:35.998Z` remained `ok: false`. CoinAPI collection,
new provider-time outcomes and manual paper ledger passed. The three failed
checks were the archive audit and its two legacy-source dependent checks.
Discovery still had 29,119 missing audits and 99,000 pending/mismatched source
fingerprints; legacy ProX had 54,240 missing audits. Records remain excluded from
evaluation, with all guards enabled. No prices were substituted and no existing
audit hash was rewritten. Fresh outcome overdue count was zero; paper had two
fills, no open/overdue orders and no accounting discrepancies.

The same response reported 252 of 300 daily reserved request credits and 252 of
900 lifetime credits. At the measured three credits per minute, only about 16
minutes of collection remained at that timestamp. These are request credits,
not dollars. The existing cap will pause provider collection unless the owner
approves a budget change; archive maintenance continues independently and uses
no CoinAPI credits. No further application deployment is required for SQL 0043.

## Throughput correction and explicit owner budget approval

The separate worker still inherited a five-second work budget from its former
collector coupling. This unnecessarily limited production cleanup to roughly
2,500–3,500 records/minute after SQL 0043 had fixed the slow selection query.
The worker now starts batches for up to 20 seconds, at most 40 serial batches of
500. Each call still has its 8-second transport deadline and SQL timeout/lock
limits. The route retains its 30-second maximum; no parallel writers, provider
requests, larger SQL transactions or health-criteria changes were introduced.

Production release `dpl_BcdckpK73xJvnVhhmtJebVx2hvDT` processed 10,000 in its
first run. Subsequent release `dpl_FGGW1f3WqK2ee2pc9KjBoqQhV8UN` processed
14,000 in 20.7 seconds while publication completed in 1,987 ms and paper matching
passed. The full audit at `2026-09-03T05:05:26.383Z` returned normally with only
the three archive-dependent checks red; it was not a global pass. An earlier
55-second client deadline expired, so production checks need sufficient time to
complete the existing whole-app audit; incomplete responses are not passes.

The owner explicitly approved raising today's daily request allowance from 300
to 900 while keeping the existing 900 lifetime ceiling. Release
`dpl_FGGW1f3WqK2ee2pc9KjBoqQhV8UN` applied a date-restricted, production-only
compare-and-set through the existing service-role permission. Its successful
scheduled-run log confirms the change, no counter reset and zero provider
requests for the configuration operation. No funds, recharge, account
enablement, holds or execution permissions changed. The one-time updater is
removed from the final application source after its confirmed success, so later
owner budget changes cannot be overwritten by a recurring repair hook.

Final focused route/server/health suite: 33/33, including worker time limits,
partial progress on failure, concurrent-worker handling and no recurring budget
update. Core suite: 317/317. Local production build and TypeScript pass. Further
production health results and final release will be recorded after verification.
