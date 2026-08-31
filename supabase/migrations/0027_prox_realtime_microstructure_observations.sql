-- Massive Advanced real-time market microstructure observations for ProX.
--
-- These tables are an append-only shadow evidence lane. They intentionally
-- contain no HT score, ProX score, rank, eligibility decision, order, bot, or
-- execution fields. Canonical opportunity authority remains unchanged.

create table if not exists public.prox_realtime_microstructure_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  completed_at timestamptz,
  observation_minute timestamptz not null,
  engine_version text not null,
  authority text not null default 'shadow_observation_only',
  market_session text not null,
  source_data_mode text not null default 'unavailable',
  status text not null default 'running',
  candidate_count int not null default 0,
  expected_observation_count int not null default 0,
  persisted_observation_count int not null default 0,
  quote_observation_count int not null default 0,
  trade_observation_count int not null default 0,
  provider_error_count int not null default 0,
  truncated_tape_count int not null default 0,
  latest_market_as_of timestamptz,
  complete boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (observation_minute, engine_version),
  check (authority = 'shadow_observation_only'),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (source_data_mode in ('real_time', 'delayed', 'unavailable')),
  check (status in ('running', 'success', 'failed')),
  check (candidate_count >= 0),
  check (expected_observation_count >= 0),
  check (persisted_observation_count >= 0),
  check (quote_observation_count >= 0),
  check (trade_observation_count >= 0),
  check (provider_error_count >= 0),
  check (truncated_tape_count >= 0)
);

create index if not exists prox_realtime_microstructure_runs_time_idx
  on public.prox_realtime_microstructure_runs (started_at desc);

create index if not exists prox_realtime_microstructure_runs_market_time_idx
  on public.prox_realtime_microstructure_runs (latest_market_as_of desc);

create table if not exists public.prox_realtime_microstructure_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prox_realtime_microstructure_runs(id) on delete cascade,
  ticker text not null,
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  engine_version text not null,
  authority text not null default 'shadow_observation_only',
  market_session text not null,
  research_priority int not null default 0,
  research_detected_at timestamptz,
  quote_as_of timestamptz,
  trade_as_of timestamptz,
  market_as_of timestamptz,
  bid_price numeric,
  ask_price numeric,
  bid_size numeric,
  ask_size numeric,
  midpoint_price numeric,
  spread_dollars numeric,
  spread_percent numeric,
  last_trade_price numeric,
  last_trade_size numeric,
  tape_window_started_at timestamptz not null,
  recent_trade_count int not null default 0,
  recent_trade_volume numeric not null default 0,
  recent_trade_notional numeric not null default 0,
  largest_trade_size numeric not null default 0,
  largest_trade_notional numeric not null default 0,
  exchange_count int not null default 0,
  condition_codes jsonb not null default '[]'::jsonb,
  tape_truncated boolean not null default false,
  quote_available boolean not null default false,
  trades_available boolean not null default false,
  source_provider text not null default 'massive_polygon',
  source_data_mode text not null default 'unavailable',
  created_at timestamptz not null default now(),
  unique (ticker, observation_minute, engine_version),
  check (authority = 'shadow_observation_only'),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (source_data_mode in ('real_time', 'delayed', 'unavailable')),
  check (research_priority >= 0 and research_priority <= 100),
  check (bid_price is null or bid_price > 0),
  check (ask_price is null or ask_price > 0),
  check (bid_size is null or bid_size > 0),
  check (ask_size is null or ask_size > 0),
  check (midpoint_price is null or midpoint_price > 0),
  check (spread_dollars is null or spread_dollars >= 0),
  check (spread_percent is null or spread_percent >= 0),
  check (last_trade_price is null or last_trade_price > 0),
  check (last_trade_size is null or last_trade_size > 0),
  check (recent_trade_count >= 0),
  check (recent_trade_volume >= 0),
  check (recent_trade_notional >= 0),
  check (largest_trade_size >= 0),
  check (largest_trade_notional >= 0),
  check (exchange_count >= 0),
  check (quote_available = (quote_as_of is not null)),
  check (trades_available = (recent_trade_count > 0))
);

create index if not exists prox_realtime_microstructure_observations_time_idx
  on public.prox_realtime_microstructure_observations (observed_at desc);

create index if not exists prox_realtime_microstructure_observations_ticker_time_idx
  on public.prox_realtime_microstructure_observations (ticker, market_as_of desc);

create or replace function public.prox_reject_microstructure_observation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ProX microstructure observations are append-only';
end;
$$;

drop trigger if exists prox_realtime_microstructure_observations_immutable
  on public.prox_realtime_microstructure_observations;

create trigger prox_realtime_microstructure_observations_immutable
before update or delete on public.prox_realtime_microstructure_observations
for each row execute function public.prox_reject_microstructure_observation_mutation();

alter table public.prox_realtime_microstructure_runs enable row level security;
alter table public.prox_realtime_microstructure_observations enable row level security;

comment on table public.prox_realtime_microstructure_runs is
  'Exact-count coverage receipts for the bounded ProX Massive quote/trade observation lane. No scoring or execution authority.';
comment on table public.prox_realtime_microstructure_observations is
  'Append-only NBBO and recent consolidated trade facts for ProX shadow research. Never a public score or trading decision.';
comment on column public.prox_realtime_microstructure_observations.market_as_of is
  'Newest provider quote/trade timestamp in this observation; distinct from HT processing time.';
