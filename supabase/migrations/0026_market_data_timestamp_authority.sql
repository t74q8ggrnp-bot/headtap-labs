-- Preserve the timestamp of the provider's market observation separately
-- from the time HT Labs computed or persisted a decision. This prevents a
-- delayed Polygon bar from becoming "fresh" merely because ProX processed it
-- seconds ago. These fields carry market facts only; they grant no scoring,
-- public, bot, order, or execution authority.

alter table public.ht_signal_run_rows
  add column if not exists market_data_as_of timestamptz;

alter table public.prox_market_features
  add column if not exists market_as_of timestamptz;

alter table public.prox_market_feature_history
  add column if not exists market_as_of timestamptz;

create index if not exists ht_signal_run_rows_market_data_as_of_idx
  on public.ht_signal_run_rows (market_data_as_of desc);

create index if not exists prox_market_features_market_as_of_idx
  on public.prox_market_features (market_as_of desc);

create index if not exists prox_market_feature_history_market_as_of_idx
  on public.prox_market_feature_history (market_as_of desc);

comment on column public.ht_signal_run_rows.market_data_as_of is
  'Provider timestamp for the market price used by this canonical run row; distinct from scanned_at.';
comment on column public.prox_market_features.market_as_of is
  'Timestamp of the newest provider bar used to compute this ProX pulse; distinct from computed_at.';
comment on column public.prox_market_feature_history.market_as_of is
  'Timestamp of the newest provider bar used by this historical ProX feature observation.';
