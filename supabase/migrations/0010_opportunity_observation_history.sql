-- Complete canonical opportunity observation history.
--
-- The daily ledger preserves first/latest values and true post-discovery
-- outcomes. These tables preserve every scheduled canonical display decision
-- and prove that all expected records were written for each collection cycle.

create table if not exists public.ht_opportunity_observations (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ht_opportunity_ledger(id) on delete cascade,
  trading_date date not null,
  ticker text not null,
  strategy text not null,
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  role text not null,
  rank int not null,
  price numeric not null,
  score numeric not null,
  visibility_state text,
  source_run_id text,
  engine_version text,
  prox_state text,
  prox_confirmation numeric,
  decision_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (ledger_id, observation_minute),
  check (price > 0),
  check (rank > 0)
);

create index if not exists ht_opportunity_observations_date_strategy_idx
  on public.ht_opportunity_observations
  (trading_date desc, strategy, observed_at desc, rank asc);

create index if not exists ht_opportunity_observations_ticker_time_idx
  on public.ht_opportunity_observations
  (ticker, strategy, observed_at desc);

create table if not exists public.ht_opportunity_collection_runs (
  id uuid primary key default gen_random_uuid(),
  trading_date date not null,
  observed_at timestamptz not null,
  observation_minute timestamptz not null unique,
  spot_momentum_count int not null default 0,
  before_crowd_count int not null default 0,
  expected_observation_count int not null default 0,
  persisted_observation_count int not null default 0,
  complete boolean not null default false,
  spot_momentum_tickers jsonb not null default '[]'::jsonb,
  before_crowd_tickers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (spot_momentum_count >= 0),
  check (before_crowd_count >= 0),
  check (expected_observation_count >= 0),
  check (persisted_observation_count >= 0)
);

create index if not exists ht_opportunity_collection_runs_date_time_idx
  on public.ht_opportunity_collection_runs
  (trading_date desc, observed_at desc);

alter table public.ht_opportunity_observations enable row level security;
alter table public.ht_opportunity_collection_runs enable row level security;

comment on table public.ht_opportunity_observations is
  'One compact server-owned decision snapshot for every canonical hero, contender, or radar item observed during each scheduled collection cycle.';

comment on table public.ht_opportunity_collection_runs is
  'Coverage receipt proving how many canonical opportunities were expected and persisted during each collection cycle.';
