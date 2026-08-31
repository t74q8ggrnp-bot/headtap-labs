# HT Labs iOS sync contract

## Release boundary

The native app must treat the production API as the authority. It may format
responses, but it must not rank opportunities, derive replacement scores, or
manufacture market-data freshness.

`GET /api/mobile-capabilities` publishes the active runtime contract. Native
sync work should stop if its `contractVersion` or Paper Trading contract is
newer than the app understands.

## Paper Trading v2

The authoritative API is `POST /api/paper-trading/orders` under
`ht-paper-trading-v2`.

The canonical full-position close request is:

```json
{
  "symbol": "AAPL",
  "closePosition": true,
  "orderType": "market",
  "timeInForce": "day",
  "allowExtendedHours": false,
  "strategySource": "manual"
}
```

The prior native request remains supported during migration:

```json
{
  "symbol": "AAPL",
  "action": "close_position"
}
```

For either form, the server reads the open ledger position and derives the
correct `sell` or `buy_to_cover` side and exact full quantity. The native app
must not calculate account state or assume that a submitted close filled.
It must use the returned dashboard and refresh the account endpoint.

## Runtime cadence

- canonical scan: 120 seconds;
- ProX sensing: 60 seconds;
- homepage decisions: 30 seconds;
- selected quote: 10 seconds; and
- selected stock chart: 5 seconds.

These are polling/collection cadences, not promises that a new exchange event
exists at every interval.

## Timestamp and Live-label authority

Provider event time owns freshness. Server processing time and device time are
audit/presentation values only. Outside the weekday 4:00 a.m.–8:00 p.m.
America/New_York stock session, the last verified session may be retained but
must not be labeled `Live`.

## Required database migrations

- `0024_manual_paper_trading.sql`
- `0025_prox_shadow_episode_scorecard.sql`
- `0026_market_data_timestamp_authority.sql`
- `0027_prox_realtime_microstructure_observations.sql`
- `0028_paper_match_health.sql`

Migration 0028 adds a durable matcher heartbeat. `/api/system-health` fails the
`paper_trading_contract_and_matcher` check when the matcher schema is missing,
the latest run failed, or the every-two-minute heartbeat is stale.

## Pre-sync release gate

Before copying or syncing native assets:

1. the web release must be committed and deployed from that exact commit;
2. `npm run lint`, `npx tsc --noEmit`, all Node tests, and `npm run build` must
   pass;
3. `/api/mobile-capabilities` must return HTTP 200;
4. `/api/system-health` must return healthy;
5. the Paper Trading matcher heartbeat must be current; and
6. the first active-session Massive validation must confirm real-time
   snapshots, trades, NBBO, second aggregates, ProX microstructure, and
   canonical persistence.
