# CoinAPI bounded transport-timeout recovery

## Why the feed stopped

The STX/USD 65-minute-bar request reserved one credit but timed out after eight
seconds. Its stored HTTP status is 0 and actual provider charge is null. The
original collector permanently blocked every later cycle on this unknown actual
charge. Waiting longer or reapplying the paper ledger could not repair that.

CoinAPI documents up to 100 OHLCV output items per request credit. The pilot's
65-item request therefore has a documented maximum of one credit, not an actual
receipt of one credit. A transport failure may have charged zero or one. The
already-reserved credit must remain counted regardless.

Sources:
- https://docs.coinapi.io/market-data/rest-api/ohlcv/latest-data
- https://www.coinapi.io/products/market-data-api/docs/api-limits-and-billing-metrics

## Recovery contract

0041 adds an immutable-to-the-application, hashed cost hold for exact supported
one-credit request shapes. It does not rewrite the receipt, its actual charge,
the failed cycle, saved market facts, spending counters, budgets or stock state.

Recovery requires an enabled collector, no active lease, a failed cycle, a
settled status-0 transport receipt, a documented maximum and counters covering
all reservations. Unsupported requests, unknown query parameters, more than 100
bars, access/rate-limit errors, over-reservation charges and unresolved DB writes
remain blocking. Only `unknown_provider_cost` is eligible for this recovery.

The recovery runs once in the migration and before each new scheduled cycle.
It issues no provider calls. New calls still reserve credits first and require
actual response receipts. A failed attempt is not automatically retried within
its cycle. The network deadline is 12 seconds instead of eight; cadence remains
one minute with the existing 300 daily / 900 lifetime request-credit caps.
These caps do NOT fund a full month or indefinite 24/7 collection.

Atomic health keeps the original unknown-cost count and adds validated maximum
holds, unmatched unknowns and reservation coverage. An old bounded hold is a
disclosed warning, not confirmed spend. Missing fresh quotes, current receipt
errors, altered hashes or invalid legacy outcomes still fail independently.

The manual crypto paper quote function permits old failed transport holds only.
Its provider-time, exact-market, asset-policy and liquidity requirements remain
unchanged. Orders still need a fresh post-submission book to fill. No Agent,
real trading, public crypto conversion, budget increase or stock change occurs.

## Verification / release status

Applied by the owner in Firefox: `recovered:true`, `newHolds:1`,
`reportedChargeStillUnknown:true`, `providerRequests:0`. Deployed READY as
`dpl_2eV2WpkWq1442PEJ3MZ8sdogQeQd`, aliased to https://gethtlabs.com.
Production source matched all 393 deployed source files before this release-note
update. No stock, Agent or iOS implementation change was included.

Verified with isolated PostgreSQL:
- 26 timeout-recovery tests, including original-receipt preservation, idempotence,
  permissions, exact cost bounds, existing hard pauses, budget caps and a
  recovered feed → synthetic fresh quote → paper buy → paper sell lifecycle.
- All 28 original manual paper ledger tests pass against the replacement quote
  function, including partial fills, cash/basis conservation, stale/future quote
  rejection, kill switch, idempotency and ownership isolation.
- Core suite: 317 passing tests. Tests use synthetic data, not production orders.
- 48 route/server/render tests pass; focused lint and the production Webpack
  build (including TypeScript and page generation) pass.
- Comparison with deployed `dpl_FHziz8QE2SDUcWnXzyz74DktN7sA` confirms only this
  repair's crypto files, tests and documentation differ. No stock, Agent or iOS
  source differs from the prior deployed release.

Release order: apply 0041, verify its recovery result and accounting snapshot,
deploy the matching application, observe new collector cycles, inspect provider
timestamps and live health. Do not report production success from these tests.

The archive audit is separate, uses no CoinAPI credits, and remains excluded from
performance claims. Its unfinished records are not made green by this migration.

## Authorized production paper lifecycle — September 3, 2026

The owner explicitly approved opening the separate virtual account and a $10 BTC
buy followed by a sell. Both orders were submitted through the actual signed-in
browser controls, filled by the scheduled collector, and retained in history.
No live exchange order, manual database fill, account reset or paid debug request
was used. Both fills reference `COINBASE_SPOT_BTC_USD`:

| Event | Provider time (Eastern) | Quantity BTC | Simulated fill price |
| --- | --- | --- | --- |
| Buy | 12:18:32 AM | 0.000127454575 | $77,666.1486 |
| Sell | 12:21:19 AM | 0.000127454575 | $77,477.445 |

Buy total including fee: $9.95829939747. Sell net after fee: $9.81560569561.
Expected realized P&L: -$0.14269370186; cash: $99,999.85730629814.
The browser displays $99,999.86 cash/equity/buying power, -$0.14 realized P&L,
zero reserved cash, zero open orders and no remaining position. Both orders are
`filled`. This is an operational test, NOT a profitability claim.

Buy publication: `c4333e54-48e1-47db-a005-b7d91cee0e7c`.
Sell publication: `6a3b19bd-69cb-4e65-aa76-ab27a462d54b`.
Each collector log confirms three actual reported request credits and one fill.

Reliability is not fully resolved: a publication write timed out between these
fills; the following successful cycle completed the sell without SQL intervention.
Archive batches also hit their eight-second database deadline repeatedly, and
an exhaustive health read hit SQL timeout 57014. These failures remain visible;
do not claim the entire system is green or continuous streaming is implemented.
The original one-credit transport pause is resolved; database/archive performance
is a separate remaining issue. Existing 300/900 credit caps still stop collection
when exhausted and have not been increased.

The final post-close `/api/system-health` request timed out after 55 seconds
without a response. Therefore post-close aggregate health could not be confirmed.
The observed completed orders and empty position remain the browser/collector
evidence; they must not be represented as a successful final health response.
