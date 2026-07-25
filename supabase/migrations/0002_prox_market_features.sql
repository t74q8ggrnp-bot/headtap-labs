-- Pro X Phase 3 (partial) — market-feature snapshots.
-- REST-polled minute bars from the current Polygon plan (minute/second
-- aggs are entitled; last-trade/last-quote are not, per live verification).
-- One row per ticker, upserted — the latest snapshot, not a full history.
-- This is the "event appeared -> monitor affected ticker" direction only.
-- Nothing here writes to or reads from any ht_* table.

create table if not exists prox_market_features (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  price real,
  velocity_1m real,          -- % change, most recent 1-min bar vs prior bar
  acceleration_5m real,      -- % change, latest close vs close 5 bars ago
  volume_1m bigint,
  avg_volume_1m real,        -- trailing average of the fetched window, excluding latest bar
  volume_acceleration real,  -- volume_1m / avg_volume_1m
  vwap real,
  price_vs_vwap real,        -- % distance of price from vwap
  dollar_volume real,
  bar_count int,
  computed_at timestamptz not null default now()
);
create index if not exists prox_market_features_computed_at_idx on prox_market_features (computed_at desc);
