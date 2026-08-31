# Massive Advanced real-time stock pipeline

## Verified entitlement

The dedicated HT Labs Massive key was verified against the stock full-market
snapshot, last-trade, last-NBBO-quote, minute-aggregate, and second-aggregate
REST endpoints on 2026-08-30. These endpoints are the stock-data transport for
the canonical scanner, selected quotes, charts, and ProX market observation.

## Runtime model

HT Labs runs on Vercel route handlers and scheduled functions. Those functions
cannot own a durable, always-connected market WebSocket. The production design
therefore uses real-time Massive REST facts at deliberately short cadences:

- canonical scanning and outcome-ledger writes every two minutes while the
  U.S. extended-hours stock session is active;
- ProX market sensing every minute during that active session;
- a bounded ProX microstructure observer every minute, preserving NBBO and
  the latest two minutes of consolidated trade prints for independently
  discovered equity research candidates;
- selected stock charts refresh every five seconds and merge the latest
  second aggregates into the current minute candle;
- selected stock quotes refresh every ten seconds; and
- homepage canonical decisions refresh every thirty seconds.

This is a real-time REST architecture, not a claim that every surface receives
every exchange tick. A future persistent worker may add Massive WebSockets
without changing the scoring contract.

## Market-session truth

U.S. stock discovery is active on trading weekdays from 4:00 AM through
8:00 PM America/New_York. Outside that window, HT Labs retains the last
verified session rather than inventing 24/7 stock movement. Provider event
timestamps own freshness; server processing timestamps are audit metadata.

## Authority boundaries

- `lib/canonical-opportunity.ts` remains the single public decision owner.
- Massive supplies verified market facts; it does not score or rank stocks.
- ProX Market Pulse retains only its documented bounded canonical influence.
- Independent ProX Edge remains shadow-only.
- Quote-spread and trade-tape observations are append-only shadow evidence in
  `prox_realtime_microstructure_observations`. They are intentionally not read
  by canonical scoring, ProX Edge scoring, eligibility, or execution code.
- Charts and browser clients render backend decisions and never choose the
  opportunity board.
- The Alpaca paper bot is unchanged: no second bot and no live trading.

## Operational checks

`/api/system-health` includes a `massive_realtime_entitlement` check. It probes
the snapshot, last-trade, and last-quote endpoints and reports the effective
provider data mode. The scan, discovery, pulse, and observation checks use
tighter active-session freshness limits appropriate to the Advanced feed.

The `prox_realtime_microstructure_observations` check additionally proves:

- the collection receipt exactly matches the append-only observation count;
- at least 80% of the bounded research set has a provider-timestamped NBBO;
- the source entitlement is real-time and provider calls did not fail;
- the newest quote/trade timestamp is fresh during an active session; and
- the lane still carries `shadow_observation_only` authority with no score or
  execution output.

Run migration `0027_prox_realtime_microstructure_observations.sql` before the
deployment that enables this collector.

The native runtime contract is published by `/api/mobile-capabilities`.
Paper Trading uses the separately versioned `ht-paper-trading-v2` contract;
its scheduled matcher heartbeat requires migration
`0028_paper_match_health.sql` and is audited by `/api/system-health`.
