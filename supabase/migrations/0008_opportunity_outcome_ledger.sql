-- Canonical HT Labs opportunity-performance ledger.
-- One row per ticker/strategy/trading day preserves the first displayed
-- price, later role promotions, and true post-discovery minute-bar outcomes.

create table if not exists public.ht_opportunity_ledger (
  id uuid primary key default gen_random_uuid(),
  trading_date date not null,
  ticker text not null,
  strategy text not null default 'spot_momentum',
  first_seen_at timestamptz not null,
  first_seen_price numeric not null,
  first_role text not null,
  first_rank int not null,
  first_score numeric not null,
  first_visibility_state text,
  first_source_run_id text,
  first_prox_state text,
  first_prox_confirmation numeric,
  latest_seen_at timestamptz not null,
  latest_price numeric not null,
  latest_role text not null,
  latest_rank int not null,
  latest_score numeric not null,
  latest_visibility_state text,
  latest_source_run_id text,
  latest_prox_state text,
  latest_prox_confirmation numeric,
  hero_first_at timestamptz,
  hero_first_price numeric,
  contender_first_at timestamptz,
  contender_first_price numeric,
  radar_first_at timestamptz,
  radar_first_price numeric,
  highest_price_after_signal numeric not null,
  highest_price_at timestamptz not null,
  lowest_price_after_signal numeric not null,
  lowest_price_at timestamptz not null,
  max_gain_percent numeric not null default 0,
  max_drawdown_percent numeric not null default 0,
  time_to_peak_minutes numeric not null default 0,
  hit_5_at timestamptz,
  hit_10_at timestamptz,
  hit_20_at timestamptz,
  hit_minus_5_at timestamptz,
  hit_minus_10_at timestamptz,
  last_bar_at timestamptz,
  regular_close_price numeric,
  regular_close_return_percent numeric,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trading_date, ticker, strategy),
  check (first_seen_price > 0),
  check (latest_price > 0)
);

create index if not exists ht_opportunity_ledger_date_rank_idx
  on public.ht_opportunity_ledger (trading_date desc, first_rank asc);
create index if not exists ht_opportunity_ledger_ticker_time_idx
  on public.ht_opportunity_ledger (ticker, first_seen_at desc);

create table if not exists public.ht_opportunity_role_events (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ht_opportunity_ledger(id) on delete cascade,
  ticker text not null,
  strategy text not null,
  role text not null,
  rank int not null,
  price numeric not null,
  score numeric not null,
  visibility_state text,
  source_run_id text,
  prox_state text,
  prox_confirmation numeric,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists ht_opportunity_role_events_ledger_time_idx
  on public.ht_opportunity_role_events (ledger_id, observed_at asc);
create unique index if not exists ht_opportunity_role_events_transition_idx
  on public.ht_opportunity_role_events (ledger_id, role, observed_at);

alter table public.ht_opportunity_ledger enable row level security;
alter table public.ht_opportunity_role_events enable row level security;

comment on table public.ht_opportunity_ledger is
  'Server-owned first-discovery and post-discovery performance record for every displayed HT opportunity.';
comment on column public.ht_opportunity_ledger.max_gain_percent is
  'Maximum favorable excursion from the immutable first_seen_price, calculated from adjusted one-minute highs.';
comment on column public.ht_opportunity_ledger.max_drawdown_percent is
  'Maximum adverse excursion from the immutable first_seen_price, calculated from adjusted one-minute lows.';
