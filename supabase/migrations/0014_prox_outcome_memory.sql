-- Pro X Outcome Memory and pattern calibration.
--
-- This phase measures what actually happens after the first independent Pro X
-- discovery. It is shadow/research-only: no table below is a public score,
-- canonical eligibility decision, position instruction, or execution signal.

create table if not exists public.prox_research_episodes (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  trading_date date not null,
  first_observation_id uuid not null references public.prox_market_discovery_observations(id) on delete restrict,
  started_at timestamptz not null,
  market_session text not null,
  methodology_version text not null,
  pattern_signature text not null,
  initial_anomaly_flags jsonb not null default '[]'::jsonb,
  initial_reasons jsonb not null default '[]'::jsonb,
  initial_feature_snapshot jsonb not null default '{}'::jsonb,
  source_entry_price numeric not null,
  entry_price numeric not null,
  raw_entry_change_percent numeric,
  observed_entry_change_percent numeric,
  entry_relative_volume numeric,
  entry_dollar_volume numeric,
  corporate_action_suspected boolean not null default false,
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
  outcome_label text not null default 'unlabeled',
  outcome_reason text,
  calibratable boolean not null default false,
  measurement_quality text not null default 'polygon_snapshot_5m_sampled',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker, trading_date, methodology_version),
  unique (first_observation_id),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (status in ('active', 'complete', 'quarantined')),
  check (source_entry_price > 0),
  check (entry_price > 0),
  check (latest_price > 0),
  check (sampled_high_price > 0),
  check (sampled_low_price > 0),
  check (sampled_high_price >= entry_price),
  check (sampled_low_price <= entry_price),
  check (outcome_label in (
    'unlabeled',
    'early_continuation',
    'quiet_accumulation_breakout',
    'reclaim_continuation',
    'late_chase',
    'post_peak_failure',
    'high_volume_breakdown',
    'corporate_action_distortion',
    'inconclusive'
  ))
);

create index if not exists prox_research_episodes_status_time_idx
  on public.prox_research_episodes (status, started_at desc);

create index if not exists prox_research_episodes_pattern_idx
  on public.prox_research_episodes
  (pattern_signature, market_session, outcome_label, trading_date desc);

create table if not exists public.prox_research_episode_outcomes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.prox_research_episodes(id) on delete cascade,
  horizon text not null,
  target_at timestamptz not null,
  measured_at timestamptz,
  measured_price numeric,
  return_percent numeric,
  measurement_source text,
  measurement_quality text,
  complete boolean not null default false,
  methodology_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, horizon),
  check (horizon in ('5m', '15m', '30m', '1h', '4h', 'session_close', 'next_session', '24h')),
  check (
    (complete = false and measured_at is null and measured_price is null and return_percent is null)
    or
    (complete = true and measured_at is not null and measured_price > 0 and return_percent is not null)
  )
);

create index if not exists prox_research_episode_outcomes_due_idx
  on public.prox_research_episode_outcomes (complete, target_at);

create index if not exists prox_research_episode_outcomes_episode_idx
  on public.prox_research_episode_outcomes (episode_id, horizon);

create table if not exists public.prox_pattern_calibrations (
  calibration_key text primary key,
  methodology_version text not null,
  pattern_signature text not null,
  market_session text not null,
  sample_size int not null,
  continuation_count int not null,
  failure_count int not null,
  inconclusive_count int not null,
  continuation_rate numeric not null,
  average_max_gain_percent numeric not null,
  average_max_drawdown_percent numeric not null,
  average_time_to_peak_minutes numeric,
  evidence_state text not null,
  stats jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (sample_size > 0),
  check (continuation_count >= 0),
  check (failure_count >= 0),
  check (inconclusive_count >= 0),
  check (continuation_rate >= 0 and continuation_rate <= 1),
  check (evidence_state in ('insufficient', 'emerging', 'calibrated'))
);

create index if not exists prox_pattern_calibrations_pattern_idx
  on public.prox_pattern_calibrations
  (pattern_signature, market_session, evidence_state, computed_at desc);

create table if not exists public.prox_outcome_memory_runs (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  methodology_version text not null,
  status text not null default 'running',
  market_session text not null,
  snapshot_count int not null default 0,
  active_episode_count int not null default 0,
  updated_episode_count int not null default 0,
  due_outcome_count int not null default 0,
  persisted_outcome_count int not null default 0,
  unavailable_outcome_count int not null default 0,
  calibration_count int not null default 0,
  complete boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (observation_minute, methodology_version),
  check (status in ('running', 'success', 'failed')),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (snapshot_count >= 0),
  check (active_episode_count >= 0),
  check (updated_episode_count >= 0),
  check (due_outcome_count >= 0),
  check (persisted_outcome_count >= 0),
  check (unavailable_outcome_count >= 0),
  check (calibration_count >= 0)
);

create index if not exists prox_outcome_memory_runs_time_idx
  on public.prox_outcome_memory_runs (observed_at desc);

-- Backfill the true first observation already stored by migration 0013. This
-- lets Outcome Memory start without replacing an earlier discovery price with
-- the price from the first post-deployment cron.
with first_observations as (
  select distinct on (
    observation.ticker,
    (observation.observed_at at time zone 'America/New_York')::date
  )
    observation.*,
    (observation.observed_at at time zone 'America/New_York')::date as trading_date
  from public.prox_market_discovery_observations observation
  order by
    observation.ticker,
    (observation.observed_at at time zone 'America/New_York')::date,
    observation.observed_at asc
)
insert into public.prox_research_episodes (
  ticker,
  trading_date,
  first_observation_id,
  started_at,
  market_session,
  methodology_version,
  pattern_signature,
  initial_anomaly_flags,
  initial_reasons,
  initial_feature_snapshot,
  source_entry_price,
  entry_price,
  raw_entry_change_percent,
  observed_entry_change_percent,
  entry_relative_volume,
  entry_dollar_volume,
  corporate_action_suspected,
  status,
  latest_price,
  latest_observed_at,
  sampled_high_price,
  sampled_high_at,
  sampled_low_price,
  sampled_low_at,
  max_gain_percent,
  max_drawdown_percent,
  time_to_peak_minutes,
  outcome_label,
  outcome_reason,
  calibratable,
  completed_at
)
select
  observation.ticker,
  observation.trading_date,
  observation.id,
  observation.observed_at,
  observation.market_session,
  'prox-outcome-memory-v1',
  case
    when observation.anomaly_flags ? 'corporate_action_dislocation' then 'corporate_action_dislocation'
    when observation.anomaly_flags ? 'quiet_participation' then 'quiet_participation'
    when observation.anomaly_flags ? 'session_reclaim' then 'session_reclaim'
    when observation.anomaly_flags ? 'downside_volume_breakdown' then 'downside_volume_breakdown'
    when observation.anomaly_flags ? 'post_peak_deterioration' then 'post_peak_deterioration'
    when observation.anomaly_flags ? 'liquidity_surge' then 'liquidity_surge'
    when observation.anomaly_flags ? 'price_expansion' then 'price_expansion'
    when observation.anomaly_flags ? 'volume_breakout' then 'volume_breakout'
    else 'unclassified'
  end,
  observation.anomaly_flags,
  observation.reasons,
  observation.feature_snapshot,
  observation.price,
  observation.price,
  observation.raw_full_day_change_percent,
  observation.observed_change_percent,
  observation.time_adjusted_relative_volume,
  observation.dollar_volume,
  observation.corporate_action_suspected,
  case when observation.corporate_action_suspected then 'quarantined' else 'active' end,
  observation.price,
  observation.observed_at,
  observation.price,
  observation.observed_at,
  observation.price,
  observation.observed_at,
  0,
  0,
  0,
  case when observation.corporate_action_suspected then 'corporate_action_distortion' else 'unlabeled' end,
  case when observation.corporate_action_suspected then 'Corporate-action discontinuity quarantined from learning.' else null end,
  false,
  case when observation.corporate_action_suspected then observation.observed_at else null end
from first_observations observation
on conflict (ticker, trading_date, methodology_version) do nothing;

alter table public.prox_research_episodes enable row level security;
alter table public.prox_research_episode_outcomes enable row level security;
alter table public.prox_pattern_calibrations enable row level security;
alter table public.prox_outcome_memory_runs enable row level security;

comment on table public.prox_research_episodes is
  'One permanent first-discovery episode per ticker/day for Pro X outcome learning; never a public score or order instruction.';

comment on table public.prox_research_episode_outcomes is
  'Fixed-horizon observed prices and returns measured after the original Pro X discovery.';

comment on table public.prox_pattern_calibrations is
  'Versioned aggregate evidence from completed, calibratable episodes. Internal research only.';

comment on table public.prox_outcome_memory_runs is
  'Coverage receipt proving which active research episodes and due horizons were measured each cycle.';
