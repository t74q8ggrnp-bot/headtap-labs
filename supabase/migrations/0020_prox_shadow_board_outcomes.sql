-- Pro X shadow board outcome tracking.
--
-- Measures what actually happened after each shadow-board decision (hero,
-- contender, blocked, rejected -- complete denominator, not just selected
-- picks). This is the missing piece the promotion ladder in
-- docs/PROX_GUIDE.md requires before any "measured comparison" stage can be
-- reached. Mirrors the shape of migration 0014's outcome-memory tables,
-- which already implement the guide's 8-horizon spec for the separate
-- direct-discovery layer -- this is the same contract, scoped to the shadow
-- board's own per-run decisions instead. Shadow/research-only: no table
-- below is a public score, canonical eligibility decision, position
-- instruction, or execution signal.

create table if not exists public.prox_shadow_board_member_outcomes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.prox_shadow_board_members(id) on delete restrict,
  ticker text not null,
  trading_date date not null,
  market_session text not null,
  decision_at timestamptz not null,
  entry_price numeric not null,
  status text not null default 'active',
  latest_price numeric not null,
  latest_observed_at timestamptz not null,
  sampled_high_price numeric not null,
  sampled_high_at timestamptz not null,
  sampled_low_price numeric not null,
  sampled_low_at timestamptz not null,
  max_gain_percent numeric not null default 0,
  max_drawdown_percent numeric not null default 0,
  time_to_peak_minutes numeric,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (status in ('active', 'complete')),
  check (entry_price > 0),
  check (latest_price > 0),
  check (sampled_high_price > 0),
  check (sampled_low_price > 0),
  check (sampled_high_price >= entry_price),
  check (sampled_low_price <= entry_price)
);

create index if not exists prox_shadow_board_member_outcomes_status_idx
  on public.prox_shadow_board_member_outcomes (status, decision_at desc);

create index if not exists prox_shadow_board_member_outcomes_ticker_idx
  on public.prox_shadow_board_member_outcomes (ticker, decision_at desc);

create table if not exists public.prox_shadow_board_member_outcome_horizons (
  id uuid primary key default gen_random_uuid(),
  member_outcome_id uuid not null references public.prox_shadow_board_member_outcomes(id) on delete cascade,
  horizon text not null,
  target_at timestamptz not null,
  measured_at timestamptz,
  measured_price numeric,
  return_percent numeric,
  complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_outcome_id, horizon),
  check (horizon in ('5m', '15m', '30m', '1h', '4h', 'session_close', 'next_session', '24h')),
  check (
    (complete = false and measured_at is null and measured_price is null and return_percent is null)
    or
    (complete = true and measured_at is not null and measured_price > 0 and return_percent is not null)
  )
);

create index if not exists prox_shadow_board_member_outcome_horizons_due_idx
  on public.prox_shadow_board_member_outcome_horizons (complete, target_at);

create index if not exists prox_shadow_board_member_outcome_horizons_parent_idx
  on public.prox_shadow_board_member_outcome_horizons (member_outcome_id, horizon);

create table if not exists public.prox_shadow_board_outcome_runs (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  engine_version text not null,
  status text not null default 'running',
  active_member_count int not null default 0,
  updated_member_count int not null default 0,
  due_outcome_count int not null default 0,
  persisted_outcome_count int not null default 0,
  unavailable_outcome_count int not null default 0,
  complete boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (observation_minute, engine_version),
  check (status in ('running', 'success', 'failed')),
  check (active_member_count >= 0),
  check (updated_member_count >= 0),
  check (due_outcome_count >= 0),
  check (persisted_outcome_count >= 0),
  check (unavailable_outcome_count >= 0)
);

create index if not exists prox_shadow_board_outcome_runs_time_idx
  on public.prox_shadow_board_outcome_runs (observed_at desc);

alter table public.prox_shadow_board_member_outcomes enable row level security;
alter table public.prox_shadow_board_member_outcome_horizons enable row level security;
alter table public.prox_shadow_board_outcome_runs enable row level security;

comment on table public.prox_shadow_board_member_outcomes is
  'One row per prox_shadow_board_members decision, tracking realized MFE/MAE regardless of role or disposition. Shadow/research-only.';

comment on table public.prox_shadow_board_member_outcome_horizons is
  'Fixed-horizon observed prices and returns measured after each shadow-board decision.';

comment on table public.prox_shadow_board_outcome_runs is
  'Coverage receipt proving which active member outcomes and due horizons were measured each cycle.';
