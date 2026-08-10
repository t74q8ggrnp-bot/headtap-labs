-- Crypto ProX shadow-learning history.
--
-- Every scheduled cycle records the exact crypto leader, contenders, and
-- radar set plus the ProX packet that existed at that moment. Later cycles
-- attach observed prices at fixed horizons so proposed score adjustments can
-- be calibrated before ProX receives ranking authority.

create table if not exists public.ht_crypto_prox_observations (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  symbol text not null,
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  role text not null,
  rank int not null,
  entry_price numeric not null,
  canonical_score numeric not null,
  shadow_score numeric,
  proposed_score_adjustment numeric,
  prox_state text,
  prox_market_confirmation numeric,
  methodology_version text not null,
  prox_packet jsonb,
  decision_snapshot jsonb not null default '{}'::jsonb,
  target_15m_at timestamptz not null,
  target_1h_at timestamptz not null,
  target_4h_at timestamptz not null,
  target_24h_at timestamptz not null,
  price_15m numeric,
  return_15m_percent numeric,
  price_1h numeric,
  return_1h_percent numeric,
  price_4h numeric,
  return_4h_percent numeric,
  price_24h numeric,
  return_24h_percent numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, observation_minute),
  check (entry_price > 0),
  check (rank > 0),
  check (role in ('hero', 'contender', 'radar'))
);

create index if not exists ht_crypto_prox_observations_time_idx
  on public.ht_crypto_prox_observations (observed_at desc, role, rank);

create index if not exists ht_crypto_prox_observations_product_time_idx
  on public.ht_crypto_prox_observations (product_id, observed_at desc);

create index if not exists ht_crypto_prox_observations_due_idx
  on public.ht_crypto_prox_observations
  (target_15m_at, target_1h_at, target_4h_at, target_24h_at);

create table if not exists public.ht_crypto_prox_collection_runs (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  observation_minute timestamptz not null unique,
  expected_observation_count int not null default 0,
  persisted_observation_count int not null default 0,
  complete boolean not null default false,
  observed_products jsonb not null default '[]'::jsonb,
  feed_diagnostics jsonb not null default '{}'::jsonb,
  outcomes_updated int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_observation_count >= 0),
  check (persisted_observation_count >= 0),
  check (outcomes_updated >= 0)
);

alter table public.ht_crypto_prox_collection_runs
  add column if not exists feed_diagnostics jsonb not null default '{}'::jsonb;

create index if not exists ht_crypto_prox_collection_runs_time_idx
  on public.ht_crypto_prox_collection_runs (observed_at desc);

alter table public.ht_crypto_prox_observations enable row level security;
alter table public.ht_crypto_prox_collection_runs enable row level security;

comment on table public.ht_crypto_prox_observations is
  'Crypto ProX shadow packets with immutable entry prices and fixed-horizon observed outcomes.';

comment on table public.ht_crypto_prox_collection_runs is
  'Coverage receipt proving the complete Crypto ProX candidate set was saved each cycle.';
