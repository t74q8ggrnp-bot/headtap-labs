# Closed-session repair and crypto handoff — September 2, 2026

## Local repair; not a production sign-off

The stock fix is implemented locally. No deployment, Git commit/push, SQL write,
CoinAPI activation, budget change, or trading action was performed in this turn.
The workspace includes substantial earlier uncommitted/untracked work; this is
not yet the clean release checkpoint requested before the iOS conversion.

### Stock contract

- Rolling frame version: `rolling-canonical-decision-frame-v5-retained-session`.
- `decisionFrame.currentSession` describes the current stock clock, independently
  of each record's historical `scanSession`.
- Closed frames report `status: "last_session"` only when retained integrity
  passes. They keep `fresh: false` and `freshUntil: null`; Agent entry consumers
  cannot treat them as live evidence. Invalid/missing retained data reports
  `status: "unavailable"`, not a newly generated market timestamp.
- Retention validates the source run/date, each top record's source-run identity,
  actual provider timestamp and source-session date. A ProX timestamp mismatch
  remains explicit. Misaligned ProX evidence cannot carry an authority adjustment
  other than the existing unavailable/neutral closed-session state, or support,
  peak-failure, or deep-recovery flags. No scores or eligibility rules changed.
- Active-session 90-second decision age, five-minute provider age and two-minute
  alignment contracts remain. A saved `closed` scan session can no longer bypass
  active validation. Reopening immediately disables retained-history acceptance.
- Health still runs the Canonical price/eligibility/rank audit. When closed, its
  timing test is retained-session integrity, not a fabricated live-data pass.
- Cached pre-close responses also have their Live labels removed at presentation.
  Desktop/mobile stock headers and charts share last-session/date labels; their
  price/candle synchronization remains unchanged. Crypto remains 24/7.
- This uses the existing weekday/extended-hours market calendar. It does not add
  holiday/early-close knowledge or silently bless older dates on holidays.

### Verification

- 297 application tests passed.
- Five real rolling-wrapper tests use a mocked cache/storage boundary and frozen
  clocks: both lanes, close/reopen, stale sources, missing timestamps, fresh rebuild.
- Six CoinAPI server-boundary tests and eleven real in-memory PostgreSQL evidence
  tests passed. No provider requests or production database mutations in tests.
- TypeScript and focused lint passed; production build passed on Next.js 16.3.4.
- Local `node_modules` initially had Next.js 16.2.6 while the existing lockfile
  already specified 16.3.4. `npm ci --ignore-scripts` synchronized installed
  dependencies to the lockfile; declared versions and lockfile were not changed.
- Dependency audit reports three moderate entries in the same native-development
  chain: Capacitor CLI → xcode → uuid. No high/critical findings were reported.
  No forced upgrade/downgrade was applied; coordinate remediation with iOS work.
- Shared-store tests cover desktop/mobile consumers; no new visual browser or
  native-device test was performed in this turn.

### Production check at 8:47 PM Eastern

Production still returned v4 and HTTP 500 health: Canonical closed-session timing
plus the two crypto legacy-outcome quarantines. Running the new local retention
validator against its actual public response passed without changing input data:

- Run `9dfbe97d-df22-4c34-b703-65c43856d4b8`, completed 7:58:18 PM ET.
- Retained source date `2026-09-02`.
- Oldest top-set provider timestamp 6:19:56 PM ET; newest 7:58:11 PM ET.
- ATER remains listed as unaligned, not repaired or claimed to be current.

This is a local reproduction against production data, NOT a deployed green check.
The dual-lane stock Agent remains live in production and has passing health:
`ht-agent-stock-universe-v2-dual-lane`, Observe mode, both lanes retained/stale,
zero new decisions/orders in that cycle, paper-only.

### Crypto update: infrastructure ready, collection not started

The owner's SQL result confirms the queried migration 0035/0036 objects, enabled
integrity triggers and maintenance function, database collection OFF, daily cap
300 credits, lifetime cap 900, zero reservations and zero research books/episodes.
Production deployment settings last inspected lacked the enabling environment
flag and CoinAPI key. Nothing in this fix enables them.

At 8:47 PM both unsigned research/evaluation HTTP reads still returned 401, as
required. Actual authenticated production reads remain unverified; offline code
tests are not a substitute for a legitimate authenticated session.

The legacy collector is running: latest observed receipt 8:45:23 PM ET, 80 products
evaluated, three healthy venues, 1,356 supported pairs, 770 observed assets,
25 deeper candidates and zero provider failures in that receipt. Those are legacy
coverage figures, not CoinAPI coverage or proof of profitability.

The public feed is NOT yet CoinAPI-only. Crypto execution is NOT activated.
Two source policies still exclude legacy outcomes from evaluation; overdue counts
at this check were 37 and 157. No present-day-price backfill was performed. The
separate new ledger has zero samples and cannot establish incremental performance.

### Next release steps

1. Review/checkpoint the complete intended working tree with the iOS task; do not
   drop or indiscriminately commit unrelated edits.
2. Deploy the stock fix (no new SQL), verify v5/last-session status and the specific
   Canonical health check, then repeat active-session checks after the reopen.
   Do not describe global health as green while crypto quarantines remain.
3. Verify authenticated research/evaluation reads with a legitimate signed-in
   session. Separately approve/configure a capped CoinAPI research pilot only
   after its cost basis is understood. Deployment alone must not start spending.
4. Gather exact-market/provider-time evidence and compare later unseen outcomes
   before proposing public-feed cutover, calibration, or crypto execution.
