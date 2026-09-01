-- HT Agent Phase 1: paper-only, fail-closed decision and portfolio management.
-- Canonical and independent ProX remain immutable upstream authorities. This
-- schema has no broker credentials and can only link to the HT paper ledger.

alter table public.paper_orders
  drop constraint if exists paper_orders_strategy_source_check;
alter table public.paper_orders
  add constraint paper_orders_strategy_source_check check (strategy_source in (
    'manual', 'spot_momentum', 'before_crowd', 'scanner', 'ticker_detail', 'ht_agent'
  ));

create table if not exists public.ht_agent_global_control (
  id text primary key default 'global' check (id = 'global'),
  kill_switch boolean not null default false,
  reason text not null default 'Normal paper-only operation',
  policy_version text not null default 'ht-agent-risk-v1',
  updated_at timestamptz not null default now()
);
insert into public.ht_agent_global_control (id) values ('global')
on conflict (id) do nothing;

create table if not exists public.ht_agent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  paper_account_id uuid not null unique references public.paper_accounts(id) on delete cascade,
  mode text not null default 'observe'
    check (mode in ('observe', 'approval_paper', 'paper_autopilot')),
  status text not null default 'active' check (status in ('active', 'paused')),
  kill_switch boolean not null default true,
  policy_version text not null default 'ht-agent-risk-v1',
  risk_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ht_agent_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed')),
  mode text not null check (mode in ('observe','approval_paper','paper_autopilot')),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  decision_count integer not null default 0 check (decision_count >= 0),
  order_count integer not null default 0 check (order_count >= 0),
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text
);

create table if not exists public.ht_agent_decision_frames (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.ht_agent_runs(id) on delete cascade,
  frame_version text not null,
  frame_hash text not null,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  captured_at timestamptz not null,
  provider_timestamp timestamptz not null,
  canonical_decision_timestamp timestamptz not null,
  prox_decision_timestamp timestamptz,
  canonical_source_run_id uuid,
  prox_source_run_id uuid,
  market_facts jsonb not null,
  canonical_evidence jsonb not null,
  prox_evidence jsonb not null,
  catalyst_evidence jsonb not null,
  paper_account_state jsonb not null,
  complete boolean not null default true,
  created_at timestamptz not null default now(),
  unique (profile_id, frame_hash),
  check (complete = true)
);

create table if not exists public.ht_agent_decisions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.ht_agent_runs(id) on delete cascade,
  frame_id uuid not null unique references public.ht_agent_decision_frames(id) on delete restrict,
  approval_frame_id uuid references public.ht_agent_decision_frames(id) on delete restrict,
  symbol text not null,
  decision_version text not null,
  policy_version text not null,
  mode text not null check (mode in ('observe','approval_paper','paper_autopilot')),
  action text not null check (action in ('observe','prepare','enter','manage','reduce','exit','reject','expire')),
  state text not null default 'recorded'
    check (state in ('recorded','pending_approval','approved','declined','submitted','filled','closed','failed','expired')),
  proposed_entry numeric,
  proposed_stop numeric,
  proposed_target numeric,
  proposed_quantity numeric not null default 0 check (proposed_quantity >= 0),
  maximum_risk numeric not null default 0 check (maximum_risk >= 0),
  estimated_notional numeric not null default 0 check (estimated_notional >= 0),
  risk_allowed boolean not null,
  risk_rules jsonb not null,
  explanation text not null,
  paper_order_id uuid references public.paper_orders(id) on delete set null,
  paper_order_result jsonb,
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.paper_orders add column if not exists ht_agent_decision_id uuid;
do $$ begin
  alter table public.paper_orders
    add constraint paper_orders_ht_agent_decision_fk
    foreign key (ht_agent_decision_id) references public.ht_agent_decisions(id) on delete restrict;
exception when duplicate_object then null; end $$;
create unique index if not exists paper_orders_ht_agent_decision_unique
  on public.paper_orders(ht_agent_decision_id) where ht_agent_decision_id is not null;

create table if not exists public.ht_agent_decision_events (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.ht_agent_decisions(id) on delete cascade,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ht_agent_control_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','profile')),
  profile_id uuid references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('global_control_changed','profile_control_changed')),
  previous_state jsonb not null,
  next_state jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  check (
    (scope = 'global' and profile_id is null and user_id is null) or
    (scope = 'profile' and profile_id is not null and user_id is not null)
  )
);

create table if not exists public.ht_agent_cohort_observations (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.ht_agent_decisions(id) on delete cascade,
  frame_id uuid not null references public.ht_agent_decision_frames(id) on delete restrict,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cohort_version text not null default 'ht-agent-cohorts-v1',
  cohort text not null check (cohort in ('canonical_only','canonical_prox','ht_agent_full')),
  would_enter boolean not null,
  reason text not null,
  decision_price numeric not null check (decision_price > 0),
  conservative_slippage_bps numeric not null default 25 check (conservative_slippage_bps >= 0),
  observed_at timestamptz not null,
  unique (decision_id, cohort)
);

create table if not exists public.ht_agent_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.ht_agent_decisions(id) on delete cascade,
  cohort_observation_id uuid references public.ht_agent_cohort_observations(id) on delete cascade,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  horizon text not null check (horizon in ('30s','1m','5m','15m','30m','60m','session','exit')),
  target_at timestamptz not null,
  observed_at timestamptz,
  provider_timestamp timestamptz,
  quote_provider_timestamp timestamptz,
  bid numeric,
  ask numeric,
  spread_percent numeric,
  price numeric,
  return_percent numeric,
  resolution_state text not null default 'pending'
    check (resolution_state in ('pending','measured','unavailable')),
  unavailable_reason text,
  complete boolean not null default false,
  unique (decision_id, cohort_observation_id, horizon)
);

create index if not exists ht_agent_decisions_profile_time_idx on public.ht_agent_decisions(profile_id, decided_at desc);
create index if not exists ht_agent_decisions_state_idx on public.ht_agent_decisions(state, decided_at desc);
create index if not exists ht_agent_outcomes_due_idx on public.ht_agent_outcomes(complete, target_at);
create index if not exists ht_agent_events_decision_idx on public.ht_agent_decision_events(decision_id, created_at);

alter table public.ht_agent_global_control enable row level security;
alter table public.ht_agent_profiles enable row level security;
alter table public.ht_agent_runs enable row level security;
alter table public.ht_agent_decision_frames enable row level security;
alter table public.ht_agent_decisions enable row level security;
alter table public.ht_agent_decision_events enable row level security;
alter table public.ht_agent_control_events enable row level security;
alter table public.ht_agent_cohort_observations enable row level security;
alter table public.ht_agent_outcomes enable row level security;

drop policy if exists ht_agent_profiles_owner_read on public.ht_agent_profiles;
drop policy if exists ht_agent_runs_owner_read on public.ht_agent_runs;
drop policy if exists ht_agent_frames_owner_read on public.ht_agent_decision_frames;
drop policy if exists ht_agent_decisions_owner_read on public.ht_agent_decisions;
drop policy if exists ht_agent_events_owner_read on public.ht_agent_decision_events;
drop policy if exists ht_agent_control_events_owner_read on public.ht_agent_control_events;
drop policy if exists ht_agent_cohorts_owner_read on public.ht_agent_cohort_observations;
drop policy if exists ht_agent_outcomes_owner_read on public.ht_agent_outcomes;
create policy ht_agent_profiles_owner_read on public.ht_agent_profiles for select to authenticated using (auth.uid() = user_id);
create policy ht_agent_runs_owner_read on public.ht_agent_runs for select to authenticated using (auth.uid() = user_id);
create policy ht_agent_frames_owner_read on public.ht_agent_decision_frames for select to authenticated using (auth.uid() = user_id);
create policy ht_agent_decisions_owner_read on public.ht_agent_decisions for select to authenticated using (auth.uid() = user_id);
create policy ht_agent_events_owner_read on public.ht_agent_decision_events for select to authenticated using (auth.uid() = user_id);
create policy ht_agent_control_events_owner_read on public.ht_agent_control_events for select to authenticated using (auth.uid() = user_id);
create policy ht_agent_cohorts_owner_read on public.ht_agent_cohort_observations for select to authenticated using (auth.uid() = user_id);
create policy ht_agent_outcomes_owner_read on public.ht_agent_outcomes for select to authenticated using (auth.uid() = user_id);

create or replace function public.ht_agent_reject_frame_mutation()
returns trigger language plpgsql as $$ begin
  raise exception 'ht_agent_decision_frames_are_immutable';
end $$;
drop trigger if exists ht_agent_frames_immutable on public.ht_agent_decision_frames;
create trigger ht_agent_frames_immutable before update or delete on public.ht_agent_decision_frames
for each row execute function public.ht_agent_reject_frame_mutation();

create or replace function public.ht_agent_reject_journal_mutation()
returns trigger language plpgsql as $$ begin
  raise exception 'ht_agent_journals_are_append_only';
end $$;
drop trigger if exists ht_agent_decision_events_append_only on public.ht_agent_decision_events;
create trigger ht_agent_decision_events_append_only before update or delete on public.ht_agent_decision_events
for each row execute function public.ht_agent_reject_journal_mutation();
drop trigger if exists ht_agent_control_events_append_only on public.ht_agent_control_events;
create trigger ht_agent_control_events_append_only before update or delete on public.ht_agent_control_events
for each row execute function public.ht_agent_reject_journal_mutation();

comment on table public.ht_agent_decision_frames is 'Immutable, provider-time aligned evidence frames. Paper-only Agent input.';
comment on table public.ht_agent_decision_events is 'Append-only Agent state journal including no-trades and paper-order outcomes.';
comment on table public.ht_agent_control_events is 'Append-only global and per-profile Agent control changes.';
comment on column public.paper_orders.ht_agent_decision_id is 'Paper-only idempotency link. No broker execution authority.';
