-- Pro X intelligence bridge, shadow mode only.
--
-- This migration gives Pro X durable pulse history, immutable versioned
-- intelligence packets, and a place to compare its paper-bot opinion with
-- the canonical decision. It does not grant Pro X order authority and does
-- not change any canonical HT Labs scoring table.

create table if not exists prox_market_feature_history (
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
  on prox_market_feature_history (ticker, computed_at desc);

create table if not exists prox_intelligence_packets (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  packet_version text not null,
  mode text not null default 'shadow',
  ticker text not null,
  as_of timestamptz not null,
  status text not null,
  source_event_id uuid references prox_events(id) on delete set null,
  market_computed_at timestamptz,
  composite_score real,
  evidence_confidence real,
  market_confirmation real,
  contradiction_risk real,
  would_veto boolean not null default false,
  would_reduce_size boolean not null default false,
  rank_adjustment int not null default 0,
  packet jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists prox_intelligence_packets_ticker_time_idx
  on prox_intelligence_packets (ticker, as_of desc);

create table if not exists prox_bot_shadow_observations (
  id uuid primary key default gen_random_uuid(),
  source_run_id text not null,
  canonical_engine_version text not null,
  ticker text not null,
  packet_snapshot_key text not null,
  packet_version text not null,
  canonical_eligible boolean not null,
  canonical_strategy_score real,
  canonical_opportunity_score real,
  prox_status text not null,
  prox_composite_score real,
  prox_would_veto boolean not null default false,
  prox_would_reduce_size boolean not null default false,
  prox_rank_adjustment int not null default 0,
  executed_influence boolean not null default false,
  reasons jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null default now(),
  unique (source_run_id, ticker, packet_snapshot_key)
);
create index if not exists prox_bot_shadow_observations_ticker_time_idx
  on prox_bot_shadow_observations (ticker, observed_at desc);

