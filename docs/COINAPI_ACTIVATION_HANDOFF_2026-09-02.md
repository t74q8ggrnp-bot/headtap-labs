# CoinAPI activation and remaining repairs — September 2, 2026

## Owner direction and production action

The owner explicitly approved turning CoinAPI collection on and wants usable
crypto information, paper trading and Agent integration. Proof of profitability
is not a prerequisite to collecting data or building those interfaces. It is
still required before making profitability/performance claims.

Completed in Vercel:

- Installed the existing local CoinAPI credential as a sensitive production-only
  `COINAPI_API_KEY`. No credential was printed or committed.
- Set production `COINAPI_PILOT_ENABLED=true`.
- Redeployed the exact existing production source rather than uploading all
  unrelated dirty workspace changes.
- New deployment: `dpl_4pSGTeEzr97htvaBCYXQdwG26M7n`, READY and aliased to
  `gethtlabs.com`.
- URL: `https://headtap-labs-hr4w6r34n-nkzmhmtw4w-5153s-projects.vercel.app`.
- Metadata base SHA: `19fc3d30159bc37dacd08741426bdb7dba550ed8`, branch
  `rescue-build-passing`, **gitDirty=1**. This is not a clean commit checkpoint.
- Production requests reached `/api/crypto/coinapi-collector` every minute,
  9:11–9:17 PM Eastern, HTTP 200. This proves scheduling/authentication but
  does **not** prove a completed provider collection: a disabled database
  switch also returns HTTP 200.

The owner's subsequent activation SQL result confirms database `enabled=true`,
zero reserved credits, no block and no completed cycle at the time of that read.
No authenticated database session/service credential was available locally to
read the new ledger. Activation used `tools/enable-coinapi-pilot.sql`. It leaves existing
300/day and 900/lifetime request-credit caps and counters intact. These are
not dollar caps or 24/7 coverage. No subscription purchase, automatic recharge
change, numeric budget increase or real brokerage execution was performed.

Follow-up verification at 9:34 PM Eastern confirmed one-minute production
collector requests returning HTTP 200. Response bodies and saved cycles remain
unverified; HTTP 200 can also mean a paused collector. The read-only query at
`tools/verify-crypto-release-readonly.sql` now includes recent cycle status,
coverage, provider usage receipts and 0037 schema presence. The owner's
activation result does not establish that 0037 was applied. Health still
reported the two legacy crypto quarantine failures and 210 overdue Agent
outcomes; all other returned checks passed.

## Prepared locally, NOT in the configuration-only redeployment above

1. Migration **0037** stops new outcome scheduling in the legacy observation
   tables. Existing rows retain every original field, including overdue target
   timestamps and any unverified prices/returns. New rows are explicitly
   `not_scheduled`, not pretend measured/unavailable returns. An insert guard
   also handles the old collector during rollout. Update/delete protections
   preserve old evidence; original 0036 quarantine remains in force.
2. The collector explicitly writes observation-only records after 0037, while
   preserving the existing public decision-frame and observation collection.
   No public scores, eligibility gates or providers were replaced.
3. `/crypto/research` provides signed-in access to stored CoinAPI prices,
   precise shared-price candles/line chart, exact exchange/pair, bid/ask times,
   deep research results, quote-only coverage, and collector/outcome status.
   It refreshes storage every minute while visible. It cannot call CoinAPI,
   enable collection, or submit an order. The public `/crypto` feed is unchanged.
4. Authenticated research reads report the environment and database switches,
   credential presence (never value), UTC usage and preserved legacy coverage.
   Successful connection, active collection and proven performance are distinct.
5. Agent outcome maintenance is scheduled every minute, including overnight.
   Its old schedule stopped at 8:59 PM Eastern during daylight time, although
   horizons continued maturing. Its historical provider-time logic, missing-bar
   rules and health criteria are unchanged. Decision/entry schedules, risk
   rules, modes, stock ranking and the dual-lane fix are unchanged.

## Production health observed at 9:19 PM Eastern

- `canonical_opportunity_atomicity`: green, retained last-session data, not Live.
- Both legacy crypto outcome checks: red, explicitly quarantined.
- `ht_agent_phase1`: red, 210 overdue outcome measurements. The maintenance
  scheduling repair is local and still needs deployment.

Do not call global production health green. Migration 0037 stops new unusable
legacy promises, but does not rehabilitate old crypto results. Already-created
future legacy targets may still mature into the preserved overdue counts.

## Rollout

1. Database activation is confirmed by the owner. Run
   `tools/verify-crypto-release-readonly.sql` to verify actual saved cycles and
   consumption; no need to run the activation mutation again.
2. Apply `supabase/migrations/0037_crypto_legacy_observation_only.sql` before
   deploying the new collector writer. Do not re-run 0035/0036 unnecessarily.
3. Build/deploy this repair from `/Users/johndoe/headtap-labs` after 0037. The
   new desk and overnight Agent maintenance are not in the earlier redeploy.
4. Visit `/crypto/research` while signed in to HT Labs. Verify a non-null cycle,
   actual provider timestamps, quote and deep-research coverage, and usage
   receipts. A 200 response with disabled/empty state is not collection success.
5. Verify 0037's `ht_crypto_legacy_tracking_readiness`: new observation-only rows,
   no invalid new deadlines, preserved old counts, evaluation still disallowed.
6. Recheck Agent outcomes after the newly deployed worker runs. Confirm records
   are measured from history or explicitly unavailable, never current-price
   substitutions. No orders are needed to verify maintenance.

Crypto paper orders, Agent crypto decisions/position management, the full
public-feed cutover, entitlement coverage and net profitable performance are
**not implemented/verified by this repair**. The existing paper engine is stock
specific. Connect exact-market fractional crypto positions and an independent
paper lifecycle next; do not route a crypto symbol through the stock engine or
represent an experimental research score as an executable order permission.

## Verification

- Full app test suite: 298 passed, including the new schedule assertion and
  existing outcome-policy tests.
- Read-route tests: 6 passed (auth, private/no-store, missing schema, no fake
  active state, preserved quarantine, rate limits, no paid fallback).
- Desk/render/chart configuration tests: 6 passed (shared precise price,
  candles/line, mobile gestures, Eastern time, signed-out/errors/empty state).
- 0037 and activation SQL in isolated PostgreSQL: 8 passed, including migration
  replay, old-row equality, new-write compatibility and preserved credit limits.
- Existing 0036 evidence tests: 11 passed; pilot SQL budget tests: 17 passed;
  server-boundary tests: 6 passed.
- Production build, TypeScript, focused lint and whitespace checks passed.
- Local browser confirmed the signed-out research page. Real authenticated
  production reads, live chart behavior and a completed collector cycle still
  require the owner's database activation and matching deployment.

No local repair files were committed or pushed in this turn. Preserve the
pre-existing dirty stock/UI/Agent work and coordinate the checkpoint before iOS
sync; a passing build is not proof of a clean merged release.

## Follow-up after owner reported SQL and deployment

Verified at 9:38–9:40 PM Eastern on September 2:

- Production release is now `dpl_xJXTJHmXrAT33dFW3ge5YoXjoYuF`, READY and
  aliased to `gethtlabs.com`; URL is
  `https://headtap-labs-k5hlolxur-nkzmhmtw4w-5153s-projects.vercel.app`.
- Metadata still references base SHA
  `19fc3d30159bc37dacd08741426bdb7dba550ed8` on `rescue-build-passing`, with
  `gitDirty=1`. Do not represent that base SHA as the full deployed source.
- Both CoinAPI environment names are installed; no values were read.
- Deployed schedules include CoinAPI collection and Agent outcome maintenance
  every minute, including overnight.
- Production health: **31 of 33 checks pass**. Agent overdue outcomes dropped
  from **210 to zero**. The two legacy crypto provenance quarantine checks
  remain red; historical performance remains excluded.
- Canonical retained-session integrity is green and stock quotes are not
  labeled Live while closed. Dual-lane Agent stock-universe version is still
  present in the live health response.
- The new `/crypto/research` page loads in the browser. This browser is signed
  out, so authenticated research data could not be inspected.
- Collector requests on this new release return HTTP 200 at the one-minute
  cadence. This still does not establish completed collection, coverage or
  consumed credits: paused collection also returns 200.

The owner reported running SQL but did not include its verification output.
Saved-cycle/usage evidence and authoritative 0037 schema confirmation therefore
remain pending. Request the result of `tools/verify-crypto-release-readonly.sql`
or the signed-in research desk status. Do not request the activation mutation
again or claim that crypto orders/public-feed conversion are complete.
