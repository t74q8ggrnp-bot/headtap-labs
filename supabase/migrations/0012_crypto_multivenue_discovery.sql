-- Multi-venue crypto discovery shadow-learning history.
--
-- This lane never replaces the public HT Crypto score. It records what a
-- wider Coinbase/Kraken/Crypto.com discovery pass would have surfaced, plus
-- fixed-horizon outcomes, so venue breadth and attention evidence can be
-- validated before they receive any ranking authority.

create table if not exists public.ht_crypto_discovery_observations (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null,
  symbol text not null,
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  rank int not null,
  entry_price_usd numeric not null,
  proposed_opportunity_score numeric not null,
  observed_move_percent numeric not null,
  dollar_volume numeric not null,
  venue_count int not null,
  methodology_version text not null,
  discovery_packet jsonb not null default '{}'::jsonb,
  target_15m_at timestamptz not null,
  target_1h_at timestamptz not null,
  target_4h_at timestamptz not null,
  target_24h_at timestamptz not null,
  price_15m_usd numeric,
  return_15m_percent numeric,
  price_1h_usd numeric,
  return_1h_percent numeric,
  price_4h_usd numeric,
  return_4h_percent numeric,
  price_24h_usd numeric,
  return_24h_percent numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, observation_minute),
  check (entry_price_usd > 0),
  check (rank > 0),
  check (venue_count > 0)
);

create index if not exists ht_crypto_discovery_observations_time_idx
  on public.ht_crypto_discovery_observations (observed_at desc, rank);

create index if not exists ht_crypto_discovery_observations_asset_time_idx
  on public.ht_crypto_discovery_observations (asset_id, observed_at desc);

create index if not exists ht_crypto_discovery_observations_due_idx
  on public.ht_crypto_discovery_observations
  (target_15m_at, target_1h_at, target_4h_at, target_24h_at);

create table if not exists public.ht_crypto_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  observation_minute timestamptz not null unique,
  expected_candidate_count int not null default 0,
  persisted_candidate_count int not null default 0,
  complete boolean not null default false,
  observed_assets jsonb not null default '[]'::jsonb,
  source_diagnostics jsonb not null default '{}'::jsonb,
  outcomes_updated int not null default 0,
  outcomes_unavailable int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_candidate_count >= 0),
  check (persisted_candidate_count >= 0),
  check (outcomes_updated >= 0),
  check (outcomes_unavailable >= 0)
);

create index if not exists ht_crypto_discovery_runs_time_idx
  on public.ht_crypto_discovery_runs (observed_at desc);

alter table public.ht_crypto_discovery_observations enable row level security;
alter table public.ht_crypto_discovery_runs enable row level security;

comment on table public.ht_crypto_discovery_observations is
  'Shadow-only multi-venue crypto candidates with fixed-horizon observed outcomes.';

comment on table public.ht_crypto_discovery_runs is
  'Coverage receipt for each Coinbase/Kraken/Crypto.com shadow discovery cycle.';
