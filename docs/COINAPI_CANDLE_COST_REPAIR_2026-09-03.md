# CoinAPI candle-request cleanup — September 3, 2026

## Scope and status

Collector/cache repair deployed September 3 to
`dpl_8EjD79ZiumMpVa2vfpsdDTmX7R34` and aliased to `gethtlabs.com`.
All 417 deployed source files matched the tested local source manifest before
this post-deployment report and the standalone validation SQL were added.
The prior release was `dpl_EUdvqSddLLy9Qz2wr8qENkbmLSPT`; its 403 unaffected
files matched, and the six changed files were limited to CoinAPI code/tests/docs.
No repository-wide commit was made; unrelated working-tree changes are preserved.
No streaming test, provider call, trade, new SQL, subscription change, daily
limit adjustment, score change, stock code edit or public-feed conversion.
Existing unrelated working-tree changes are preserved.

## What the evidence establishes

The signed-in provider ledger observed immediately before this repair showed
900 September 3 REST requests: 598 OHLCV, 301 quotes and one symbols catalog
request. The daily ledger reported 4.71 pre-tax usage credits. Billing Overview
reported $4.79 total period usage and $20.21 remaining from $25. These counters
cover different scopes; the $4.48 Spend Management counter was not reconciled.

[CoinAPI pricing](https://www.coinapi.io/products/market-data-api/pricing), checked
September 3, charges REST retrievals, including repeated requests. A request for
3 bars and one for 65 bars ordinarily occupy the same <=100-point credit unit.
Downloading fewer bytes alone does not save that REST credit. Request receipts
remain the actual charge authority; one earlier timeout has an unknown actual
charge and a reserved maximum, not a fabricated confirmed charge.

598 requests does **not** establish 598 identical downloads. The queue explores
different exact exchange/pair identities and updates genuine new candles too.
Per-market duplicate counts could not be freshly retrieved: production env
export supplied empty service/cron values, so the read-only audit stopped before
connecting to Supabase. No provider call or credential bypass was attempted.
`tools/audit-coinapi-candle-requests.mjs` is a bounded read-only receipt/cache audit
for an environment with the actual existing service credential; it performs no
CoinAPI calls, database mutations or RPCs.

## Reproduced problems and repairs

1. **Blind history-first spending.** Two selected markets received paid history
   requests before their quote validity was known. The single shared quote batch
   now comes first. Missing, stale, conflicting, future or misaligned trade/book
   evidence prevents history requests for that market. Selection/rotation and
   the all-market coverage denominator are unchanged; no substitute market is
   added merely to spend the unused request slot.
2. **Repeated unavailable-window requests.** Empty or sparse responses lacked a
   usable cache; conflicting responses deleted the cache. The next selection
   could re-request a full window. Negative cache entries now persist a bounded
   five-minute retry time in the existing shared state. The failure and skipped
   request stay explicit. Quotes continue every minute; history recovery may be
   discovered up to five minutes later. The research freshness rules do not change.
3. **Insufficient request explanations.** The saved frame and collector log now
   distinguish initial history, incremental update, gap recheck, complete cache,
   unusable quote, invalid history and retry deferral. Received/reused bar counts
   are not dollar savings or unique-data counts.

Complete same-minute windows still avoid downloads. Healthy missing minutes
still fetch bounded incremental overlap. A cold/new market still requires real
historical data; no minute bars, volume, provider times or successful scores are
fabricated from one-minute quote samples.

History latency is rechecked against the original quote clocks before every
history request and at final evaluation. Slow responses can cause abstention;
no extra quote request or relaxed freshness threshold hides that limitation.
Transport/accounting failures still abort before more spending.

## Verification and limits

- 353/353 main tests passed, including eight new cost/cache regression tests.
- 27/27 collector/server/authenticated-read boundary tests passed.
- TypeScript and focused lint passed.
- Production webpack build passed. Default Turbopack build was blocked by this
  environment's local process/port permission, including its escalated retry.
- Offline five-minute empty/gapped/conflicting-history fixtures: two initial
  history calls instead of ten, with all five quote checks preserved. This is
  an **80% history-call reduction for those fixtures**, not a measured production
  cost reduction. All-unusable-quote fixtures make one quote call and zero
  history calls. Valid new history continues to cost credits.
- The live production health response at 09:20:16 ET remained `ok: false` with
  `crypto_coinapi_collection` as its only failing check. This local repair has
  not been deployed and does not reset the exhausted 900-credit lifetime budget.
  ProX also disclosed partial per-ticker quote/trade coverage in warnings; those
  source timestamps and stock health criteria were not changed.

The deployed Vercel production build also passed using default Turbopack.
353/353 main tests and 27/27 boundary checks were rerun successfully before/at
deployment. The new collector's scheduled runtime log reported HTTP 200,
`paused / credit_budget_reached`, and zero provider requests. The 09:36:13 ET
health read still correctly failed only `crypto_coinapi_collection`; reservations
remained 900/900. Deployment did not fabricate fresh data or reset the budget.

The owner subsequently approved one extra 100-request validation allowance,
approximately $0.53 before tax at the published first-tier rate, from the existing
trial balance. This is NOT daily spending, a subscription, a recharge, streaming
test approval or permission to clear operational blocks. Supabase was signed out
and no direct production database credential was available. At the owner's
request, `tools/coinapi-validation-100.sql` is provided for SQL Editor execution.
It fixes both ceilings at 1,000, preserves the 900 already reserved, preserves
cache/history/receipts, refuses an unexpected baseline or operational block,
and is idempotent. Five isolated PostgreSQL tests passed, including the 100th
additional reservation succeeding and the 101st being denied. It was NOT run
in production by this task. No redeploy is required after running that SQL.

The owner has now supplied the successful SQL result: enabled=true, both
ceilings=1,000, daily/lifetime reserved=900, remaining_test_requests=100,
blocked_reason=null. The one-time allowance is applied; another deployment
or rerun of the allowance SQL is not needed.

At approximately 10:03–10:05 ET, verification remained blocked by storage
availability: scheduled collector logs returned 503 at `maintenance`, before
the budget claim or any CoinAPI request. System health timed out after 25
seconds. Supabase's unauthenticated API gateway responded promptly with the
expected missing-key 401, while public-key Auth health and REST reads timed out.
The SQL Editor working does not establish that the application's API path works.
These failed maintenance attempts did not reach paid provider collection.
No additional limit changes, manual collectors, live orders or resets occurred.

Remaining: restore/verify the Supabase API path and measure actual request/skip
receipts under the approved allowance. Do not advertise a new daily
cost or claim the whole app is green from these local tests. The possible
three-requests/minute upper workload remains 4,321 requests/day including one
catalog refresh; this repair reduces unnecessary work, not that worst case.
Budgets stay unchanged, and no recurring or one-off live test was started.
