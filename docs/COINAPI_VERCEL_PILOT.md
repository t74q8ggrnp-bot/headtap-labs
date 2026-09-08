# CoinAPI crypto pilot — Vercel only

## What is ready locally

Owner chose Vercel instead of adding an always-on hosting subscription.
The prepared collector uses short REST jobs, not a durable WebSocket service.
It does not require Render, Railway, a VPS, or a new hosting account.
Existing Vercel/Supabase usage and CoinAPI credits still apply.

The collector has **no provider other than CoinAPI** and no fallback requests.
It is a bounded research/data-cost pilot, NOT a completed replacement of the
public crypto feed, an execution system, or evidence of profitability.

- Every 60 seconds, while enabled and within the approved credit allowance.
- One batch current-quote request covering Coinbase, Kraken and Crypto.com.
- One daily batched market-catalog refresh (only native-USD spot identities
  enter this pilot; USDT, BTC and ETH quote pairs are not relabeled as USD).
- At most two deep candle-history requests per cycle, **after** the one shared
  quote batch proves usable trade/book evidence for the exact selected market.
  Unusable quotes skip history; unused request slots are not refilled. Cold/gapped histories
  request 65 actual minute candles; healthy shared caches request only missing
  overlap (3–65 bars) or skip a complete window. Cache bounded to 128 markets.
  Empty, incomplete and conflicting histories retain a shared five-minute
  retry cooldown (including across server instances), not a repeated full-window
  request every minute. This can delay discovery of repaired history by up to
  five minutes; it never makes stale evidence eligible or fresh. Quotes retain
  their one-minute schedule. A prior-snapshot mover gets one slot; rotation provides exploration.
  The queue is not a new public score and has no 24-hour-gain threshold.
- Catalog reused across Vercel instances. Quotes, provider timestamps, selected
  raw candle evidence, research decisions and coverage saved as one publication.
- Authenticated readers share saved evidence and cause **zero provider calls**.
- One backend read representation supplies the chart close and price label,
  with an exact market ID and provider timestamp. JSONB-stable evidence hashes
  reject changed/old-contract publications instead of fetching a fallback.
- A separate indexed book ledger measures selected-market 5/15/30/60-minute
  horizons from saved quotes. It does not request history to manufacture missing
  outcomes. Conflicting versions are quarantined, including later conflicts.
- All observed native-USD markets are counted. Missing/stale quotes, policy
  exclusions, quote-only markets and deep-scored markets are distinguished.
- Meme coins are not categorically excluded; existing stable/wrapped/leveraged
  policy remains. There is no minimum coin price.

No public crypto score, stock Canonical score, stock ProX rule, Agent risk
threshold, paper order or bot was changed by this repair. The invalid legacy
outcome writers were removed; their old records remain quarantined. Old public crypto
routes still use legacy providers until a separately verified cutover.
Do not cancel a currently used provider subscription based on this pilot alone.

## Spending guard and deliberate limits

Migration `0035_coinapi_vercel_pilot.sql` starts the collector **disabled**.
The production-only environment flag `COINAPI_PILOT_ENABLED=true` and the
database switch must both be enabled before any recurring provider spending.
Deploying the code or running the migration alone cannot start collection.

Prepared conservative trial limits (not an approved recurring spend):

- 300 reserved REST credits per UTC day.
- 900 reserved REST credits over the entire pilot; no automatic replenishment.
- 4 provider requests maximum per cycle; 3 normally with a cached catalog.
- Database reservation of 1 credit **before** each request. Check CoinAPI's
  `X-RateLimit-Request-Cost` receipt before allowing another request.
- Unknown or unexpectedly higher cost, uncertain response, unresolved request
  after a worker crash, or HTTP 401/403/429 stops subsequent collection.
- No refunds for uncertain/failed requests or receipts lower than reserved cost.
- Duplicate cycles and repeated request paths cannot multiply provider calls.
- Immutable completed journal rows; atomic latest-publication pointer.

At the expected one-credit-per-request rate, a warm cycle uses three credits:
300/day buys approximately 100 collection cycles (~100 minutes, slightly less
on catalog-refresh days), **not continuous 24-hour coverage**. The full trial
supports approximately 300 cycles. Those are arithmetic estimates, not measured
account invoices. A full day at three requests/minute is 4,320 REST credits;
that continuous allowance is deliberately not enabled here.

Incremental history reduces transferred data, but a three-bar request may still
cost the same one REST credit as 65 bars. Do not project a cheaper 24/7 invoice
from this cache alone. Actual receipts, not the number of bars, settle usage.
The September 3 history-v2 cleanup avoids requests for unusable quotes and
repeated unavailable history. The three-request warm-cycle figure remains a
**maximum when both selected histories genuinely need updates**, not a measured
post-fix average. Per-market request/skip reasons are saved in `frame.history`
and included in collector logs. No new spending limit or collection activation
is part of this cleanup.

These limits govern THIS collector, not other processes using the same key.
They are not a CoinAPI account-wide hard dollar cap. A provider charge can only
be verified after the response; an unexpectedly large first charge cannot be
prevented retroactively. Set provider-side spending controls when available
and verify the account's pricing/entitlement before enabling the trial.

## Activation — requires owner budget approval

1. Review the daily/lifetime trial allowance above. Approve or lower it before
   enabling collection. The schema enforces a maximum of 900 trial credits.
2. With the pilot **disabled**, deploy the tested legacy-writer removal first;
   then apply `supabase/migrations/0035_coinapi_vercel_pilot.sql` if missing,
   followed by `0036_crypto_research_evidence_integrity.sql`.
   It creates three isolated pilot tables and service-role-only budget RPCs;
   0036 adds isolated evidence tables, quarantine policies/views, and write guards.
   Neither migration deletes old records, resets usage or changes scores.
   Deploying the removal before the guards avoids an old collector trying the
   prohibited historical writes. The collector checks 0036 before paid requests.
3. Configure production server-only `COINAPI_API_KEY`, existing Supabase service
   credentials and `CRON_SECRET`. Never put the provider key in `NEXT_PUBLIC_*`
   variables or the browser. Keep preview environments disabled.
4. Set production `COINAPI_PILOT_ENABLED=true`. Deploy the tested source, which
   includes the once-a-minute `/api/crypto/coinapi-collector` Vercel cron.
5. Only after approval, enable the database switch:

   ```sql
   update public.ht_coinapi_pilot_control
   set enabled = true, updated_at = now()
   where id = 'global';
   ```

6. Read `/api/crypto/coinapi-research` using the existing authenticated user
   bearer token or the cron credential. Do not put credentials in URL queries.
   Verify saved cycles, credit receipts, quote coverage and deep-evidence quality.
   Optional `?marketId=COINBASE_SPOT_BTC_USD` selects one exact saved market.
   `/api/crypto/coinapi-evaluation` provides verified-horizon coverage, missing
   results and legacy exclusions. `?episodeId=<UUID>` exports a saved episode,
   verified frame/hash and exact-market books for offline evaluation (500-book
   cap; a potentially truncated export must not be treated as complete).

Pausing is safe and preserves every observation:

```sql
update public.ht_coinapi_pilot_control
set enabled = false, updated_at = now()
where id = 'global';
```

Do not clear `blocked_reason`, unsettled receipts or lifetime usage merely to
make health green. Investigate provider receipts before resuming. There is no
automatic retry/replenishment loop or background cleanup deleting evidence.

## Status and freshness

The research API reports disabled, paused by budget, blocked by accounting,
warming up, collection failure, stale publication, or collecting. It provides
the latest attempted cycle separately from the last complete frame.

Provider trade and book times remain independent of collection time. Read-time
freshness is recomputed without rewriting evidence: trade <=30 seconds old,
book <=15 seconds, mutually aligned within 15 seconds. Publication age <=90
seconds is only a collector cadence check, not a substitute for those clocks.
At a 60-second cadence, saved evidence will often age out between collections.
That is a disclosed pilot limitation, not permission to label old prices live.
Because the quote batch now gates history requests, history latency is included
when evaluating its original provider timestamps. A quote that ages out is
reported stale, and no second quote request is made to conceal that latency.

The crypto outcome portions of `/api/system-health` now explicitly flag the
legacy provenance quarantine; they do **not** certify old data as healthy when
the overdue count happens to be zero. Stock health criteria are unchanged.
The new research endpoint has separate readiness/coverage and does not pretend
that an inactive trial or every market is healthy. Desktop/native adoption must read
the same saved frame and is not yet wired into public price/chart surfaces.

## What this does NOT establish

- It does not stream every tick or deeply score every catalog market each minute.
- It does not yet cover non-USD quote pairs or prove the selected exchanges'
  catalog is complete, available in the user's region, or executable in size.
- Exact-horizon storage is implemented but not yet deployed/measured with real
  trial data. Fees, slippage and profitability remain unmeasured. The evaluator may
  mark many 5-second-tolerance horizons unavailable with minute polling. Do not
  widen that tolerance or substitute a late/current quote to improve results.
- Raw evidence can be exported for chronological, cost-aware evaluation. A
  limited trial is not enough by itself to establish a repeatable profitable
  strategy or justify changing public ranking or enabling crypto execution.
- Existing legacy outcome history is preserved and excluded, not reconstructed
  or reused as clean evidence. SQL guards prevent any old writer overwriting it.
- Missing exchange-status evidence, frozen baseline decisions, actual venue
  fees, and sufficiently timely sized books prevent claims of realistic fills.
  A read-only offline comparison runner exists; it is not a working crypto Agent.

## Verification

Unit tests cover batch sharing, catalog caching, quote identity, incomplete
coverage, rotation, sub-dollar assets, stale clocks, cost receipts and failures.
`tools/test-coinapi-pilot-sql.mjs` runs the actual migration and budget RPCs in an
isolated PostgreSQL-compatible PGlite instance, including roles, duplicate jobs,
UTC rollover, immutable publication, crash handling and the kill switch. No
test connects to production Supabase or sends a provider request.

```sh
node --experimental-strip-types --test lib/crypto/coinapi-pilot.test.ts
node tools/test-coinapi-pilot-sql.mjs /absolute/path/to/pglite/dist/index.js
node tools/test-crypto-evidence-sql.mjs /absolute/path/to/pglite/dist/index.js
node --experimental-strip-types tools/test-coinapi-server-boundaries.mjs
```

The optional SQL test runtime can be installed in a temporary directory; it is
not a production dependency. Local passing tests do not verify a production
migration, deployment, provider entitlement, actual batch cost or live coverage.
