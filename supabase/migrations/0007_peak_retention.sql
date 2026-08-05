-- Preserve session-wide and recent-window peak context for HT Labs and ProX.
-- A pullback is descriptive evidence only. Canonical scoring decides whether
-- it is healthy consolidation or confirmed post-peak deterioration by
-- combining it with acceleration, VWAP, time, and volume behavior.

alter table public.ht_signal_run_rows
  add column if not exists session_high_price numeric,
  add column if not exists pullback_from_session_high_percent numeric;

comment on column public.ht_signal_run_rows.session_high_price is
  'Highest eligible current-session aggregate price observed by the canonical market snapshot.';
comment on column public.ht_signal_run_rows.pullback_from_session_high_percent is
  'Non-negative distance from the current-session high at scan time; context only, not a standalone penalty.';

alter table public.prox_market_features
  add column if not exists window_high_price real,
  add column if not exists pullback_from_window_high_percent real,
  add column if not exists minutes_since_window_high real,
  add column if not exists average_bar_range_percent real;

-- Some early deployments had the latest-snapshot table without migration
-- 0005's append-only history table. Make this migration safe for both paths
-- so peak retention does not depend on an undocumented migration order.
create table if not exists public.prox_market_feature_history (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  price real,
  velocity_1m real,
  acceleration_5m real,
  volume_1m bigint,
  avg_volume_1m real,
  volume_acceleration real,
  vwap real,
  price_vs_vwap real,
  dollar_volume real,
  bar_count int,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (ticker, computed_at)
);

create index if not exists prox_market_feature_history_ticker_time_idx
  on public.prox_market_feature_history (ticker, computed_at desc);

alter table public.prox_market_feature_history
  add column if not exists window_high_price real,
  add column if not exists pullback_from_window_high_percent real,
  add column if not exists minutes_since_window_high real,
  add column if not exists average_bar_range_percent real;

comment on column public.prox_market_features.window_high_price is
  'Highest high in the latest ProX minute-bar window.';
comment on column public.prox_market_features.pullback_from_window_high_percent is
  'Non-negative distance from the latest ProX window high.';
comment on column public.prox_market_features.minutes_since_window_high is
  'Elapsed minutes since the latest occurrence of the ProX window high.';
comment on column public.prox_market_features.average_bar_range_percent is
  'Average one-minute high-low range used to normalize peak-retention decisions to the ticker tape.';
