-- Pro X direct Polygon market discovery, shadow/research mode only.
--
-- This is an independent observation and investigation lane. It does not
-- write canonical HT scores, opportunity eligibility, UI rankings, bot
-- policy, positions, or orders. The canonical backend remains the only
-- publishing authority.

create table if not exists public.prox_market_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  completed_at timestamptz,
  observation_minute timestamptz not null,
  engine_version text not null,
  mode text not null default 'shadow_research',
  market_session text not null,
  source_endpoint text not null,
  status text not null default 'running',
  snapshot_count int not null default 0,
  eligible_count int not null default 0,
  expected_observation_count int not null default 0,
  persisted_observation_count int not null default 0,
  research_queued_count int not null default 0,
  corporate_action_count int not null default 0,
  complete boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (observation_minute, engine_version),
  check (mode = 'shadow_research'),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (status in ('running', 'success', 'failed')),
  check (snapshot_count >= 0),
  check (eligible_count >= 0),
  check (expected_observation_count >= 0),
  check (persisted_observation_count >= 0),
  check (research_queued_count >= 0),
  check (corporate_action_count >= 0)
);

create index if not exists prox_market_discovery_runs_time_idx
  on public.prox_market_discovery_runs (started_at desc);

create table if not exists public.prox_corporate_actions (
  source_split_id text primary key,
  ticker text not null,
  execution_date date not null,
  split_from numeric not null,
  split_to numeric not null,
  adjustment_type text,
  historical_adjustment_factor numeric,
  source_endpoint text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (split_from > 0),
  check (split_to > 0)
);

create index if not exists prox_corporate_actions_ticker_date_idx
  on public.prox_corporate_actions (ticker, execution_date desc);

create table if not exists public.prox_market_discovery_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prox_market_discovery_runs(id) on delete cascade,
  ticker text not null,
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  engine_version text not null,
  mode text not null default 'shadow_research',
  source_endpoint text not null,
  market_session text not null,
  price numeric not null,
  previous_close numeric,
  session_open_price numeric,
  session_high_price numeric,
  session_low_price numeric,
  raw_full_day_change_percent numeric,
  observed_change_percent numeric,
  session_change_percent numeric,
  pullback_from_session_high_percent numeric,
  current_volume bigint not null,
  previous_volume bigint not null,
  expected_volume_fraction numeric not null,
  raw_volume_ratio numeric,
  time_adjusted_relative_volume numeric,
  dollar_volume numeric not null,
  corporate_action_suspected boolean not null default false,
  corporate_action_factor numeric,
  corporate_action_source_id text references public.prox_corporate_actions(source_split_id) on delete set null,
  anomaly_flags jsonb not null default '[]'::jsonb,
  research_priority int not null,
  reasons jsonb not null default '[]'::jsonb,
  feature_snapshot jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (ticker, observation_minute, engine_version),
  check (mode = 'shadow_research'),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (price > 0),
  check (current_volume >= 0),
  check (previous_volume >= 0),
  check (expected_volume_fraction > 0 and expected_volume_fraction <= 1),
  check (dollar_volume >= 0),
  check (research_priority >= 0 and research_priority <= 100)
);

create index if not exists prox_market_discovery_observations_time_idx
  on public.prox_market_discovery_observations (observed_at desc, research_priority desc);

create index if not exists prox_market_discovery_observations_ticker_time_idx
  on public.prox_market_discovery_observations (ticker, observed_at desc);

create table if not exists public.prox_research_queue (
  ticker text primary key,
  status text not null default 'queued',
  first_detected_at timestamptz not null,
  last_detected_at timestamptz not null,
  latest_observation_id uuid references public.prox_market_discovery_observations(id) on delete set null,
  engine_version text not null,
  research_priority int not null,
  anomaly_flags jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  occurrence_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('queued', 'observing', 'validated', 'dismissed')),
  check (research_priority >= 0 and research_priority <= 100),
  check (occurrence_count > 0)
);

create index if not exists prox_research_queue_active_idx
  on public.prox_research_queue (status, research_priority desc, last_detected_at desc);

create or replace function public.prox_preserve_research_queue_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.first_detected_at = old.first_detected_at;
    new.created_at = old.created_at;
    new.occurrence_count = case
      when new.last_detected_at is distinct from old.last_detected_at
        then old.occurrence_count + 1
      else old.occurrence_count
    end;
    if old.status in ('observing', 'validated', 'dismissed') then
      new.status = old.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prox_research_queue_history_trigger
  on public.prox_research_queue;

create trigger prox_research_queue_history_trigger
before update on public.prox_research_queue
for each row execute function public.prox_preserve_research_queue_history();

alter table public.prox_market_discovery_runs enable row level security;
alter table public.prox_corporate_actions enable row level security;
alter table public.prox_market_discovery_observations enable row level security;
alter table public.prox_research_queue enable row level security;

comment on table public.prox_market_discovery_runs is
  'Coverage receipt for Pro X direct full-market Polygon discovery. Shadow research only; never a public score or trading authority.';

comment on table public.prox_market_discovery_observations is
  'Append-only raw and normalized market anomalies found independently by Pro X before canonical selection.';

comment on table public.prox_corporate_actions is
  'Polygon corporate-action facts used to prevent split artifacts from becoming false learned momentum.';

comment on table public.prox_research_queue is
  'Current Pro X investigation queue ordered by internal research urgency, not an HT opportunity score.';
