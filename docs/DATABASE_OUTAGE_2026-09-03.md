# Database availability incident — September 3, 2026

## Production evidence

At approximately 10:18–10:20 Eastern, `/api/system-health` returned no bytes
within 25 seconds. Sanitized Vercel errors showed Supabase upstream HTTP 522
responses for the signals feed, opportunities and opportunity ledger. The
owner also reported that SQL Editor could not connect. CoinAPI collector
attempts failed at the initial database-maintenance step, before provider calls.

This establishes an unavailable application database path, not its precise
resource/root cause. No authenticated database metrics or working SQL connection
are available to this task. CPU, memory, disk I/O, connection pressure and
long-running work remain to be distinguished. Do not attribute the outage to
CoinAPI credits or assert that an unrelated public JWT incident caused it.

## Narrow outage-amplification repair

The health handler previously continued into other database checks after a
failed read. It now performs one small read with an eight-second deadline and
aborts that request on timeout. Failure returns HTTP 503, `ok: false`,
`auditComplete: false`, and explicit unverified systems. It performs no further
database checks or entitlement probes on that failed path. A successful read
continues into every original health criterion; connectivity alone is never
reported as full health. This only bounds an outage detected at the initial
read; it does not yet bound all subsequent audit queries or other application
routes, and it is not a repair of the underlying database outage.

No schema, scoring, execution mode, stock price logic, budget, collector cadence,
archive policy, position management or original evidence was changed. The
owner-confirmed one-time allowance remains 1,000 total with 900 reserved at
the last successful owner query. No new paid validation calls were initiated.
No database restart, job suspension or paid resource upgrade was performed.

## Verification

- 420 main and focused boundary tests passed, including actual health-handler
  failure tests and preserved crypto/ProX health-criteria regression tests.
- TypeScript, focused lint and whitespace validation passed.
- Production webpack build passed. Local default Turbopack could not start its
  build worker because of a host process/port permission restriction, also on
  the escalated attempt. This is not evidence of a production build failure.
- Compared with `dpl_AfCvMAi8NiAJ2k57eAk95WnMWNmw`, 421 of 424 deployed source
  files were unchanged; differences were this health handler and two existing
  verification documents. Additional runtime code is only the small probe;
  tests and this incident report are non-runtime additions. iOS files remain
  excluded from Vercel deployment and untouched.

Deployed as `dpl_G3Zm46u5rSAfN7NTDZsfH5EHmaVo`, aliased to `gethtlabs.com`.
Vercel's default Turbopack production build passed. Before this result was added,
all 429 deployed source files matched the tested local source; none were missing.
The existing dirty Git tree remains preserved and uncommitted.

At 10:29:55 Eastern, production health returned HTTP 503 in 8.182 seconds:
`ok: false`, `auditComplete: false`, `database_connectivity` failed with
`reason: timeout` and an 8,002 ms read duration. All six dependent audit groups
were explicitly unverified. No CoinAPI requests were made by that health check.
The early-failure repair is verified in production; database recovery is NOT.
Do not call the app healthy or the approved CoinAPI test successful.
Full release acceptance still requires restored database service, fresh persisted
collection within the unchanged allowance, actual paper order-to-exit validation,
and finished shared cross-device price publication. Separate independent price
polling is not complete cross-device synchronization.
