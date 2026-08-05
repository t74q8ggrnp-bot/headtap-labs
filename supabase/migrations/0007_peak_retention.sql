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
